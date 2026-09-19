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
