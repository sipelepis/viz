#!/usr/bin/env python3
"""Ground-truth checks for the education data: the tidy CSVs in clean-education/ must agree with PSA's own
publications (the LFS press release's Table A-1 and Table A, the SDG Watch Goal 4 PDF), with the OpenSTAT
snapshots they were tidied from, and with the papers whose figures the page quotes. Writes
clean-education/validation.json: every check, what it was compared against, its result, and a SHA-256 of
each verified file so whoever serves the data can prove it's unchanged.

    python3 data/check_education.py                # exits non-zero on any mismatch
    python3 data/check_education.py --report-only  # always exits 0 on mismatches; the report carries the verdict

Needs pypdf. The PSA PDFs are read only through fetch_education.pinned() (SHA-256 checked, in gitignored
data/download/); the three papers are committed in raw/education/.
"""
import csv
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pypdf

DATA = Path(__file__).parent
CLEAN = DATA / "clean-education"
CSVS = ("completion", "education_work", "labour_rates", "published_figures")
checks = []


def check(id, title, against):
    """Start a named check; the expect() calls that follow belong to it."""
    checks.append({"id": id, "title": title, "against": against, "assertions": 0, "failures": []})


def expect(ok, msg):
    checks[-1]["assertions"] += 1
    if not ok:
        checks[-1]["failures"].append(msg)


def load(name):
    path = CLEAN / f"{name}.csv"
    if not path.exists():
        sys.exit(f"data/clean-education/{name}.csv is missing; run python3 data/fetch_education.py --offline")
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


# The CSVs come first so that a missing build reports itself as such, whatever else is missing.
rates, work, comp, pub = (load(n) for n in ("labour_rates", "education_work", "completion", "published_figures"))

import fetch_education as fe  # noqa: E402 (same directory)

MEASURES = ("Labor force participation rate", "Employment rate", "Unemployment rate", "Underemployment rate")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
EPS = 1e-9


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def dim(d, prefix):
    """The (key, label) of the variable whose code starts with prefix."""
    return next(v for k, v in d.items() if k.startswith(prefix))


def strip_marks(label):
    return re.sub(r"\s+(?:\d+/|\*+)$", "", label.strip().lstrip(". ")).strip()


def snapshot(table_id):
    """The TABLES snapshot name for an OpenSTAT table id (the SDG ones are named after their titles)."""
    return next(k for k, p in fe.TABLES.items() if p.endswith(f"{table_id}.px"))


def snap_json(name):
    return json.loads((fe.RAW / f"{name}.json").read_text())


# ---------------------------------------------------------------------------------------------------------
check("lfs-headlines", "LFS headline rates match Table A-1",
      "PSA LFS press release, Table A-1 (and Table A precision), and the OpenSTAT key-rates snapshot")
# 1. Every Table A-1 cell is in labour_rates.csv with the same value and status.
a1 = fe.table_a1()
expect(len(a1) > 0, "Table A-1: parsed no cells")
expect({m for _, m in a1} == set(MEASURES), f"Table A-1 measures {sorted({m for _, m in a1})}")
rate = {}
for r in rates:
    k = (r["period"], r["measure"])
    expect(k not in rate, f"labour_rates: duplicate row {k}")
    rate[k] = r
    expect(r["measure"] in MEASURES, f"labour_rates: unknown measure {r['measure']!r}")
    expect(r["frequency"] == ("month" if len(r["period"]) == 7 else "year"), f"labour_rates {k}: frequency {r['frequency']!r}")
    expect(r["status"] in ("final", "preliminary", ""), f"labour_rates {k}: status {r['status']!r}")
for (period, measure), (value, status) in a1.items():
    got = rate.get((period, measure))
    expect(got is not None, f"Table A-1 {period} {measure}: no row in labour_rates.csv")
    if got:
        expect(num(got["value"]) is not None and abs(num(got["value"]) - value) < EPS,
               f"Table A-1 {period} {measure}: published {value}, clean {got['value']}")
        expect(got["status"] == status, f"Table A-1 {period} {measure}: published status {status}, clean {got['status']!r}")
years = sorted({p for p, _ in a1 if len(p) == 4})
months = sorted({p for p, _ in a1 if len(p) == 7})
expect(bool(years) and years[0] == "2019", f"Table A-1: annual figures start {years[:1]}, expected 2019")
expect(bool(months), "Table A-1: no monthly figures")
expect({(p, m) for p in years + months for m in MEASURES} == set(a1), "Table A-1: a period lacks one of the four rates")
# Rows outside Table A-1 carry no status.
for (period, measure), r in rate.items():
    if (period, measure) not in a1:
        expect(r["status"] == "", f"labour_rates {period} {measure}: status {r['status']!r} but not in Table A-1")

# The latest month in labour_rates.csv is the press release's own month (psa-lfs-press-release-YYYY-MM.pdf).
release = [m[1] for n in fe.PINNED if (m := re.fullmatch(r"psa-lfs-press-release-(\d{4}-\d{2})\.pdf", n))]
expect(len(release) == 1, f"PINNED holds {len(release)} LFS press releases, expected 1")
for measure in MEASURES:
    mine = [r["period"] for r in rates if r["measure"] == measure and r["frequency"] == "month"]
    expect(bool(mine) and max(mine) == (release or [None])[0], f"{measure}: latest month {max(mine, default=None)}, press release {release}")
    expect(bool(months) and max(months) == max(mine, default=None), f"{measure}: Table A-1's latest month {max(months, default=None)} differs from clean")
fe.pinned(f"psa-lfs-press-release-{release[0]}.pdf") if release else None  # hash-checked; fails loudly if absent

# Shape: monthly rows from 2005-04 and annual rows from 2006, no gaps, sorted by measure then period.
expect([(r["measure"], r["period"]) for r in rates] == sorted((r["measure"], r["period"]) for r in rates),
       "labour_rates: rows not sorted by measure, then period")
for measure in MEASURES:
    mine = [r for r in rates if r["measure"] == measure]
    expect(bool(mine) and mine[-1]["frequency"] == "month" and mine[-1]["period"] == max(
        r["period"] for r in mine if r["frequency"] == "month"), f"{measure}: last row is not its latest month")
    ms = sorted(r["period"] for r in mine if r["frequency"] == "month")
    ys = sorted(r["period"] for r in mine if r["frequency"] == "year")
    if ms:
        y0, m0 = 2005, 4
        want = []
        while f"{y0}-{m0:02d}" <= ms[-1]:
            want.append(f"{y0}-{m0:02d}")
            y0, m0 = (y0 + 1, 1) if m0 == 12 else (y0, m0 + 1)
        expect(ms == want, f"{measure}: monthly rows are not contiguous from 2005-04 to {ms[-1]}")
    expect(bool(ys) and ys[0] == "2006" and ys == [str(y) for y in range(2006, int(ys[-1]) + 1)],
           f"{measure}: annual rows are not contiguous from 2006 ({ys[:1]}..{ys[-1:]})")

# Confidence intervals: only where Table A publishes 95% bounds for a rate.
ta = fe.table_a()
for (period, measure), (lo, hi) in ta.items():
    r = rate.get((period, measure))
    expect(r is not None, f"Table A {period} {measure}: no row in labour_rates.csv")
    if r:
        expect(num(r["ci_low"]) is not None and abs(num(r["ci_low"]) - lo) < EPS and
               num(r["ci_high"]) is not None and abs(num(r["ci_high"]) - hi) < EPS,
               f"Table A {period} {measure}: published ({lo}, {hi}), clean ({r['ci_low']!r}, {r['ci_high']!r})")
for (period, measure), r in rate.items():
    if (period, measure) not in ta:
        expect(r["ci_low"] == "" and r["ci_high"] == "", f"labour_rates {period} {measure}: CI given but Table A has none")
    if r["ci_low"] != "":
        expect(num(r["ci_low"]) <= num(r["value"]) <= num(r["ci_high"]), f"labour_rates {period} {measure}: value outside its CI")

# Every row is the OpenSTAT key-rates cell (both sexes), and every cell with a value is a row.
snap_rates = {}
for d, v in fe.cells(snapshot("0021B3FKEI2")):
    if dim(d, "Sex")[1].lower() != "both sexes" or v is None:
        continue
    y, mo = dim(d, "Year")[1], dim(d, "Month")[1]
    period = y if mo == "Annual" else f"{y}-{MONTHS.index(mo) + 1:02d}"
    snap_rates[(period, strip_marks(dim(d, "Rate")[1]).capitalize())] = v
for k, v in snap_rates.items():
    r = rate.get(k)  # annual 2005 and months before 2005-04 are outside labour_rates by design
    expect(r is None or (num(r["value"]) is not None and abs(num(r["value"]) - v) < EPS),
           f"OpenSTAT {k}: snapshot {v}, clean {r and r['value']}")
for k, r in rate.items():
    expect(k in snap_rates, f"labour_rates {k}: not a cell of the OpenSTAT snapshot")
    if k in snap_rates:
        expect(num(r["value"]) is not None and abs(num(r["value"]) - snap_rates[k]) < EPS,
               f"OpenSTAT {k}: snapshot {snap_rates[k]}, clean {r['value']}")

# ---------------------------------------------------------------------------------------------------------
check("lfs-education", "Education of the employed and underemployed adds up",
      "OpenSTAT employed and underemployed by highest grade completed (snapshots), and the key rates")
# 2. education_work.csv equals the two snapshots level by level, adds up to their totals, and agrees
#    with the underemployment rate.
raw_cells = {}  # (table, period, level) -> value, with the table's own "Annual" column as the year
level_order = {}
for table in ("0141B3FEMP7", "0151B3FUDR2"):
    name = snapshot(table)
    meta = snap_json(name)["metadata"]["variables"]
    grade = next(v for v in meta if v["code"].startswith("Highest"))
    level_order[table] = [strip_marks(t) for t in grade["valueTexts"]]
    for d, v in fe.cells(name):
        y, mo = dim(d, "Year")[1], dim(d, "Month")[1]
        period = y if mo == "Annual" else f"{y}-{MONTHS.index(mo) + 1:02d}"
        raw_cells[(table, period, strip_marks(dim(d, "Highest")[1]))] = v
expect(level_order["0141B3FEMP7"] == level_order["0151B3FUDR2"], "employed and underemployed snapshots list different levels")
raw_levels = level_order["0141B3FEMP7"]
expect(raw_levels[0] == "Total", f"snapshot's first level is {raw_levels[0]!r}, expected Total")


def decimals(table):
    snap = snap_json(snapshot(table))
    strs = [row["values"][0] for row in snap["data"]["data"]]
    return max((len(s.split(".")[1]) for s in strs if re.fullmatch(r"-?[\d,]*\.\d+", s.strip())), default=0)


by_period = {}
for r in work:
    by_period.setdefault((r["period"], r["frequency"]), []).append(r)
expect(bool(by_period), "education_work: no rows")
first_levels = None
for (period, freq), rs in sorted(by_period.items()):
    expect(freq == ("month" if len(period) == 7 else "year"), f"education_work {period}: frequency {freq!r}")
    levels = [r["level"] for r in sorted(rs, key=lambda r: int(r["level_order"]))]
    first_levels = first_levels or levels
    expect(levels == first_levels, f"education_work {period}: levels {levels} differ from the first period's")
    expect(sorted(int(r["level_order"]) for r in rs) == list(range(len(rs))) or
           sorted(int(r["level_order"]) for r in rs) == list(range(1, len(rs) + 1)), f"education_work {period}: level_order not contiguous")
    expect("Total" not in levels, f"education_work {period}: has a total row")
    expect(levels == [l for l in raw_levels if l in levels], f"education_work {period}: levels not in PSA's order")
    for r in rs:
        e, u = num(r["employed"]), num(r["underemployed"])
        expect(e is not None and u is not None, f"education_work {period} {r['level']}: missing count")
        if e is not None and u is not None:
            expect(u <= e, f"education_work {period} {r['level']}: underemployed {u} > employed {e}")
    # Level by level against the snapshots (the annual figure is the table's own, else the mean of 12 months).
    for col, table in (("employed", "0141B3FEMP7"), ("underemployed", "0151B3FUDR2")):
        tol = 0.5 * 10 ** -decimals(table) + EPS
        for r in rs:
            if len(period) == 7:
                want = raw_cells.get((table, period, r["level"]))
            else:
                want = raw_cells.get((table, period, r["level"]))
                if want is None:
                    ms = [raw_cells.get((table, f"{period}-{m:02d}", r["level"])) for m in range(1, 13)]
                    want = sum(ms) / 12 if all(x is not None for x in ms) else None
            got = num(r[col])
            expect(want is not None and got is not None and abs(got - want) <= tol,
                   f"education_work {period} {r['level']} {col}: snapshot {want}, clean {r[col]}")
    # The levels sum to the table's own total, within rounding.
    for col, table in (("employed", "0141B3FEMP7"), ("underemployed", "0151B3FUDR2")):
        total = raw_cells.get((table, period, "Total"))
        if total is None and len(period) == 4:
            ms = [raw_cells.get((table, f"{period}-{m:02d}", "Total")) for m in range(1, 13)]
            total = sum(ms) / 12 if all(x is not None for x in ms) else None
        s = sum(num(r[col]) or 0 for r in rs)
        tol = (len(rs) + 1) * 0.5 * 10 ** -decimals(table) + EPS
        expect(total is not None and abs(s - total) <= tol, f"education_work {period} {col}: levels sum to {s}, table total {total}")
    # The underemployment rate follows from the counts.
    e = sum(num(r["employed"]) or 0 for r in rs)
    u = sum(num(r["underemployed"]) or 0 for r in rs)
    published = rate.get((period, "Underemployment rate"))
    expect(published is not None and e > 0, f"education_work {period}: no Underemployment rate row in labour_rates.csv")
    if published and e > 0:
        expect(published["frequency"] == freq, f"education_work {period}: labour_rates frequency {published['frequency']!r}")
        expect(abs(100 * u / e - float(published["value"])) <= 0.05 + EPS,
               f"education_work {period}: {100 * u / e:.3f}% from the counts, labour_rates {published['value']}%")
# Periods: every month the snapshots carry, and a year row only for complete years.
for table in ("0141B3FEMP7", "0151B3FUDR2"):
    snap_months = {p for t, p, l in raw_cells if t == table and len(p) == 7 and l == "Total" and raw_cells[(t, p, l)] is not None}
    snap_years = {p[:4] for p in snap_months if all(f"{p[:4]}-{m:02d}" in snap_months for m in range(1, 13))}
    have_months = {p for p, f in by_period if f == "month"}
    have_years = {p for p, f in by_period if f == "year"}
    expect(have_months == snap_months, f"education_work months differ from {table}: {sorted(have_months ^ snap_months)[:6]}")
    expect(have_years == snap_years, f"education_work years differ from {table}'s complete years: {sorted(have_years ^ snap_years)}")

# ---------------------------------------------------------------------------------------------------------
check("sdg-completion", "Completion and survival rates match PSA's SDG Watch",
      "PSA SDG Watch Goal 4 (PDF) for the national rows; the OpenSTAT SDG 4 snapshots for every region")
# 3. completion.csv is the OpenSTAT cells, and its national rows equal the SDG Watch PDF.
# school_year ends in the calendar year the table labels it with (2016, or 2015-2016), the year PSA's SDG Watch uses.
LEVELS = {"Elementary": "Elementary", "Secondary (Junior High School)": "Junior high", "Secondary (Senior High School)": "Senior high"}
SEXES = ("Both Sexes", "Male", "Female")
INDICATORS = {"completion_rate": "0023I3C0412", "cohort_survival_rate": "0033I3C41S1"}


def end_year(school_year):
    m = re.search(r"(\d{4})$", school_year)
    return int(m[1]) if m else None


got = {}
for r in comp:
    k = (end_year(r["school_year"]), r["region_code"], r["level"], r["sex"], r["indicator"])
    expect(k[0] is not None, f"completion: school_year {r['school_year']!r} does not end in a year")
    expect(k not in got, f"completion: duplicate row {k}")
    expect(r["level"] in LEVELS.values() and r["sex"] in SEXES and r["indicator"] in INDICATORS, f"completion: bad row {r}")
    got[k] = num(r["value"])
    expect(got[k] is not None, f"completion {k}: value {r['value']!r} is not a number")

# Every row is an OpenSTAT cell as published (never clamped), and every cell with a value is a row.
regions = {}
for ind, table in INDICATORS.items():
    for d, v in fe.cells(snapshot(table)):
        code, label = fe.region(*dim(d, "Geo"))
        regions[code] = label
        if v is None:
            continue
        lvl = LEVELS[next(k for k in LEVELS if strip_marks(dim(d, "Level")[1]).startswith(k))]
        k = (int(dim(d, "Year")[1]), code, lvl, dim(d, "Sex")[1], ind)
        expect(k in got and got[k] is not None and abs(got[k] - v) < EPS, f"OpenSTAT {k}: snapshot {v}, clean {got.get(k)}")
cells_with_values = sum(1 for ind, table in INDICATORS.items() for _, v in fe.cells(snapshot(table)) if v is not None)
expect(len(comp) == cells_with_values, f"completion: {len(comp)} rows, OpenSTAT has {cells_with_values} cells with values")
expect("PH" in regions, "OpenSTAT snapshot has no national row")

# The latest school year has every region x level for completion_rate, Both Sexes.
latest = max((k[0] for k in got if k[0] is not None), default=None)
rows_latest = {(k[1], k[2]) for k in got if k[0] == latest and k[3] == "Both Sexes" and k[4] == "completion_rate"}
want = {(c, l) for c in regions for l in LEVELS.values()}
expect(want <= rows_latest, f"latest school year {latest}: missing region x level {sorted(want - rows_latest)[:6]}")
expect(len(regions) >= 18 and "PH" in regions, f"regions {sorted(regions)}")

# The national values equal the pinned SDG Watch Goal 4 PDF wherever both carry a school year and sex.
text = "\n".join(p.extract_text() for p in pypdf.PdfReader(fe.pinned("psa-sdg-watch-goal4.pdf")).pages)


def sdg_rows(section):
    """[(baseline, latest, baseline_year, latest_year)] for each national value triple in the section, in print order.
    A row is `<baseline> <latest> 100.0` then three years (baseline, latest, 2030); labels and sources may sit between."""
    toks = section.split()
    out, i = [], 0
    while i < len(toks) - 2:
        if re.fullmatch(r"\d+\.\d", toks[i]) and re.fullmatch(r"\d+\.\d", toks[i + 1]) and toks[i + 2] == "100.0":
            years = []
            for t in toks[i + 3:]:
                if re.fullmatch(r"20\d\d", t):
                    years.append(int(t))
                    if len(years) == 3:
                        break
                elif re.fullmatch(r"\d+\.\d", t):
                    break
            if len(years) == 3:
                out.append((float(toks[i]), float(toks[i + 1]), years[0], years[1]))
            i += 3
        else:
            i += 1
    return out


head = {ind: re.search(rf"4\.1\.\S+\s+{pat}", text, re.I) for ind, pat in
        (("completion_rate", "Completion Rate"), ("cohort_survival_rate", "Cohort Survival Rate"))}
expect(all(head.values()), "SDG Watch PDF: cannot find the Completion Rate and Cohort Survival Rate headings")
if all(head.values()):
    c0, s0 = head["completion_rate"].start(), head["cohort_survival_rate"].start()
    after = re.search(r"\n4\.1\.\S+\s+Dropout|\n4\.2\.", text[s0:], re.I)
    sections = {"completion_rate": text[c0:s0] if c0 < s0 else text[c0:],
                "cohort_survival_rate": text[s0:s0 + after.start()] if after else text[s0:]}
    order = [(l, s) for l in LEVELS.values() for s in ("Both Sexes", "Female", "Male")]  # the PDF lists both, female, male
    compared = {l: 0 for l in LEVELS.values()}
    for ind, section in sections.items():
        rows = sdg_rows(section)
        expect(len(rows) == 9, f"SDG Watch PDF {ind}: parsed {len(rows)} national rows, expected 9 (3 levels x 3 sexes)")
        for (lvl, sex), (b, l, by, ly) in zip(order, rows):
            for year, value in ((by, b), (ly, l)):
                have = got.get((year, "PH", lvl, sex, ind))
                if have is None:
                    continue  # the table does not carry that school year
                compared[lvl] += ind == "completion_rate"
                expect(abs(have - value) < EPS, f"SDG Watch {ind} {lvl} {sex} {year}: published {value}, clean {have}")
    for lvl, n in compared.items():
        expect(n >= 1, f"SDG Watch PDF: no completion_rate comparison for {lvl}")

# ---------------------------------------------------------------------------------------------------------
check("published-figures", "Quoted figures appear in their sources",
      "World Bank PRWP 11163, PIDS Policy Note 2024-09, Melchor 2022 (Philippine Journal of Development)")
# 4. Each quote that points at a committed paper occurs in that paper's text and contains its figure.
EXPECTED = {  # id -> (value, kind, section or None where the spec leaves it open, checked_against)
    "wb-unemployment-college-25-34": (6.7, "published_estimate", "gap", "raw/education/wb-prwp-11163.pdf"),
    "wb-unemployment-less-25-34": (4.4, "published_estimate", "gap", "raw/education/wb-prwp-11163.pdf"),
    "wb-earnings-premium-2024": (80, "published_estimate", "gap", "raw/education/wb-prwp-11163.pdf"),
    "pids-return-college-2010": (141.4, "published_estimate", "gap", "raw/education/pids-pn-2024-09.pdf"),
    "pids-return-college-2022": (93.7, "published_estimate", "gap", "raw/education/pids-pn-2024-09.pdf"),
    "jobstreet-alma-mater-2014": (77, "employer_self_report", "employers", ""),
    "jobstreet-alma-mater-2015": (71, "employer_self_report", "employers", ""),
    "jobstreet-alma-mater-2016": (62, "employer_self_report", "employers", ""),
    "jobstreet-2023-pup": (23, "employer_self_report", "employers", ""),
    "pbed-2024-college-share": (73, "employer_self_report", "employers", ""),
    "melchor-2022-overeducated": (39, "study_estimate", None, "raw/education/melchor-2022-pjd.pdf"),
}
KINDS = {"published_estimate", "employer_self_report", "study_estimate"}


def norm(s):
    s = unicodedata.normalize("NFKC", s).replace("­", "")
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return " ".join(s.split())


papers = {}
ids = [r["id"] for r in pub]
expect(len(ids) == len(set(ids)), "published_figures: ids are not unique")
expect(set(ids) == set(EXPECTED), f"published_figures ids: missing {sorted(set(EXPECTED) - set(ids))}, unexpected {sorted(set(ids) - set(EXPECTED))}")
for r in pub:
    i = r["id"]
    expect(r["kind"] in KINDS, f"{i}: kind {r['kind']!r}")
    expect(r["section"] in ("gap", "employers"), f"{i}: section {r['section']!r}")
    for col in ("url", "year", "sample", "quote", "source", "figure", "unit", "population"):
        expect(r[col].strip() != "", f"{i}: {col} is blank")
    expect(r["url"].startswith("https://"), f"{i}: url {r['url']!r}")
    expect(num(r["year"]) is not None, f"{i}: year {r['year']!r}")
    if i in EXPECTED:
        value, kind, section, against = EXPECTED[i]
        expect(num(r["value"]) == value, f"{i}: value {r['value']!r}, expected {value}")
        expect(r["kind"] == kind, f"{i}: kind {r['kind']!r}, expected {kind}")
        expect(section is None or r["section"] == section, f"{i}: section {r['section']!r}, expected {section}")
        expect(r["checked_against"] == against, f"{i}: checked_against {r['checked_against']!r}, expected {against!r}")
    if r["checked_against"]:
        path = DATA / r["checked_against"]
        expect(path.exists(), f"{i}: {r['checked_against']} is not committed")
        if path.exists():
            if path not in papers:
                papers[path] = norm(" ".join(p.extract_text() for p in pypdf.PdfReader(path).pages))
            expect(norm(r["quote"]) in papers[path], f"{i}: quote not found in {r['checked_against']}")
            expect(num(r["value"]) is not None and f"{num(r['value']):g}" in r["quote"], f"{i}: {r['value']} not in its quote")

# ---------------------------------------------------------------------------------------------------------
print(f"{len(rates)} rate rows, {len(work)} education rows, {len(comp)} completion rows, {len(pub)} published figures")


def fetched(name):
    return snap_json(name).get("fetched")


def source(name):
    path = fe.TABLES[name]
    dirs, table = path.split("/")[:-1], path.split("/")[-1].removesuffix(".px")
    snap = snap_json(name)
    return {"name": snap["title"], "retrieved": snap.get("fetched"), "table": table,
            "url": f"https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__{'__'.join(dirs)}/{table}.px/",
            "notes": snap.get("notes", [])}


failures = [f for c in checks for f in c["failures"]]
report = {
    "status": "fail" if failures else "pass",
    "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "checks": [{**c, "passed": not c["failures"], "failures": c["failures"][:20]} for c in checks],
    # The server re-hashes these before serving; any edit after this check shows as unverified.
    "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(CLEAN.glob("*.csv"))},
    "sources": [source(n) for n in fe.TABLES] + [
        {"name": n, "retrieved": None, "url": url} for n, (url, _) in fe.PINNED.items()] + [
        {"name": Path(a).name, "retrieved": None, "url": u}
        for a, u in sorted({(r["checked_against"], r["url"]) for r in pub if r["checked_against"]})],
}
(CLEAN / "validation.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
for c in checks:
    print(f"  {'ok  ' if not c['failures'] else 'FAIL'} {c['title']}: {c['assertions']:,} assertions")
if failures:
    print(f"\n{len(failures)} FAILED", *failures[:25], sep="\n  ")
    sys.exit(0 if "--report-only" in sys.argv else 1)
print("all ground-truth checks passed")
