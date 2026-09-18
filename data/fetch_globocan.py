#!/usr/bin/env python3
"""Snapshot the GLOBOCAN (IARC Global Cancer Observatory) Philippines fact sheet into
raw/iarc/globocan-<year>/ and derive clean/globocan.csv.

    python3 data/fetch_globocan.py            # fetch, then tidy
    python3 data/fetch_globocan.py --offline  # re-tidy from the saved snapshot

Stdlib only. The JSON API is undocumented (spec: https://gco-api.iarc.fr/api/openapi.json).
"""
import csv
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

YEAR = 2024  # GLOBOCAN edition. Editions use different methods: never trend across them.
API = f"https://gco-api.iarc.fr/api/globocan/v3/{YEAR}/"
PDF = "https://gco.iarc.who.int/media/globocan/factsheets/populations/608-philippines-fact-sheet.pdf"
DATA = Path(__file__).parent
RAW = DATA / f"raw/iarc/globocan-{YEAR}"
CLEAN = DATA / "clean"

MEASURES = {0: "incidence", 1: "mortality", 2: "prevalence_5y"}
SEXES = {0: "Both Sexes", 1: "Male", 2: "Female"}
ALL = 39  # All cancers, C00-97 (includes non-melanoma skin cancer, code 17)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def fetch():
    RAW.mkdir(parents=True, exist_ok=True)
    sheet = json.loads(get(API + "factsheet/population/608/"))
    sheet["fetched"] = date.today().isoformat()
    (RAW / "factsheet.json").write_text(json.dumps(sheet, ensure_ascii=False, indent=1))
    (RAW / "cancers.json").write_text(json.dumps(json.loads(get(API + "meta/cancers/all/")), ensure_ascii=False, indent=1))
    (RAW / "fact-sheet.pdf").write_bytes(get(PDF))
    print(f"fetched GLOBOCAN {YEAR}: {len(sheet['dataset']) + len(sheet['extra'])} rows")


def tidy():
    sheet = json.loads((RAW / "factsheet.json").read_text())
    cancers = {c["cancer"]: c for c in json.loads((RAW / "cancers.json").read_text())}
    cells = {(r["type"], r["sex"], r["cancer_code"]): r for r in sheet["dataset"] + sheet["extra"]}
    rows = [[YEAR, MEASURES[t], SEXES[s], code, cancers[code]["label"], cancers[code]["ICD"],
             r["total"], r["asr"], r["crude_rate"], r["cum_risk_74"], r.get("rank", "")]
            for (t, s, code), r in sorted(cells.items())]
    # Sites 1-36 are itemised; 37 (other specified) and 38 (unspecified) are not. Add their
    # combined count so each measure x sex sums to all cancers.
    for t in MEASURES:
        for s in SEXES:
            sites = sum(r["total"] for (tt, ss, c), r in cells.items() if (tt, ss) == (t, s) and c <= 36)
            rows.append([YEAR, MEASURES[t], SEXES[s], "37+38", "Other and unspecified sites (derived)",
                         "OTH, C76-80, C96-97", cells[(t, s, ALL)]["total"] - sites, "", "", "", ""])
    CLEAN.mkdir(exist_ok=True)
    with open(CLEAN / "globocan.csv", "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["year", "measure", "sex", "cancer_code", "cancer", "icd10", "count", "asr_world",
                    "crude_rate", "cum_risk_74", "rank"])
        w.writerows(rows)
    print(f"wrote clean/globocan.csv: {len(rows)} rows")


if __name__ == "__main__":
    if "--offline" not in sys.argv:
        fetch()
    tidy()
