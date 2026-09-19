#!/usr/bin/env python3
"""Snapshot the published Philippine cancer survival studies into raw/survival/ and derive
clean/survival.csv. The Philippines has no survival data in CONCORD-3 or SURVCAN-3; these two
papers are the population-based figures that exist (Manila and Rizal cancer registries).

    python3 data/fetch_survival.py            # fetch, then tidy
    python3 data/fetch_survival.py --offline  # re-tidy from the saved snapshots

Needs pypdf (for the paediatric PDF).
"""
import csv
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

DATA = Path(__file__).parent
RAW = DATA / "raw/survival"
CLEAN = DATA / "clean"

# Redaniel et al., Br J Cancer 2009;100:858-62, doi:10.1038/sj.bjc.6604945 (CC BY 4.0), Table 2.
ADULT_XML = RAW / "redaniel-2009-bjc.xml"
ADULT_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=2653748"
# Rosario et al., Philipp J Oncol 2025;1(1):e004, Philippine Cancer Society.
CHILD_PDF = RAW / "rosario-2025-pjo.pdf"
CHILD_URL = "https://941b1631-8e7e-4428-9e88-9ceb26b44e2d.usrfiles.com/ugd/941b16_cc52089a076c4a0fa3d54e2a86399608.pdf"

POPULATIONS = ["Philippine residents", "Filipino-Americans (US SEER)", "Caucasians (US SEER)"]


def get(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        path.write_bytes(r.read())
    print(f"fetched {path.name}")


def text(el):
    return " ".join("".join(el.itertext()).split())


def table2():
    """Rows of Table 2 as {site, values: [3 populations], se: [...], diffs: [(2)-(1), (3)-(2)]}."""
    root = ET.parse(ADULT_XML).getroot()
    table = next(t for t in root.iter("table-wrap") if text(t.find("label")) == "Table 2")
    rows = []
    for tr in table.iter("tr"):
        tds = [c for c in tr if c.tag in ("td", "th")]
        cells = [text(c) for c in tds]
        if len(cells) != 11 or not re.fullmatch(r"[\d.]+", cells[1]):
            continue  # header rows
        num = lambda s: float(s.replace("−", "-"))
        rows.append({
            # drop footnote refs, e.g. Thyroid<xref>a</xref> (a = ICSS standard)
            "site": text(tds[0]).removesuffix("".join(text(x) for x in tds[0].iter("xref"))).strip(),
            "values": [num(cells[1]), num(cells[5]), num(cells[9])],
            "se": [num(cells[2]), num(cells[6]), num(cells[10])],
            "diffs": [num(cells[3]), num(cells[7])],
        })
    return rows


def child_pdf_text():
    import pypdf
    return "\n".join(p.extract_text() for p in pypdf.PdfReader(CHILD_PDF).pages)


# "All cases 1427 649 778 (54.5%) 19.9 11.6" -> cases, events, censored, censored %, [≤]5-yr %, median months
CHILD_ROW = re.compile(
    r"Table \d+\.? +Childhood (.+?) survival, RCR,? and MCR, 2006-2017\..*?"
    r"All cases (\d+) (\d+) (\d+) \(([\d.]+)%\) (≤?)([\d.]+)%? ([\d.]+)", re.S)


def children():
    keys = ("site", "cases", "events", "censored", "censored_pct", "bound", "pct", "median_months")
    return [dict(zip(keys, m.groups())) for m in CHILD_ROW.finditer(child_pdf_text())]


def tidy():
    header = ["source", "population", "place", "period", "age", "site", "measure", "pct", "bound", "se",
              "cases", "censored_pct"]
    rows = []
    for r in table2():
        for pop, v, se in zip(POPULATIONS, r["values"], r["se"]):
            rows.append(["Redaniel 2009, Br J Cancer", pop,
                         "Metro Manila" if pop == POPULATIONS[0] else "United States", "1998-2002", "adults",
                         r["site"], "5-year relative survival, age-standardised (period analysis)", v, "", se, "", ""])
    for r in children():
        rows.append(["Rosario 2025, Philipp J Oncol", "Philippine residents", "Metro Manila", "2006-2017", "0-19",
                     r["site"][0].upper() + r["site"][1:], "5-year observed survival", float(r["pct"]), r["bound"],
                     "", int(r["cases"]), float(r["censored_pct"])])
    CLEAN.mkdir(exist_ok=True)
    with open(CLEAN / "survival.csv", "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    print(f"wrote clean/survival.csv: {len(rows)} rows")


if __name__ == "__main__":
    if "--offline" not in sys.argv:
        RAW.mkdir(parents=True, exist_ok=True)
        get(ADULT_URL, ADULT_XML)
        get(CHILD_URL, CHILD_PDF)
    tidy()
