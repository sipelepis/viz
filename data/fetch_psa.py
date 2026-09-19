#!/usr/bin/env python3
"""Snapshot PSA OpenSTAT tables into raw/psa/openstat/ and derive tidy CSVs in clean/.

    python3 data/fetch_psa.py            # fetch from the API, then tidy
    python3 data/fetch_psa.py --offline  # re-tidy from the saved snapshots

Stdlib only. OpenSTAT is a PX-Web instance: GET <table> returns its variables,
POST <table> with a selection returns the cells.
"""
import csv
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

API = "https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB/"
DATA = Path(__file__).parent
RAW = DATA / "raw/psa/openstat"
CLEAN = DATA / "clean"

# Mortality Tabulation List 1 (ICD-10): 1-026 Neoplasms and its sites 1-027..1-047.
NEOPLASM = re.compile(r"1-0(2[6-9]|3\d|4[0-7])\b")
CAUSE = re.compile(r"(1-\d{3}) (.+?)(?: ((?:[A-Z]\d\d(?:-[A-Z]\d\d)?[ ,]*)+))?$")  # ICD codes are space-separated

DEATHS = {  # year -> "Registered deaths by age group, sex, region of usual residence and cause"
    2024: "1A/VS/DE/0131A1BDEE7.px",
    2023: "1A/VS/DE/0481A1ADEB2.px",
}
POPULATION = {  # 2024 Census of Population (POPCEN), as of 1 July 2024
    "population_2024": "1A/PO_2024/0191A6DTHP8.px",  # total/household population by region
    "household_population_age_sex_2024": "1A/PO_2024/0201A6DPAG0.px",
}


def call(path, query=None):
    body = json.dumps(query).encode() if query else None
    # OpenSTAT answers 403 to Python's default User-Agent.
    req = urllib.request.Request(API + path, body, {"Content-Type": "application/json", "User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8-sig"))


def is_geo(code):
    return code.startswith("Geo")


def keep(var, text):
    if is_geo(var):  # national, regions and "foreign country"; drop provinces/cities
        return not text.startswith("....")
    if var == "Cause of Death":
        return text.lower() == "total" or bool(NEOPLASM.search(text))
    return True


def fetch(name, path):
    meta = call(path)
    query = [
        {"code": v["code"], "selection": {"filter": "item", "values": [
            c for c, t in zip(v["values"], v["valueTexts"]) if keep(v["code"], t)]}}
        for v in meta["variables"]
    ]
    data = call(path, {"query": query, "response": {"format": "json"}})
    snap = {"table": API + path, "title": meta["title"], "fetched": date.today().isoformat(),
            "metadata": meta, "data": data}
    (RAW / f"{name}.json").write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")))
    print(f"fetched {name}: {len(data['data'])} cells")


def cells(name):
    """Yield ({variable: (code, label)}, value) for every cell of a saved snapshot."""
    snap = json.loads((RAW / f"{name}.json").read_text())
    labels = {v["code"]: dict(zip(v["values"], v["valueTexts"])) for v in snap["metadata"]["variables"]}
    dims = [c["code"] for c in snap["data"]["columns"] if c["type"] != "c"]
    for row in snap["data"]["data"]:
        raw = row["values"][0].strip()
        # PSA notation: "-" is zero; ".." and "..." are not available.
        value = 0 if raw == "-" else None if raw.strip(".") == "" else float(raw)
        yield {d: (k, labels[d][k]) for d, k in zip(dims, row["key"])}, value


def region(code, label):
    if code in ("608", "0000000000"):
        return "PH", "Philippines"
    if code == "9999999999":
        return "foreign", "Foreign country"
    return code, re.sub(r"\s+(?:\d+/|\*+)$", "", label.lstrip(". "))  # drop footnote marks such as " 3/"


def age(label):
    label = re.sub(r"\s*-\s*", "-", label.strip()).replace(" Over", " over")
    return "Total" if label == "All Ages" else label


def number(value):
    return int(value) if value is not None and value.is_integer() else value


def write(name, header, rows):
    with open(CLEAN / f"{name}.csv", "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    print(f"wrote clean/{name}.csv: {len(rows)} rows")


def tidy():
    rows, icd = [], {}
    for year in DEATHS:
        for d, value in cells(f"deaths_cause_{year}"):
            geo = next(v for k, v in d.items() if is_geo(k))
            cause = d["Cause of Death"][1].lstrip(". ")
            if cause.lower() == "total":
                code, name = "total", "All causes"
            else:
                code, name, codes = CAUSE.match(cause).groups()
                icd[code] = codes or icd.get(code)
            rows.append([year, *region(*geo), code, name, age(d["Age Group"][1]), d["Sex"][1], number(value)])
    # Only the 2023 labels carry ICD-10 ranges; the tabulation list is the same in both years.
    rows = [r[:5] + [icd.get(r[3]) or ""] + r[5:] for r in rows]
    write("neoplasm_deaths", ["year", "region_code", "region", "cause_code", "cause", "icd10",
                              "age_group", "sex", "deaths"], rows)

    pop = {}
    for name in POPULATION:
        for d, value in cells(name):
            geo = next(v for k, v in d.items() if is_geo(k))
            row = (2024, *region(*geo), d["Parameter"][1] if "Parameter" in d else "Household Population",
                   age(d["Age Group"][1]) if "Age Group" in d else "Total",
                   d["Sex"][1] if "Sex" in d else "Both Sexes")
            key = row[:2] + row[3:]  # both tables report total household population by region
            if key in pop and pop[key][-1] != number(value):
                sys.exit(f"{name} disagrees with an earlier table on {key}: {pop[key][-1]} vs {value}")
            pop[key] = [*row, number(value)]
    write("population", ["year", "region_code", "region", "measure", "age_group", "sex", "value"], list(pop.values()))


if __name__ == "__main__":
    if "--offline" not in sys.argv:
        RAW.mkdir(parents=True, exist_ok=True)
        for year, path in DEATHS.items():
            fetch(f"deaths_cause_{year}", path)
        for name, path in POPULATION.items():
            fetch(name, path)
    CLEAN.mkdir(exist_ok=True)
    tidy()
