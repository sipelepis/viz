#!/usr/bin/env python3
"""Ground-truth checks: the tidy CSVs in clean/ must agree with PSA's own publications
and add up internally. Exits non-zero on any mismatch.

    python3 data/check.py    (needs openpyxl for the PSA workbooks)
"""
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl

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

print(f"{len(deaths)} death cells ({', '.join(map(str, sorted({k[0] for k in deaths})))}), "
      f"{checked} matched cell-by-cell against PSA 2024 Table 12, {len(pop)} population cells")
if failures:
    print(f"\n{len(failures)} FAILED", *failures[:25], sep="\n  ")
    sys.exit(1)
print("all ground-truth checks passed")
