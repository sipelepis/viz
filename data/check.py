#!/usr/bin/env python3
"""Ground-truth checks: the tidy CSVs in clean/ must agree with the publishers' own publications (PSA, IARC,
the survival papers) and add up internally. Writes clean/validation.json: every check, what it was compared
against, its result, and a SHA-256 of each verified file so whoever serves the data can prove it's unchanged.

    python3 data/check.py                # exits non-zero on any mismatch
    python3 data/check.py --report-only  # always exits 0; the report carries the verdict (used by the build)

Needs openpyxl and pypdf for the published workbooks/PDFs.
"""
import csv
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl
import pypdf

DATA = Path(__file__).parent
PSA_2024 = DATA / "raw/psa/2024-deaths"
SITES = [f"1-0{n}" for n in range(27, 48)]  # the 21 site groups under 1-026 Neoplasms
checks = []


def check(id, title, against):
    """Start a named check; the expect() calls that follow belong to it."""
    checks.append({"id": id, "title": title, "against": against, "assertions": 0, "failures": []})


def expect(ok, msg):
    checks[-1]["assertions"] += 1
    if not ok:
        checks[-1]["failures"].append(msg)


def load(name):
    with open(DATA / "clean" / f"{name}.csv") as f:
        return list(csv.DictReader(f))


def sheet(name, tab):
    return list(openpyxl.load_workbook(PSA_2024 / name, read_only=True, data_only=True)[tab].iter_rows(values_only=True))


rows = load("neoplasm_deaths")
deaths = {(int(r["year"]), r["region_code"], r["cause_code"], r["age_group"], r["sex"]): int(r["deaths"]) for r in rows}
names_2024 = {r["region"].upper(): r["region_code"] for r in rows if r["year"] == "2024"}

check("psa-headlines", "PSA headline figures", "PSA 2024 Deaths, textual Table 10 (ten leading causes by sex)")
# 1. Headline figures in PSA's 2024 textual tables (Table 10, ten leading causes by sex).
sex = None
for row in sheet("textual-tables.xlsx", "Table10"):
    label = str(row[0] or "").strip()
    if label in ("BOTH SEXES", "MALE", "FEMALE"):
        sex = label.title()
    elif label == "All causes of death" or label.endswith("Neoplasms"):
        got = deaths[(2024, "PH", "total" if label.startswith("All") else "1-026", "Total", sex)]
        expect(got == row[1], f"Table 10 {label} {sex}: published {row[1]}, clean {got}")

check("psa-table12", "Every cancer death cell, 2024", "PSA 2024 Deaths, statistical Table 12 (region × cause × age × sex)")
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

check("psa-arithmetic", "Death totals add up, 2023 and 2024", "Internal: sites, sexes, age groups and regions sum to their totals")
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

check("population", "Census population adds up", "PSA 2024 Census of Population (incl. footnote a/ on Filipinos abroad)")
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

check("globocan", "GLOBOCAN estimates match IARC", "IARC GLOBOCAN 2024 Philippines fact sheet (PDF)")
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

check("survival", "Survival figures match the papers", "Redaniel 2009 (Br J Cancer) Table 2 and text; Rosario 2025 (Philipp J Oncol) tables and text")
# 6. Survival: clean/survival.csv equals the two papers, and each paper agrees with itself.
import fetch_survival as fs  # noqa: E402 (same directory; reuses its table readers)

surv = load("survival")
got = {(r["age"], r["population"], r["site"]): float(r["pct"]) for r in surv}
table = fs.table2()
expect(len(table) == 9, f"Redaniel Table 2: {len(table)} sites, expected 9")
for row in table:
    (v1, v2, v3), (d1, d2) = row["values"], row["diffs"]
    # The published "Difference" columns are (2)-(1) and (3)-(2); a misread column breaks this.
    expect(abs(v2 - v1 - d1) < 0.15 and abs(v3 - v2 - d2) < 0.15, f"Redaniel {row['site']}: differences don't add up")
    for population, v in zip(fs.POPULATIONS, row["values"]):
        expect(got.get(("adults", population, row["site"])) == v, f"Redaniel {row['site']} {population}: clean differs")
ph = {site: v for (age, population, site), v in got.items() if age == "adults" and population == fs.POPULATIONS[0]}
# The paper's text: thyroid highest (82.4) and leukaemia lowest (5.2) among Philippine residents.
expect((max(ph, key=ph.get), ph.get("Thyroid")) == ("Thyroid", 82.4), "Redaniel: thyroid is not the highest at 82.4")
expect((min(ph, key=ph.get), ph.get("Leukaemia")) == ("Leukaemia", 5.2), "Redaniel: leukaemia is not the lowest at 5.2")

kids = fs.children()
prose = " ".join(fs.child_pdf_text().split())
expect(len(kids) == 6, f"Rosario: {len(kids)} cancer tables, expected 6")
for k in kids:
    expect(int(k["events"]) + int(k["censored"]) == int(k["cases"]), f"Rosario {k['site']}: events + censored != cases")
    expect(round(100 * int(k["censored"]) / int(k["cases"]), 1) == float(k["censored_pct"]),
           f"Rosario {k['site']}: censored % doesn't match its counts")
    # The discussion restates each table's 5-year survival, e.g. "Burkitt's lymphoma (16.7%)".
    expect(re.search(rf"(?i){re.escape(k['site'].split()[0][:7])}.{{0,24}}\({re.escape(k['pct'])}%", prose),
           f"Rosario {k['site']}: {k['pct']}% not restated in the text")
    expect(got.get(("0-19", fs.POPULATIONS[0], k["site"][0].upper() + k["site"][1:])) == float(k["pct"]),
           f"Rosario {k['site']}: clean differs")

print(f"{len(deaths)} death cells ({', '.join(map(str, sorted({k[0] for k in deaths})))}), "
      f"{checked} matched cell-by-cell against PSA 2024 Table 12, {len(pop)} population cells, "
      f"{len(gco)} GLOBOCAN cells ({site_rows} fact-sheet rows matched), {len(surv)} survival rows")


def fetched(path):
    return json.loads((DATA / path).read_text()).get("fetched")


failures = [f for c in checks for f in c["failures"]]
report = {
    "status": "fail" if failures else "pass",
    "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "checks": [{**c, "passed": not c["failures"], "failures": c["failures"][:20]} for c in checks],
    # The server re-hashes these before serving; any edit after this check shows as unverified.
    "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((DATA / "clean").glob("*.csv"))},
    "sources": [
        {"name": "PSA OpenSTAT: registered deaths by region, cause, age and sex, 2023 and 2024",
         "retrieved": fetched("raw/psa/openstat/deaths_cause_2024.json"), "url": "https://openstat.psa.gov.ph"},
        {"name": "PSA 2024 Deaths statistical and textual tables (revision of 2026-02-23)", "retrieved": None,
         "url": "https://psa.gov.ph/statistics/vital-statistics"},
        {"name": "PSA 2024 Census of Population (OpenSTAT)",
         "retrieved": fetched("raw/psa/openstat/population_2024.json"), "url": "https://openstat.psa.gov.ph"},
        {"name": "IARC GLOBOCAN 2024, Philippines", "retrieved": fetched("raw/iarc/globocan-2024/factsheet.json"),
         "url": "https://gco.iarc.who.int/today"},
        {"name": "Redaniel et al., Br J Cancer 2009 (adult survival, CC BY 4.0)", "retrieved": None,
         "url": "https://doi.org/10.1038/sj.bjc.6604945"},
        {"name": "Rosario et al., Philippine Journal of Oncology 2025 (childhood survival)", "retrieved": None,
         "url": "https://www.philsoconc.org/post/population-based-5-year-cancer-survival-study-2006-2017-among-filipino-pediatric-cancer-patients"},
    ],
}
(DATA / "clean" / "validation.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
for c in checks:
    print(f"  {'ok  ' if not c['failures'] else 'FAIL'} {c['title']}: {c['assertions']:,} assertions")
if failures:
    print(f"\n{len(failures)} FAILED", *failures[:25], sep="\n  ")
    sys.exit(0 if "--report-only" in sys.argv else 1)
print("all ground-truth checks passed")
