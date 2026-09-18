#!/usr/bin/env python3
"""Ground-truth checks: the tidy CSVs in clean/ must agree with the publishers' own publications (PSA, IARC)
and add up internally. Exits non-zero on any mismatch.

    python3 data/check.py    (needs openpyxl and pypdf for the published workbooks/PDFs)
"""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl
import pypdf

DATA = Path(__file__).parent
PSA_2024 = DATA / "raw/psa/2024-deaths"
SITES = [f"1-0{n}" for n in range(27, 48)]  # the 21 site groups under 1-026 Neoplasms
failures = []


def expect(ok, msg):
    if not ok:
        failures.append(msg)


def load(name):
    with open(DATA / "clean" / f"{name}.csv") as f:
        return list(csv.DictReader(f))


def sheet(name, tab):
    return list(openpyxl.load_workbook(PSA_2024 / name, read_only=True, data_only=True)[tab].iter_rows(values_only=True))


rows = load("neoplasm_deaths")
deaths = {(int(r["year"]), r["region_code"], r["cause_code"], r["age_group"], r["sex"]): int(r["deaths"]) for r in rows}
names_2024 = {r["region"].upper(): r["region_code"] for r in rows if r["year"] == "2024"}

# 1. Headline figures in PSA's 2024 textual tables (Table 10, ten leading causes by sex).
sex = None
for row in sheet("textual-tables.xlsx", "Table10"):
    label = str(row[0] or "").strip()
    if label in ("BOTH SEXES", "MALE", "FEMALE"):
        sex = label.title()
    elif label == "All causes of death" or label.endswith("Neoplasms"):
        got = deaths[(2024, "PH", "total" if label.startswith("All") else "1-026", "Total", sex)]
        expect(got == row[1], f"Table 10 {label} {sex}: published {row[1]}, clean {got}")

# 2. Every neoplasm cell of PSA 2024 statistical Table 12 (region x cause x age x sex).
t12 = sheet("statistical-tables.xlsx", "T12")
ages = [re.sub(r"\s*-\s*", "-", a).replace(" Over", " over") for a in t12[1][4::2]]
region, checked = "PH", 0
for row in t12[4:]:
    label = str(row[0] or "").strip()
    region = names_2024.get(label.upper(), region)
    m = re.match(r"1[–-](0\d\d) ", label)
    if not m or f"1-{m[1]}" not in ("1-026", *SITES):
        continue
    published = {("Total", "Both Sexes"): row[1], ("Total", "Male"): row[2], ("Total", "Female"): row[3]}
    for i, a in enumerate(ages):
        published[(a, "Male")], published[(a, "Female")] = row[4 + 2 * i], row[5 + 2 * i]
    for (a, s), v in published.items():
        v = 0 if v in (None, "-") else v
        got = deaths.get((2024, region, f"1-{m[1]}", a, s))
        expect(got == v, f"T12 {region} 1-{m[1]} {a} {s}: published {v}, clean {got}")
        checked += 1
expected = 20 * 22 * (3 + 2 * len(ages))  # national + 18 regions + foreign, 1-026 + 21 sites
expect(checked == expected, f"T12: compared {checked} cells, expected {expected}")

# 3. Internal arithmetic, both years: sites -> neoplasms, male + female -> both,
#    age groups -> total, regions (+ foreign) -> national.
for y in {k[0] for k in deaths}:
    causes = {k[2] for k in deaths if k[0] == y}
    expect(causes == {"total", "1-026", *SITES}, f"{y}: causes present {sorted(causes)}")
age_sum, region_sum = defaultdict(int), defaultdict(int)
for (y, reg, code, a, s), v in deaths.items():
    if code == "1-026":
        sites = sum(deaths[(y, reg, c, a, s)] for c in SITES)
        expect(sites == v, f"{y} {reg} {a} {s}: sites sum to {sites}, neoplasms {v}")
    if s == "Both Sexes":
        ms = deaths[(y, reg, code, a, "Male")] + deaths[(y, reg, code, a, "Female")]
        expect(ms == v, f"{y} {reg} {code} {a}: male + female {ms}, both {v}")
    if a != "Total":
        age_sum[(y, reg, code, "Total", s)] += v
    elif reg != "PH":
        region_sum[(y, "PH", code, "Total", s)] += v
for label, sums in (("age groups", age_sum), ("regions", region_sum)):
    for k, v in sums.items():
        expect(v == deaths[k], f"{k}: {label} sum to {v}, total {deaths[k]}")

# 4. Population: regions add up to the national count, age groups to the region total,
#    and the two census tables agree on household population.
pop = {}
for r in load("population"):
    k = (r["region_code"], r["measure"], r["age_group"], r["sex"])
    expect(k not in pop, f"population: duplicate row {k}")
    pop[k] = float(r["value"])
regions = {k[0] for k in pop} - {"PH"}
expect(regions == set(names_2024.values()) - {"PH", "foreign"}, "population regions differ from 2024 death regions")
# PSA footnote a/: the national total includes 1,708 Filipinos in embassies, consulates and missions abroad.
ABROAD = {"Total Population": 1708}
for measure in ("Total Population", "Household Population", "Number of Households"):
    s = sum(pop[(r, measure, "Total", "Both Sexes")] for r in regions) + ABROAD.get(measure, 0)
    expect(s == pop[("PH", measure, "Total", "Both Sexes")], f"population {measure}: regions sum to {s}")
by_age = defaultdict(float)
for (reg, measure, a, s), v in pop.items():
    if measure == "Household Population" and a != "Total":
        by_age[(reg, measure, "Total", s)] += v
for k, v in by_age.items():
    expect(v == pop[k], f"population {k}: age groups sum to {v}, total {pop[k]}")

# 5. GLOBOCAN 2024: the API snapshot equals IARC's published fact sheet (PDF), and adds up.
gco = {(r["measure"], r["sex"], r["cancer_code"]): int(r["count"]) for r in load("globocan")}
asr = {(r["measure"], r["sex"]): float(r["asr_world"]) for r in load("globocan") if r["cancer_code"] == "39"}
page1, page2 = (p.extract_text() for p in pypdf.PdfReader(DATA / "raw/iarc/globocan-2024/fact-sheet.pdf").pages)
N = r"(\d{1,3}(?: \d{3})*)"  # the PDF prints 149 852 for 149,852


def male_female_both(text):
    """'61 122 88 730 149 852' -> the one split into three numbers where male + female = both."""
    t = text.split()
    for i in range(1, len(t) - 1):
        for j in range(i + 1, len(t)):
            parts = [t[:i], t[i:j], t[j:]]
            if all(len(p[0]) <= 3 and all(len(x) == 3 for x in p[1:]) for p in parts):
                m, f, b = (int("".join(p)) for p in parts)
                if m + f == b:
                    return m, f, b


for label, measure in (("Number of new cancer cases", "incidence"), ("Number of cancer deaths", "mortality"),
                       ("5-year prevalent cases", "prevalence_5y")):
    published = male_female_both(re.search(label + r" ([\d ]+)\n", page1)[1])
    got = tuple(gco[(measure, s, "39")] for s in ("Male", "Female", "Both Sexes"))
    expect(published == got, f"GLOBOCAN {measure} by sex: published {published}, clean {got}")
for label, measure in (("Age-standardized incidence rate", "incidence"), ("Age-standardized mortality rate", "mortality")):
    published = tuple(map(float, re.search(label + r" ([\d. ]+)\n", page1)[1].split()))
    got = tuple(round(asr[(measure, s)], 1) for s in ("Male", "Female", "Both Sexes"))
    expect(published == got, f"GLOBOCAN {measure} ASR by sex: published {published}, clean {got}")

cancers = json.loads((DATA / "raw/iarc/globocan-2024/cancers.json").read_text())
norm = lambda s: s.lower().replace(",", "")
codes = {norm(c[k]): (str(c["cancer"]),) for c in cancers for k in ("label", "short_label")}
codes |= {"colorectum": ("8", "9", "10"), "melanoma": ("16",), "brain cns": ("31",), "all cancers excl. nmsc": ("40",)}
site_rows = 0
for line in page2.splitlines():
    m = (re.match(rf"^(.+?) {N} \d+ [\d.]+ [\d.]+ {N} \d+ [\d.]+ [\d.]+ {N} \d+\.\d+$", line)
         or re.match(rf"^(All cancers.*?) {N} - - [\d.]+ {N} - - [\d.]+ {N} -$", line))
    if not m:
        continue
    site_rows += 1
    for measure, value in zip(("incidence", "mortality", "prevalence_5y"), m.groups()[1:]):
        got = sum(gco[(measure, "Both Sexes", c)] for c in codes[norm(m[1])])
        expect(got == int(value.replace(" ", "")), f"GLOBOCAN {m[1]} {measure}: published {value}, clean {got}")
expect(site_rows == 34, f"GLOBOCAN fact sheet: parsed {site_rows} site rows, expected 34")

for (measure, s, code), v in gco.items():
    if s == "Both Sexes":
        parts = [gco[(measure, x, code)] for x in ("Male", "Female") if (measure, x, code) in gco]
        expect(sum(parts) == v, f"GLOBOCAN {measure} {code}: male + female {sum(parts)}, both {v}")
    if code == "37+38":
        expect(v >= 0, f"GLOBOCAN {measure} {s}: itemised sites exceed all cancers by {-v}")

print(f"{len(deaths)} death cells ({', '.join(map(str, sorted({k[0] for k in deaths})))}), "
      f"{checked} matched cell-by-cell against PSA 2024 Table 12, {len(pop)} population cells, "
      f"{len(gco)} GLOBOCAN cells ({site_rows} fact-sheet rows matched)")
if failures:
    print(f"\n{len(failures)} FAILED", *failures[:25], sep="\n  ")
    sys.exit(1)
print("all ground-truth checks passed")
