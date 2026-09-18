# data

Ground truths for the viz projects: source files as published, tidy tables derived from
them, and checks that tie every derived number back to the publisher's own figures.

```
python3 data/fetch_psa.py            # snapshot PSA OpenSTAT, write clean/*.csv
python3 data/fetch_psa.py --offline  # rebuild clean/ from the committed snapshots
python3 data/check.py                # verify clean/ against PSA's published tables (needs openpyxl)
```

| Path | Rule |
| --- | --- |
| `raw/` | Exactly as published. Never edited; a newer release is a new file. Committed. |
| `clean/` | Tidy CSVs derived from `raw/` by scripts. Rebuildable, so not committed. |

## Ground truths

`check.py` passes only if all of these hold:

- **Published headlines.** Deaths from all causes and from neoplasms, by sex, equal PSA 2024 textual Table 10.
  - All causes: **701,884**.
  - Neoplasms: **77,504**, split into **34,639** male and **42,865** female. Neoplasms are the #2 cause of death overall and the #2 among women.
- **Cell by cell.** All 18,920 neoplasm cells for 2024 (region × cause × age × sex) equal PSA 2024 statistical Table 12.
- **Arithmetic, 2023 and 2024.** Site groups sum to 1-026 Neoplasms. Male plus female equals both sexes. Age groups sum to the total. Regions plus "foreign country" sum to the national figure. Every year has the all-causes total and all 22 neoplasm groups.
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

## Next sources (not fetched yet)

Surveyed 2026-09-18, in fetch order. ✓ means the URL was verified to respond; the rest are from desk research.

| # | Source | Gives | Format | Notes |
| --- | --- | --- | --- | --- |
| 1 | GLOBOCAN (IARC) ✓ `gco-api.iarc.fr/api/globocan/v3/{2024,2022}/factsheet/population/608/` | **Incidence**, mortality and 5-year prevalence by site × sex: counts, ASR, crude rate | JSON (undocumented API) | These are modelled estimates, not registry counts; 2024 gives 149,852 new cases. Licence: IARC terms, attribution required. Its mortality is also modelled, so it won't match PSA's registered deaths. |
| 2 | PhilHealth accredited cancer treatment facilities ✓ `philhealth.gov.ph/partners/providers/facilities/accredited/CTF_MMDDYY.pdf` | 16 freestanding centres: name, contact, address, sector, accreditation expiry | PDF table | Re-issued monthly and the filename changes. The same folder holds HOSP (all hospitals) and CancerScreening. |
| 3 | PhilHealth Z Benefit contracted facilities ✓ `…/facilities/contracted/YYYYMMDD_Contracted ZBEN_forweb.pdf` | Facilities contracted per package: childhood ALL, breast, prostate, cervical, colon, rectum | PDF, one table per package | Package amounts are only in circulars, as prose. |
| 4 | PROS radiation oncology `pros.org.ph/facilities/` | Hospitals with radiation oncology, by region | HTML table | Society list, not official. |
| 5 | DOH NHFR `nhfr.doh.gov.ph/VActivefacilitiesList` | Every licensed facility: code, type, ownership, service capability, beds | Excel export in the UI | Cloudflare blocks scripts, so export by hand in a browser. |
| 6 | DOH HFSRB `hfsrb.doh.gov.ph/cancer-treatment-facility/` | National list of licensed cancer treatment facilities | Unknown | Cloudflare-blocked, so check by hand. The CALABARZON regional sheet has been deleted (HTTP 410). |
| 7 | PCS / Rizal cancer registry reports `philcancer.org.ph/…/local-publications` | Historical registry incidence for Manila and Rizal | PDF | Only by extracting tables. |
| 8 | DOH-designated cancer centres (PCC) and Cancer Assistance Fund access sites | 24 designated centres; 36 CAF sites | Prose or news only | Compile by hand. |

Checked and parked:

- **data.gov.ph.** It isn't CKAN, and its API needs a key the frontend generates. Its 175 datasets are mostly DOH COVID-19 drops, with no cancer or facility data found.
- **PCSO MAP, DSWD AICS and DOH MAIFIP.** No structured data is published. The DSWD AICS PDFs contain beneficiary names and don't separate medical or cancer aid, so they're not usable here.
