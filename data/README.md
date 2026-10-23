# data

Ground truths for the viz projects: source files as published (PSA, IARC), tidy tables derived from
them, and checks that tie every derived number back to the publisher's own figures.

```
python3 data/fetch_psa.py        # PSA OpenSTAT → raw/psa/openstat, clean/{neoplasm_deaths,population}.csv
python3 data/fetch_globocan.py   # IARC GLOBOCAN → raw/iarc, clean/globocan.csv
python3 data/fetch_survival.py   # published survival studies → raw/survival, clean/survival.csv
python3 data/check.py            # verify clean/ against the published tables (needs openpyxl, pypdf)
# either fetch script with --offline rebuilds clean/ from the committed snapshots
```

| Path | Rule |
| --- | --- |
| `raw/` | Exactly as published. Never edited; a newer release is a new file. Committed. |
| `clean/` | Tidy CSVs derived from `raw/` by scripts. Rebuildable, so not committed. |

## Ground truths

`check.py` passes only if all of these hold. Each run writes `clean/validation.json` with:
- every check: what it compared against, how many assertions it made, and any failures;
- the sources, with their retrieval dates;
- a SHA-256 of each clean CSV.

The data build runs the checks in `--report-only` mode, so a failure is recorded rather than breaking the build; `nx run @viz/data:check` stays strict. The app's MCP tool `data_validation` re-hashes the files it serves. It calls the data verified only if every check passed and nothing changed since, and the dashboard shows readers that verdict.

- **Published headlines.** Deaths from all causes and from neoplasms, by sex, equal PSA 2024 textual Table 10.
  - All causes: **701,884**.
  - Neoplasms: **77,504**, split into **34,639** male and **42,865** female. Neoplasms are the #2 cause of death overall and the #2 among women.
- **Cell by cell.** All 18,920 neoplasm cells for 2024 (region × cause × age × sex) equal PSA 2024 statistical Table 12.
- **Arithmetic, 2023 and 2024.** Site groups sum to 1-026 Neoplasms. Male plus female equals both sexes. Age groups sum to the total. Regions plus "foreign country" sum to the national figure. Every year has the all-causes total and all 22 neoplasm groups.
- **GLOBOCAN.** The API snapshot equals IARC's published fact sheet PDF:
  - new cases, deaths and 5-year prevalence by sex, plus age-standardised rates;
  - every row of the per-site table (32 sites plus the two all-cancers totals).
  Male plus female equals both sexes, and the itemised sites never exceed all cancers.
- **Survival.** Adult figures equal Redaniel 2009 Table 2. The table's own "Difference" columns match the gaps between its value columns, and the paper's text agrees: thyroid is highest (82.4) and leukaemia lowest (5.2). Each of the six childhood figures from Rosario 2025 is restated in that paper's discussion, and each table's events plus censored cases add up to its total.
- **Population.** The 18 regions sum to the national total, less **1,708** Filipinos in embassies and missions abroad (PSA footnote a/). Age groups sum to each region's total. Both census tables agree on household population.

Derived, for orientation:

| Year | All deaths | Neoplasm deaths | Share |
| --- | --- | --- | --- |
| 2023 | 694,821 | 74,042 | 10.7% |
| 2024 | 701,884 | 77,504 | 11.0% |

The crude neoplasm death rate in 2024 was **68.8 per 100,000** (77,504 deaths out of 112,729,484 people).

The top sites in 2024 were:

1. Breast (C50): 11,348 deaths
2. Trachea, bronchus and lung (C33-C34): 9,018
3. Colon, rectum and anus (C18-C21): 8,765
4. Liver (C22): 6,481

The "remainder of malignant neoplasms" group (10,575 deaths) is larger than any site except breast.

## Sources

### IARC GLOBOCAN 2024 (incidence, prevalence, modelled mortality)

| File | What |
| --- | --- |
| `raw/iarc/globocan-2024/factsheet.json` | `gco-api.iarc.fr/api/globocan/v3/2024/factsheet/population/608/`: incidence, mortality and 5-year prevalence by site × sex. Gives count, ASR (World), crude rate, cumulative risk to 74, and rank. |
| `raw/iarc/globocan-2024/cancers.json` | Site codes, labels and ICD-10 ranges (`meta/cancers/all/`). |
| `raw/iarc/globocan-2024/fact-sheet.pdf` | IARC's Philippines fact sheet (GLOBOCAN 2024, July 2026); source for the check. |

The 2024 headline figures are:

| Measure | Both sexes | Male | Female |
| --- | --- | --- | --- |
| New cases | 149,852 | 61,122 | 88,730 |
| Deaths | 86,338 | 41,225 | 45,113 |
| 5-year prevalence | 352,713 | 124,773 | 227,940 |

The top incident cancers are:

1. Breast: 28,124
2. Colorectum: 17,462
3. Lung: 15,312
4. Prostate: 9,195
5. Liver: 8,638

Read before using:

- **Estimates, not counts.** Incidence is modelled from the Manila and Rizal registries (2000–2017), applied to the national 2024 population. Mortality is WHO national rates for 2010–2019, projected to 2024. Prevalence uses Nordic incidence-to-prevalence ratios scaled by HDI.
- **Not comparable with PSA.** GLOBOCAN's 86,338 modelled deaths and PSA's 77,504 registered neoplasm deaths measure different things. The 11% gap reflects under-registration and ill-defined causes as much as anything, so show them side by side only with that caveat.
- **One edition only.** Editions change method; 2022 estimated 188,976 cases against 2024's 149,852. Never draw a trend across editions, which is why only 2024 is kept.
- **Other and unspecified sites.** The fact sheet itemises sites 1–36 only. `clean/globocan.csv` adds a derived row, `37+38` "Other and unspecified sites", holding the remainder, so each measure × sex sums to all cancers. That's 12,486 of the new cases.
- **Colon, rectum and anus.** These stay separate (codes 8, 9, 10); the fact sheet's "Colorectum" is their sum.
- **Licence.** © IARC, all rights reserved; cite IARC's Global Cancer Observatory (GLOBOCAN 2024). Keep this repo private, or drop `raw/iarc/`, before publishing it.
- **No age or regional split.** I couldn't find an age breakdown in the API; its `data/` endpoint returned only population projections. Regional incidence doesn't exist in GLOBOCAN at all.

### Survival (published studies, Metro Manila only)

The Philippines has no data in CONCORD-3 (the registry couldn't be linked to death records) or in SURVCAN-3. These two papers are the population-based survival figures that exist. Both use the Manila and Rizal cancer registries.

| File | What |
| --- | --- |
| `raw/survival/redaniel-2009-bjc.xml` | Redaniel et al., *Br J Cancer* 2009;100:858, doi:10.1038/sj.bjc.6604945 (CC BY 4.0), from PMC. Table 2 gives 5-year relative survival, age-standardised by period analysis, for diagnoses in 1998–2002. It covers 9 sites and three populations: Metro Manila residents, Filipino-Americans and Caucasians (both US SEER). |
| `raw/survival/rosario-2025-pjo.pdf` | Rosario et al., *Philippine Journal of Oncology* 2025;1(1):e004. Gives 5-year observed survival for ages 0–19, diagnosed 2006–2017, for six childhood cancers. Licence not stated; keep the repo private. |

Read before using:

- **Old, and Metro Manila only.** The adult figures are over 20 years old, and nothing population-based is newer. Neither study covers the whole country.
- **Follow-up gaps.** Only 41.6% of the adults not matched to a death certificate had complete 5-year follow-up, which probably overstates survival. Among the children, 54–79% of each group was censored (lost to follow-up). The paper gives some childhood values only as upper bounds, which the `bound` column marks with `≤`.
- **Different methods.**
  - The adult figures are relative survival (Ederer II, local life table), not CONCORD's net survival.
  - The children's figures are observed, all-cause survival.
  - Don't compare across the two studies, or with CONCORD.
- **No sex split** in either study.

### PSA: civil registration (deaths)

| File | What |
| --- | --- |
| `raw/psa/openstat/deaths_cause_{2023,2024}.json` | OpenSTAT snapshots of *Registered Deaths by Age Group, Sex, Region of Usual Residence and Cause of Death* (tables `0481A1ADEB2`, `0131A1BDEE7`). The query keeps national, region and foreign rows, and the causes Total and 1-026 to 1-047. |
| `raw/psa/2024-deaths/statistical-tables.xlsx` | 2024 Deaths Statistical Tables. Revision edited 2026-02-23; source for the Table 12 check. |
| `raw/psa/2024-deaths/statistical-tables_2026-01-21.xlsx` | Earlier revision. It differs only in T13 (deaths by month: about 36 cells) and in T16's header rows. |
| `raw/psa/2024-deaths/textual-tables.xlsx` | 2024 Deaths Textual Tables; source for the Table 10 check. |
| `raw/psa/2024-deaths/special-release.pdf` | 2024 Deaths special release. |

Things to know before charting:

- **Registered deaths.** These figures are registrations, not adjusted for under-registration. Cause is coded to ICD-10 and grouped by Mortality Tabulation List 1.
- **Negros Island Region.** NIR appears only in 2024. In 2023 its provinces are counted under Regions VI and VII, so region-level trends across 2023–2024 are not like-for-like there.
- **"Foreign country".** Deaths of residents abroad are counted in the national total but belong to no region.
- **Age bands.** Deaths use Under 1, 1-4, … 85 and over, plus Not Stated. Population uses Under 5, 5-9, … 85 and over. Merge Under 1 and 1-4 before calculating age-specific rates.
- **The 2025 figure (unverified).** A figure of 77,422 neoplasm deaths in 2025 (provisional) is quoted elsewhere. It would come from a separate PSA release that isn't in `raw/`, so don't use it until that release is added and checked.

### PSA: 2024 Census of Population (denominators)

| File | What |
| --- | --- |
| `raw/psa/openstat/population_2024.json` | Total population, household population, households and average household size, by region, as of 1 July 2024 (table `0191A6DTHP8`). |
| `raw/psa/openstat/household_population_age_sex_2024.json` | Household population by 5-year age group and sex, by region (table `0201A6DPAG0`). Use it for age-specific and age-standardised rates. |

### Tidy tables (`clean/`)

- `neoplasm_deaths.csv` has columns `year, region_code, region, cause_code, cause, icd10, age_group, sex, deaths`.
  - `region_code` is the PSGC code, `PH` for national or `foreign`.
  - `cause_code` is a Tabulation List 1 code, or `total` for all causes.
- `population.csv` has columns `year, region_code, region, measure, age_group, sex, value`.
- `survival.csv` has columns `source, population, place, period, age, site, measure, pct, bound, se, cases, censored_pct`.
  - `age` is `adults` or `0-19`.
  - `bound` is `≤` where the paper gives only an upper bound.
- `globocan.csv` has columns `year, measure, sex, cancer_code, cancer, icd10, count, asr_world, crude_rate, cum_risk_74, rank`.
  - `measure` is one of `incidence`, `mortality` or `prevalence_5y`.
  - `cancer_code` 39 is all cancers and 40 is all cancers excluding non-melanoma skin cancer.

## Next sources (not fetched yet)

Surveyed 2026-09-18, in fetch order. ✓ means the URL was verified to respond; the rest are from desk research.

| # | Source | Gives | Format | Notes |
| --- | --- | --- | --- | --- |
| 1 | PhilHealth accredited cancer treatment facilities ✓ `philhealth.gov.ph/partners/providers/facilities/accredited/CTF_MMDDYY.pdf` | 16 freestanding centres: name, contact, address, sector, accreditation expiry | PDF table | Re-issued monthly and the filename changes. The same folder holds HOSP (all hospitals) and CancerScreening. |
| 2 | PhilHealth Z Benefit contracted facilities ✓ `…/facilities/contracted/YYYYMMDD_Contracted ZBEN_forweb.pdf` | Facilities contracted per package: childhood ALL, breast, prostate, cervical, colon, rectum | PDF, one table per package | Package amounts are only in circulars, as prose. |
| 3 | PROS radiation oncology `pros.org.ph/facilities/` | Hospitals with radiation oncology, by region | HTML table | Society list, not official. |
| 4 | DOH NHFR `nhfr.doh.gov.ph/VActivefacilitiesList` | Every licensed facility: code, type, ownership, service capability, beds | Excel export in the UI | Cloudflare blocks scripts, so export by hand in a browser. |
| 5 | DOH HFSRB `hfsrb.doh.gov.ph/cancer-treatment-facility/` | National list of licensed cancer treatment facilities | Unknown | Cloudflare-blocked, so check by hand. The CALABARZON regional sheet has been deleted (HTTP 410). |
| 6 | PCS / Rizal cancer registry reports `philcancer.org.ph/…/local-publications` | Historical registry incidence for Manila and Rizal | PDF | Only by extracting tables. |
| 7 | DOH-designated cancer centres (PCC) and Cancer Assistance Fund access sites | 24 designated centres; 36 CAF sites | Prose or news only | Compile by hand. |

Checked and parked:

- **data.gov.ph.** It isn't CKAN, and its API needs a key the frontend generates. Its 175 datasets are mostly DOH COVID-19 drops, with no cancer or facility data found.
- **PCSO MAP, DSWD AICS and DOH MAIFIP.** No structured data is published. The DSWD AICS PDFs contain beneficiary names and don't separate medical or cancer aid, so they're not usable here.

## Education

The education page (`apps/education`) uses PSA labour-force and school data, the PSA SDG Watch, three papers and some news coverage of employer surveys. Its tidy tables are written to `clean-education/`, which is gitignored and rebuilt by the commands below.

```
python3 data/fetch_education.py --download  # the pinned PSA PDFs only, into the gitignored data/download/
python3 data/fetch_education.py             # refetch the OpenSTAT tables, download missing PDFs, tidy
python3 data/fetch_education.py --offline   # re-tidy from the snapshots and pinned PDFs, no network
python3 data/check_education.py             # the ground-truth checks; exits non-zero on any mismatch
```

Through pnpm (`@viz/data`):

| Target | What it runs |
| --- | --- |
| `pnpm nx run @viz/data:build-education` | `fetch_education.py --offline`, then `check_education.py --report-only` (records failures, doesn't break the build) |
| `pnpm nx run @viz/data:check-education` | `check_education.py`, strict |
| `pnpm nx run @viz/data:fetch-education` | `fetch_education.py` (refetches the OpenSTAT tables) |

### Sources

OpenSTAT (PSA's PxWeb database). Each file is a snapshot in `raw/psa/openstat/` and is read by `fetch_education.py`:

| Table | What | URL |
| --- | --- | --- |
| `0021B3FKEI2` | Key employment indicators, April 2005 to the latest month (rates) | https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1B__LFS/0021B3FKEI2.px/ |
| `0141B3FEMP7` | Employed persons by highest grade completed (2017 PSCED) | https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1B__LFS/0141B3FEMP7.px/ |
| `0151B3FUDR2` | Underemployed persons by highest grade completed | https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1B__LFS/0151B3FUDR2.px/ |
| `0023I3C0412` | SDG 4.1.2 completion rate, by region (DepEd EBEIS) | https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__3I__G04/0023I3C0412.px/ |
| `0033I3C41S1` | SDG 4.1.s1 cohort survival rate, by region | https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__3I__G04/0033I3C41S1.px/ |

PSA PDFs (not committed; see below):

- **LFS press release, August 2026, Table A-1 and Table A.** https://psa.gov.ph/statistics/labor-force-survey. Table A-1 gives the headline rates, Table A their precision. **Not pinned yet** (see the known gap).
- **2024 Consolidated SDG Watch, Goal 4** (PSA, as of 24 March 2025), `psa-sdg-watch-goal4.pdf`. Pinned in `fetch_education.py` by URL and SHA-256: https://psa.gov.ph/system/files/phdsd/2024%20Consolidated%20Watch_24Mar2025_0.pdf

Papers, committed in `raw/education/`:

| File | Citation | Licence | URL |
| --- | --- | --- | --- |
| `wb-prwp-11163.pdf` | Belghith, Fernandez and Lavin (2025), *Inequality, Education, and Occupational Change in the Philippines*, World Bank Policy Research Working Paper 11163 | CC BY 3.0 IGO | https://openknowledge.worldbank.org/entities/publication/dec2239c-5836-4312-b596-bc5058b15512 |
| `pids-pn-2024-09.pdf` | Albert, Punongbayan and Muñoz (2024), *Returns to education in the Philippines (2005–2022)*, PIDS Policy Notes 2024-09 | CC BY-NC (as stated by PIDS) | https://pidswebs.pids.gov.ph/CDN/document/pidspn2409.pdf |
| `melchor-2022-pjd.pdf` | Melchor (2022), *Surveying the Extent and Wage Consequences of Education-Job Mismatches in the Philippines*, Philippine Journal of Development | CC BY-NC 4.0 | https://doi.org/10.62986/pjd2022.46.1d |

Employer surveys are news coverage, not the reports themselves. Their URLs and quoted sentences are kept in `published_figures.csv`: JobStreet fresh-graduate reports (2014, 2015 and 2016, via Rappler; 2023, via Philstar), and the Philippine Business for Education 2024 Jobs Outlook (via BusinessWorld).

### Licences and why the PSA PDFs are not committed

- **World Bank PRWP 11163** is CC BY 3.0 IGO. Attribute it in the World Bank format: © World Bank, with the licence named.
- **Melchor 2022** is CC BY-NC 4.0.
- **PIDS PN 2024-09** is CC BY-NC, as stated by PIDS.
- The repo is noncommercial, so these licences are compatible with it. Any commercial use needs a fresh check.
- **PSA PDFs have no stated reuse licence.** RA 8293 s.176 covers government works, but it doesn't grant a licence to republish them. So the PSA PDFs go to the gitignored `data/download/`, and `fetch_education.py` pins each one by SHA-256. `--download` fetches them, and a checksum mismatch stops the build.

### Ground truths

`check_education.py` writes `clean-education/validation.json` with each check, what it compared against, its assertions and any failures, plus a SHA-256 of each clean CSV. The app's `data_validation` tool reads it and says the data is verified only if every check passed and nothing changed since.

1. **`lfs-headlines`: LFS headline rates match Table A-1.** Every Table A-1 cell is in `labour_rates.csv` with the same value and status, rounded as Table A's precision allows. The OpenSTAT key-rates snapshot agrees for both sexes.
2. **`lfs-education`: education of the employed and underemployed adds up.** `education_work.csv` equals the two OpenSTAT snapshots level by level, sums to their totals, and agrees with the underemployment rate.
3. **`sdg-completion`: completion and survival rates match PSA's SDG Watch.** The national rows equal the SDG Watch Goal 4 PDF. Every region equals the OpenSTAT SDG 4 snapshots.
4. **`published-figures`: quoted figures appear in their sources.** Each quote that points at a committed paper occurs in that paper's text and contains its figure.

### Tidy tables (`clean-education/`)

- `labour_rates.csv` has columns `period, frequency, measure, value, status, ci_low, ci_high`.
  - `measure` is one of the LFS rates (labour force participation, employment, unemployment, underemployment).
  - `status` is the PSA finality marker from the OpenSTAT footnotes.
  - `ci_low` and `ci_high` are the confidence interval, where PSA publishes one.
- `education_work.csv` has columns `period, frequency, level_order, level, employed, underemployed`.
  - One row per highest grade completed. Subtotals are dropped so the parts partition the employed.
  - `underemployed` is counted from the OpenSTAT underemployment table.
- `completion.csv` has columns `school_year, region_code, region, level, sex, indicator, value`.
  - `level` is Elementary, Junior high or Senior high.
  - `indicator` is the completion rate or the cohort survival rate.
  - `school_year` ends in the calendar year PSA labels the table with.
- `published_figures.csv` has columns `id, section, figure, value, unit, measure, population, year, sample, kind, source, url, quote, checked_against`.
  - One row per quoted figure. `section` is `gap` (the graduate hiring gap, from the papers) or `employers` (from the news coverage of employer surveys).
  - `kind` says whether the figure is a published estimate or a derived one.
  - `checked_against` names the committed file the check reads, or is empty for news links, which are kept as URLs only.
  - The file is never a computed table; the figures are quoted, so they aren't comparable with each other.

`clean-education/` is the output folder. It's gitignored, rebuilt by `build-education`, and written by `fetch_education.py`.

### Caveats

- **LFS frequency changed.** The labour force survey was quarterly up to October 2020, and monthly since. Don't read a monthly series against a quarterly one as a like-for-like trend, and check `frequency` before charting.
- **Precision differs.** OpenSTAT gives three decimal places, while PSA's releases give one. Tables A-1 and the checks compare at one decimal; the tidy CSV keeps what OpenSTAT gives.
- **Underemployment by education is derived.** PSA publishes counts of underemployed persons by grade, not a rate by grade. The rate is derived from those counts over the employed, for ages 15+. It isn't age-adjusted, and it isn't the 25–34 figure the papers use.
- **Completion data is administrative.** DepEd completion and cohort survival come from school records (EBEIS), not from a household survey. They are never mixed with PSA attendance or LFS figures on one chart.
- **Employer figures are self-reported.** The employer surveys are what employers said they wanted, in surveys run by the sources named. They're not measures of hiring.
- **No causal claims.** Education and earnings, employment or unemployment are associations in these sources. Nothing here shows that a degree causes a higher wage or a job.

### Known gap: the August 2026 LFS press release is not pinned

`psa.gov.ph` puts scripts behind a Cloudflare challenge, so `fetch_education.py` can't download the press release or its Table A XLSX. Until they're pinned, `lfs-headlines` fails, the build records it, and the site shows **Not verified**. Staging then needs `ALLOW_UNVERIFIED=1` (see the README).

To fix it:

1. In a browser, open https://psa.gov.ph/statistics/labor-force-survey and save these files into `data/download/`:
   - `Press-Release-for-August-2026-LFS.pdf`
   - `TABLE A - Key Employment Indicators with Measures of Precision, Philippines_Aug2026.xlsx`
2. Compute each file's SHA-256 (`sha256sum data/download/...`) and add both to `PINNED` in `data/fetch_education.py`, with their URLs.
3. Write the parsers: Table A-1 from the press release, and Table A from the XLSX. They feed `lfs-headlines` and the precision comparison in `check_education.py`.
4. Rebuild and check: `pnpm nx run @viz/data:build-education`, then `pnpm nx run @viz/data:check-education`. Every check should pass.
5. Redeploy: `apps/education/deploy/stage.sh` (strict, no override), then `cd apps/education/.deploy/web && npx vercel deploy --prod`.
