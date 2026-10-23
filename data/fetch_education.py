#!/usr/bin/env python3
"""Snapshot the PSA tables behind the education page into raw/psa/openstat/ and derive tidy CSVs in
clean-education/: the LFS headline rates, employed and underemployed people by highest grade completed,
SDG 4 completion and cohort survival rates by region, and the published figures the page quotes.

    python3 data/fetch_education.py             # refetch the OpenSTAT tables, download missing PSA PDFs, tidy
    python3 data/fetch_education.py --download  # download the pinned PSA PDFs only
    python3 data/fetch_education.py --offline   # re-tidy from the snapshots and pinned PDFs, no network

Stdlib only for now. The PSA files (the SDG Watch, and the LFS release once pinned) are not committed: they
live in gitignored download/, pinned by SHA-256. psa.gov.ph puts scripts behind a Cloudflare challenge, so
--download falls back to a mirror where PINNED has one; when that fails too, save the file from a browser to
the path it prints.
"""
import csv
import functools
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

from fetch_psa import API, cells, fetch, region as psa_region  # cells is re-exported for check_education.py

DATA = Path(__file__).parent
RAW = DATA / "raw/psa/openstat"
PAPERS = DATA / "raw/education"
DOWNLOAD = DATA / "download"
CLEAN = DATA / "clean-education"

TABLES = {  # snapshot name -> PxWeb path under API
    "lfs_key_rates": "1B/LFS/0021B3FKEI2.px",  # Rates Key Employment Indicators: April 2005 to <latest month>
    "lfs_employed_by_grade": "1B/LFS/0141B3FEMP7.px",  # Employed Persons by Highest Grade Completed (2017 PSCED)
    "lfs_underemployed_by_grade": "1B/LFS/0151B3FUDR2.px",  # Underemployed Persons by Highest Grade Completed
    "sdg_completion_rate": "3I/G04/0023I3C0412.px",  # SDG 4.1.2 Completion rate, by region (DepEd EBEIS)
    "sdg_cohort_survival_rate": "3I/G04/0033I3C41S1.px",  # SDG 4.1.s1 Cohort survival rate, by region
}

PINNED = {  # file in download/ -> (url, sha256)
    # PSA's national 2024 Consolidated SDG Watch, as of 24 March 2025 (submissions as of 28 February 2025).
    "psa-sdg-watch-goal4.pdf": ("https://psa.gov.ph/system/files/phdsd/2024%20Consolidated%20Watch_24Mar2025_0.pdf",
                                "49209e0d2225d052cb1115278d50401bb945ba47dcace88a890c70aa6dcdf8d1"),
}
MIRRORS = {  # file -> a copy of the same bytes that scripts can reach when psa.gov.ph serves its challenge
    "psa-sdg-watch-goal4.pdf": "https://web.archive.org/web/20250701232932id_/https://psa.gov.ph/system/files/phdsd/"
                               "2024%20Consolidated%20Watch_24Mar2025_0.pdf",
}
LFS_PAGE = "https://psa.gov.ph/statistics/labor-force-survey"

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
MEASURES = ("Labor force participation rate", "Employment rate", "Unemployment rate", "Underemployment rate")
# PSA lists each level's subtotal before its parts (Elementary, then Elementary Undergraduate and Elementary
# Graduate). Dropping the subtotals keeps the parts, which partition the employed.
SUBTOTALS = {"Total", "Elementary", "Junior High School", "Senior High School", "Post Secondary", "College"}
SCHOOL_LEVELS = {"Elementary": "Elementary", "Secondary (Junior High School)": "Junior high",
                 "Secondary (Senior High School)": "Senior high"}
PSGC = {  # the cohort-survival table numbers its regions 0..18; the completion table uses these PSGC codes
    "PHILIPPINES": "0000000000", "NCR": "1300000000", "CAR": "1400000000", "Region I": "0100000000",
    "Region II": "0200000000", "Region III": "0300000000", "Region IV-A": "0400000000",
    "MIMAROPA Region": "1700000000", "Region V": "0500000000", "Region VI": "0600000000", "NIR": "1800000000",
    "Region VII": "0700000000", "Region VIII": "0800000000", "Region IX": "0900000000", "Region X": "1000000000",
    "Region XI": "1100000000", "Region XII": "1200000000", "Region XIII": "1600000000", "BARMM": "1900000000",
}

PUBLISHED = [  # quoted figures; a news article is kept only as its URL and the sentence quoted from it
    {"id": "wb-unemployment-college-25-34", "section": "gap",
     "figure": "Unemployment rate of college graduates aged 25–34", "value": 6.7, "unit": "percent",
     "measure": "unemployment rate", "population": "college graduates aged 25–34", "year": 2024,
     "sample": "not published", "kind": "published_estimate",
     "source": "Belghith, Fernandez and Lavin (2025), Inequality, Education, and Occupational Change in the "
               "Philippines, World Bank Policy Research Working Paper 11163",
     "url": "https://openknowledge.worldbank.org/entities/publication/dec2239c-5836-4312-b596-bc5058b15512",
     "quote": "In 2024, the unemployment rate among youth college graduates aged 25 to 34 stood at 6.7 percent, "
              "significantly higher than the 4.4 percent recorded for their peers with lower levels of education.",
     "checked_against": "raw/education/wb-prwp-11163.pdf"},
    {"id": "wb-unemployment-less-25-34", "section": "gap",
     "figure": "Unemployment rate of people aged 25–34 with less education", "value": 4.4, "unit": "percent",
     "measure": "unemployment rate", "population": "people aged 25–34 who did not finish college", "year": 2024,
     "sample": "not published", "kind": "published_estimate",
     "source": "Belghith, Fernandez and Lavin (2025), Inequality, Education, and Occupational Change in the "
               "Philippines, World Bank Policy Research Working Paper 11163",
     "url": "https://openknowledge.worldbank.org/entities/publication/dec2239c-5836-4312-b596-bc5058b15512",
     "quote": "In 2024, the unemployment rate among youth college graduates aged 25 to 34 stood at 6.7 percent, "
              "significantly higher than the 4.4 percent recorded for their peers with lower levels of education.",
     "checked_against": "raw/education/wb-prwp-11163.pdf"},
    {"id": "wb-earnings-premium-2024", "section": "gap",
     "figure": "How much more college graduates earn than high school graduates", "value": 80,
     "unit": "percent more", "measure": "average earnings, college graduates against high school graduates",
     "population": "wage earners", "year": 2024, "sample": "not published", "kind": "published_estimate",
     "source": "Belghith, Fernandez and Lavin (2025), Inequality, Education, and Occupational Change in the "
               "Philippines, World Bank Policy Research Working Paper 11163",
     "url": "https://openknowledge.worldbank.org/entities/publication/dec2239c-5836-4312-b596-bc5058b15512",
     "quote": "In that year, the average college graduate earned 80 percent more than the average high school "
              "graduate, while workers with some college education earned 53 percent more.",
     "checked_against": "raw/education/wb-prwp-11163.pdf"},
    {"id": "pids-return-college-2010", "section": "gap",
     "figure": "Hourly-wage return to a college degree, against no grade completed", "value": 141.4,
     "unit": "percent", "measure": "OLS return to log hourly wage, college graduates against no grade completed",
     "population": "salaried workers", "year": 2010,
     "sample": "621,638 individuals, LFS October rounds 2005–2022", "kind": "published_estimate",
     "source": "Albert, Punongbayan and Muñoz (2024), Returns to education in the Philippines (2005–2022): "
               "Declining benefits, increased inequities, PIDS Policy Note 2024-09",
     "url": "https://pidswebs.pids.gov.ph/CDN/document/pidspn2409.pdf",
     "quote": "The returns for college graduates declined from 141.4 percent in 2010 to 93.7 percent in 2022, "
              "compared to those with no grade completed.",
     "checked_against": "raw/education/pids-pn-2024-09.pdf"},
    {"id": "pids-return-college-2022", "section": "gap",
     "figure": "Hourly-wage return to a college degree, against no grade completed", "value": 93.7,
     "unit": "percent", "measure": "OLS return to log hourly wage, college graduates against no grade completed",
     "population": "salaried workers", "year": 2022,
     "sample": "621,638 individuals, LFS October rounds 2005–2022", "kind": "published_estimate",
     "source": "Albert, Punongbayan and Muñoz (2024), Returns to education in the Philippines (2005–2022): "
               "Declining benefits, increased inequities, PIDS Policy Note 2024-09",
     "url": "https://pidswebs.pids.gov.ph/CDN/document/pidspn2409.pdf",
     "quote": "The returns for college graduates declined from 141.4 percent in 2010 to 93.7 percent in 2022, "
              "compared to those with no grade completed.",
     "checked_against": "raw/education/pids-pn-2024-09.pdf"},
    {"id": "jobstreet-alma-mater-2014", "section": "employers",
     "figure": "Employers who say a fresh graduate's school matters", "value": 77, "unit": "percent",
     "measure": "share of employers placing high importance on the graduate's university",
     "population": "employers surveyed by JobStreet Philippines", "year": 2014, "sample": "400 employers",
     "kind": "employer_self_report",
     "source": "JobStreet.com Philippines, Fresh Graduates 2014 Job & Salary Report, as reported by Rappler",
     "url": "https://www.rappler.com/business/54866-fresh-graduates-employers-survey-jobstreet/",
     "quote": "Over three-fourths, or 77%, of the 400 top employers in the country surveyed by the online "
              "recruitment company admitted that they still place high importance on which university the "
              "graduates come from",
     "checked_against": ""},
    # Rappler moved this article; its old …/87798-fresh-graduates-employers-… address is a 404.
    {"id": "jobstreet-alma-mater-2015", "section": "employers",
     "figure": "Employers who say a fresh graduate's school matters", "value": 71, "unit": "percent",
     "measure": "share of employers who consider the graduate's alma mater important",
     "population": "employers surveyed by JobStreet Philippines", "year": 2015, "sample": "about 450 employers",
     "kind": "employer_self_report",
     "source": "JobStreet.com Philippines, 2015 Fresh Graduates report, as reported by Rappler",
     "url": "https://www.rappler.com/life-and-style/careers/87798-fresh-grads-employers-companies-school-college-jobstreet-2015/",
     "quote": "That 62% of employers consider an alma mater important in 2016 is a drop from 71% in the survey "
              "conducted in 2015, which in turn was a drop from 77% in 2014.",
     "checked_against": ""},
    {"id": "jobstreet-alma-mater-2016", "section": "employers",
     "figure": "Employers who say a fresh graduate's school matters", "value": 62, "unit": "percent",
     "measure": "share of employers who gave importance to the graduate's alma mater (62.27%)",
     "population": "employers surveyed by JobStreet Philippines", "year": 2016, "sample": "551 companies",
     "kind": "employer_self_report",
     "source": "JobStreet.com Philippines, 2016 Fresh Graduates Salary report, as reported by Rappler",
     "url": "https://www.rappler.com/life-and-style/careers/87798-fresh-grads-employers-companies-school-college-jobstreet-2015/",
     "quote": "551 companies were surveyed in February 2016 over a period of two weeks. According to the report, "
              "62.27% of employers surveyed “gave importance to a fresh graduate’s alma mater.”",
     "checked_against": ""},
    {"id": "jobstreet-2023-pup", "section": "employers",
     "figure": "Employers who source most of their hires from PUP", "value": 23, "unit": "percent",
     "measure": "share of employers naming PUP as the school where they source most candidates "
                "(UP tops their wish list)",
     "population": "employers surveyed by JobStreet Philippines", "year": 2023,
     "sample": "more than 700 companies in 42 industries", "kind": "employer_self_report",
     "source": "JobStreet Philippines, 2023 employer survey, as reported by Philstar.com",
     "url": "https://www.philstar.com/headlines/2023/07/03/2278351/pup-still-top-source-hireable-graduates-survey",
     "quote": "According to a new study by JobStreet, PUP was able to retain its top position as the school "
              "“where most employers source their candidates” at 23%.",
     "checked_against": ""},
    {"id": "pbed-2024-college-share", "section": "employers",
     "figure": "Entry-level jobs employers expect to fill with college graduates", "value": 73,
     "unit": "percent", "measure": "share of projected entry-level hires going to college graduates "
                                   "(12,544 of 17,273, rounded)",
     "population": "firms surveyed by Philippine Business for Education", "year": 2024,
     "sample": "299 firms, purposive sample", "kind": "employer_self_report",
     "source": "Philippine Business for Education (PBEd), 2024 Jobs Outlook for K-12 Graduates, as reported by "
               "BusinessWorld",
     "url": "https://www.bworldonline.com/top-stories/2024/07/11/607324/more-firms-willing-to-hire-k-12-grads-but-prefer-college-finishers/",
     "quote": "Employers expect that 12,544 of their 17,273 entry-level jobs would be filled by college graduates "
              "this year.",
     "checked_against": ""},
    {"id": "melchor-2022-overeducated", "section": "employers",
     "figure": "Employed people with more schooling than their job requires", "value": 39, "unit": "percent",
     "measure": "job analysis (years of schooling the occupation requires)",
     "population": "employed people, merged LFS and FIES data for 2006 and 2012", "year": 2022,
     "sample": "about 50,000 households per survey round", "kind": "study_estimate",
     "source": "Melchor (2022), Surveying the Extent and Wage Consequences of Education-Job Mismatches in the "
               "Philippine Labor Market, Philippine Journal of Development 46(1)",
     "url": "https://doi.org/10.62986/pjd2022.46.1d",
     "quote": "The results find that 39 percent of employed individuals are overeducated while over a quarter "
              "are undereducated.",
     "checked_against": "raw/education/melchor-2022-pjd.pdf"},
]


def strip_marks(label):
    """'..Region IV-A 2/' -> 'Region IV-A': drop indentation dots and footnote marks."""
    return re.sub(r"\s+(?:\d+/|\*+)$", "", label.strip().lstrip(". ")).strip()


def region(code, label):
    """fetch_psa.region, after giving the cohort-survival table's row numbers their PSGC codes."""
    if not re.fullmatch(r"\d{10}", code):
        name = strip_marks(label)
        m = re.search(r"\((\w+)\)$", name)
        code = PSGC[m[1] if m else name]
    return psa_region(code, label)


def notes(path):
    """The table's footnotes. OpenSTAT's JSON formats (json, json-stat2) carry none; the PX format has them in
    NOTEX, as '#'-separated lines after its 'Note/s:' heading."""
    req = urllib.request.Request(API + path, json.dumps({"query": [], "response": {"format": "px"}}).encode(),
                                 {"Content-Type": "application/json", "User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
    codepage = re.search(rb'^CODEPAGE="([^"]+)"', raw, re.M)
    px = raw.decode(codepage[1].decode() if codepage else "utf-8")
    m = re.search(r'^NOTEX=((?:"[^"]*"\s*)+);', px, re.M)
    lines = [s.strip() for s in re.sub(r"<[^>]+>", "", "".join(re.findall(r'"([^"]*)"', m[1]) if m else "")).split("#")]
    return [s for s in lines[lines.index("Note/s:") + 1:] if s] if "Note/s:" in lines else []


def snapshot(name, path):
    fetch(name, path)
    f = RAW / f"{name}.json"
    snap = json.loads(f.read_text())
    snap["notes"] = notes(path)
    f.write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len(snap['notes'])} notes")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pinned(name):
    """The pinned PDF in download/, after checking its SHA-256."""
    path = DOWNLOAD / name
    if not path.exists() or sha256(path) != PINNED[name][1]:
        sys.exit(f"data/download/{name} is missing or its SHA-256 differs from PINNED; "
                 "run python3 data/fetch_education.py --download")
    return path


def download():
    DOWNLOAD.mkdir(exist_ok=True)
    failed = []
    for name, (url, digest) in PINNED.items():
        path = DOWNLOAD / name
        if path.exists() and sha256(path) == digest:
            print(f"have download/{name}")
            continue
        errors = []
        for src in (url, MIRRORS.get(name)):
            if not src:
                continue
            try:
                with urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": "curl/8"}), timeout=180) as r:
                    body = r.read()
            except OSError as e:  # psa.gov.ph answers scripts with a Cloudflare 403
                errors.append(f"{src}: {e}")
                continue
            got = hashlib.sha256(body).hexdigest()
            if got == digest:
                path.write_bytes(body)
                print(f"downloaded download/{name} from {src}")
                break
            errors.append(f"{src}: SHA-256 {got}, PINNED expects {digest}")
        else:
            failed.append(f"{name}:\n  " + "\n  ".join(errors) +
                          f"\n  open {url} in a browser and save the file as {path.resolve()}")
    if failed:
        sys.exit("could not download:\n" + "\n".join(failed))


@functools.cache
def lfs_release():
    """The pinned LFS release files; with none pinned, says once which files to fetch and returns []."""
    names = sorted(n for n in PINNED if n.startswith("psa-lfs-"))
    if not names:
        print(f"Table A-1 and Table A are unchecked: no LFS release is pinned. From the latest release on {LFS_PAGE},\n"
              "save Press-Release-for-<Month>-<YYYY>-LFS.pdf as data/download/psa-lfs-press-release-<YYYY-MM>.pdf and\n"
              "'TABLE A - Key Employment Indicators with Measures of Precision, Philippines_<Mon><YYYY>.xlsx' as\n"
              "data/download/psa-lfs-table-a-<YYYY-MM>.xlsx, then pin both in PINNED.", file=sys.stderr)
    return names


def table_a1():
    """{(period, measure): (value, 'final' | 'preliminary')} from Table A-1 of the pinned press release.
    The parser (pypdf) lands when the release is pinned; until then this is {} and lfs-headlines fails."""
    if lfs_release():
        sys.exit("a press release is pinned but table_a1() has no parser for it yet")
    return {}


def table_a():
    """{(period, measure): (ci_low, ci_high)} from the pinned Table A workbook, only where it gives 95% bounds.
    The parser (openpyxl) lands when the workbook is pinned; until then this is {}."""
    if lfs_release():
        sys.exit("a Table A workbook is pinned but table_a() has no parser for it yet")
    return {}


def note_status(notes):
    """period -> 'final' | 'preliminary' | '' from notes such as 'Estimates from April 2005 to August 2025 were
    final.' A year takes its December's status; a period no note covers, or two disagree on, is blank."""
    ranges = [(f"{m[2]}-{MONTHS.index(m[1]) + 1:02d}", f"{m[4]}-{MONTHS.index(m[3]) + 1:02d}", m[5]) for n in notes
              if (m := re.search(r"Estimates from (\w+) (\d{4}) to (\w+) (\d{4}) were (final|preliminary)", n))]

    def status(period):
        month = f"{period}-12" if len(period) == 4 else period
        found = {s for lo, hi, s in ranges if lo <= month <= hi}
        return found.pop() if len(found) == 1 else ""
    return status


def period(d):
    y, m = d["Year"][1], d["Month"][1]
    return y if m == "Annual" else f"{y}-{MONTHS.index(m) + 1:02d}"


def write(name, header, rows):
    with open(CLEAN / f"{name}.csv", "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    print(f"wrote clean-education/{name}.csv: {len(rows)} rows")


def tidy():
    a1, ta = table_a1(), table_a()
    status = note_status(json.loads((RAW / "lfs_key_rates.json").read_text())["notes"])
    rows = []
    for d, value in cells("lfs_key_rates"):
        p = period(d)
        # Rows start with the April 2005 unemployment definition; 2005 has no full year.
        if d["Sex"][1] != "Both sexes" or value is None or p < "2005-04":
            continue
        measure = strip_marks(d["Rates"][1]).capitalize()
        flag = a1[(p, measure)][1] if (p, measure) in a1 else status(p)
        rows.append([p, "month" if len(p) == 7 else "year", measure, value, flag, *ta.get((p, measure), ("", ""))])
    write("labour_rates", ["period", "frequency", "measure", "value", "status", "ci_low", "ci_high"],
          sorted(rows, key=lambda r: (r[2], r[0])))

    counts = {}  # (snapshot, period, level) -> thousands
    for name in ("lfs_employed_by_grade", "lfs_underemployed_by_grade"):
        for d, value in cells(name):
            if value is not None:
                counts[(name, period(d), strip_marks(d["Highest Grade Completed (2017 PSCED)"][1]))] = value
    levels = [lvl for lvl in dict.fromkeys(k[2] for k in counts) if lvl not in SUBTOTALS]
    months = sorted(p for n, p, lvl in counts if lvl == "Total" and len(p) == 7 and n == "lfs_employed_by_grade"
                    and ("lfs_underemployed_by_grade", p, "Total") in counts)
    years = sorted(y for y in {p[:4] for p in months} if all(f"{y}-{m:02d}" in months for m in range(1, 13)))

    def count(name, p, lvl):
        # The tables carry PSA's own Annual figure for every complete year so far (2023-2025); a year without
        # one falls back to the mean of its 12 months.
        if (name, p, lvl) in counts or len(p) == 7:
            return counts.get((name, p, lvl))
        return round(sum(counts[(name, f"{p}-{m:02d}", lvl)] for m in range(1, 13)) / 12, 3)

    rows = [[p, "month" if len(p) == 7 else "year", i, lvl, count("lfs_employed_by_grade", p, lvl),
             count("lfs_underemployed_by_grade", p, lvl)]
            for p in years + months for i, lvl in enumerate(levels, 1)]
    write("education_work", ["period", "frequency", "level_order", "level", "employed", "underemployed"], rows)

    # school_year is OpenSTAT's Year label verbatim, the label PSA's SDG Watch uses too. Footnote 4/ says Senior
    # High estimates started in SY 2018-2019, and the first Senior High label is 2018, which reads as the school
    # year's first calendar year; PSA does not state the mapping outright.
    rows, names = [], {}
    for indicator, name in (("completion_rate", "sdg_completion_rate"), ("cohort_survival_rate", "sdg_cohort_survival_rate")):
        for d, value in cells(name):
            if value is None:
                continue
            code, label = region(*d["Geolocation"])
            level = SCHOOL_LEVELS[strip_marks(d["Level of Education"][1])]
            rows.append([d["Year"][1], code, names.setdefault(code, label), level, d["Sex"][1], indicator, value])
    write("completion", ["school_year", "region_code", "region", "level", "sex", "indicator", "value"], rows)

    header = list(PUBLISHED[0])
    write("published_figures", header, [[r[k] for k in header] for r in PUBLISHED])


if __name__ == "__main__":
    if "--download" in sys.argv:
        download()
        sys.exit()
    if "--offline" in sys.argv:
        for name in PINNED:
            pinned(name)
    else:
        RAW.mkdir(parents=True, exist_ok=True)
        for name, path in TABLES.items():
            snapshot(name, path)
        download()
    CLEAN.mkdir(exist_ok=True)
    tidy()
