import { useEffect, useState, type CSSProperties } from 'react';
import { Anatomy } from './anatomy';
import { Bars, type BarRow } from './bars';
import { callTool } from './mcp';
import { McpModal } from './mcpmodal';
import { CountUp, useRevealOnScroll } from './motion';
import { DataValidity, ValidityBadge, Verified, type Validity } from './validity';
import './app.css';

type Sex = 'Both Sexes' | 'Female' | 'Male';
type Death = { cause_code: string; cause: string; icd10: string; deaths: number };
type Rate = { region_code: string; region: string; deaths: number; population: number; rate_per_100k: number };
type Estimate = { measure: string; cancer_code: string; cancer: string; count: number };
type Ratio = { cancer_code: string; cancer: string; new_cases: number; deaths: number; mir: number };
type Survival = { population: string; age: string; site: string; pct: number; bound: string; se: number | null;
  cases: number | null; censored_pct: number | null };
type Data = {
  deaths: Death[]; deaths2023: number; rates: Rate[]; estimates: Estimate[]; ratios: Ratio[];
  female: number; male: number; ages: { age_group: string; deaths: number }[]; survival: Survival[];
};

const SEXES: [Sex, string][] = [['Both Sexes', 'Both sexes'], ['Female', 'Female'], ['Male', 'Male']];
const RESIDUAL = ['1-046', '1-047']; // "remainder" groups: always listed last
const int = new Intl.NumberFormat('en-PH');
const rate = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('en-PH', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = new Intl.NumberFormat('en-PH', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const OLDER = ['60-64', '65-69', '70-74', '75-79', '80-84', '85 and over'];
const YOUNG = ['Under 1', '1-4', '5-9', '10-14', '15-19'];

const SITE_NAMES: Record<string, string> = {
  'lip oral cavity and pharynx': 'Lip, oral cavity & pharynx',
  'colon rectum and anus': 'Colon, rectum & anus',
  'liver and intrahepatic bile ducts': 'Liver & bile ducts',
  'trachea bronchus and lung': 'Lung, trachea & bronchus',
  'meninges brain and other parts of central nervous system': 'Brain & nervous system',
  'other and unspecified parts of uterus': 'Uterus, other parts',
  'cervix uteri': 'Cervix',
  'Malignant melanoma of skin': 'Melanoma of skin',
  'Multiple myeloma and malignant plasma cell neoplasms': 'Multiple myeloma',
  'Remainder of malignant neoplasms': 'Other malignant sites',
  'Remainder of neoplasms': 'In situ, benign & uncertain',
};
const siteName = (cause: string) => {
  const s = cause.replace(/^Malignant neoplasm of /, '');
  const name = SITE_NAMES[s] ?? s;
  return name[0].toUpperCase() + name.slice(1);
};
const ESTIMATE_NAMES: Record<string, string> = {
  'Trachea, bronchus and lung': 'Lung',
  'Liver and intrahepatic bile ducts': 'Liver',
  'Brain, central nervous system': 'Brain & nervous system',
};
// Short names for sentences, keyed by Tabulation List 1 code.
const SHORT: Record<string, string> = {
  '1-030': 'colorectal', '1-031': 'liver', '1-034': 'lung', '1-036': 'breast', '1-037': 'cervical',
  '1-039': 'ovarian', '1-040': 'prostate', '1-045': 'leukaemia',
};
const list = (items: string[]) => items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
const regionName = (region: string) => /\(([^)]+)\)$/.exec(region)?.[1] ?? region;

async function load(sex: Sex): Promise<Data> {
  const neo = { year: 2024, region: 'PH', cause: '1-026' };
  const [deaths, before, rates, estimates, ratios, female, male, ages, survival] = await Promise.all([
    callTool<{ rows: Death[] }>('registered_cancer_deaths', { year: 2024, region: 'PH', sex }),
    callTool<{ rows: Death[] }>('registered_cancer_deaths', { year: 2023, region: 'PH', cause: '1-026', sex }),
    callTool<{ rows: Rate[] }>('cancer_death_rates', { cause: '1-026', sex }),
    callTool<{ rows: Estimate[] }>('cancer_estimates', { sex }),
    callTool<{ rows: Ratio[] }>('mortality_incidence_ratio', { sex }),
    callTool<{ rows: Death[] }>('registered_cancer_deaths', { ...neo, sex: 'Female' }),
    callTool<{ rows: Death[] }>('registered_cancer_deaths', { ...neo, sex: 'Male' }),
    callTool<{ rows: { age_group: string; deaths: number }[] }>('registered_cancer_deaths', { ...neo, sex, age_group: 'all' }),
    callTool<{ rows: Survival[] }>('cancer_survival'),
  ]);
  return { deaths: deaths.rows, deaths2023: before.rows[0].deaths, rates: rates.rows, estimates: estimates.rows,
           ratios: ratios.rows, female: female.rows[0].deaths, male: male.rows[0].deaths, ages: ages.rows,
           survival: survival.rows };
}

export function App() {
  const [sex, setSex] = useState<Sex>('Both Sexes');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validity, setValidity] = useState<Validity | null>(null);
  useRevealOnScroll();

  useEffect(() => {
    callTool<Validity>('data_validation').then(setValidity, (e: unknown) =>
      setValidity({ verified: false, reason: `Couldn’t read the validation report (${e instanceof Error ? e.message : e}).`, report: null }));
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    load(sex)
      .then((d) => { if (current) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [sex]);

  const who = sex === 'Both Sexes' ? 'both sexes' : sex.toLowerCase();

  return (
    <>
      <a className="skip-link btn" href="#main">Skip to content</a>
      <header className="container site-header">
        <span className="wordmark">viz</span>
        <McpModal validity={validity} />
      </header>

      <main id="main" className="container">
        <section className="split intro">
          <h1 className="display" data-reveal>Cancer in the Philippines <span className="quiet">by site, region and sex.</span></h1>
          <p className="lead" data-reveal style={{ '--stagger': 2 } as CSSProperties}>
            Registered deaths from the Philippine Statistics Authority, alongside IARC’s GLOBOCAN estimates of new
            cases. Every figure is checked against the publishers’ own tables and read through this project’s MCP
            server.
          </p>
        </section>

        <ValidityBadge v={validity} />

        <Anatomy validity={validity} />

        <div className="filters" role="radiogroup" aria-label="Sex">
          {SEXES.map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="sex" value={value} checked={sex === value} onChange={() => setSex(value)} />
              {label}
            </label>
          ))}
        </div>

        {error && (
          <p className="card error" role="alert">
            Couldn’t read the data: {error}. The app needs its MCP endpoint, so run it with{' '}
            <code className="mention">pnpm nx dev cancer</code>.
          </p>
        )}
        {!data && !error && <p className="caption" aria-live="polite">Loading data from the MCP server…</p>}
        {data && <Dashboard data={data} who={who} stale={loading} v={validity} />}

        <DataValidity v={validity} />
      </main>

      <footer className="container site-footer caption">
        <p>
        Sources: Philippine Statistics Authority, 2024 and 2023 registered deaths (OpenSTAT) and 2024 Census of
        Population; IARC Global Cancer Observatory, GLOBOCAN 2024 (© IARC). Registered deaths are not adjusted for
        under-registration; GLOBOCAN figures are modelled estimates.
        </p>
      </footer>
    </>
  );
}

function Dashboard({ data, who, stale, v }: { data: Data; who: string; stale: boolean; v: Validity | null }) {
  const byCode = new Map(data.deaths.map((d) => [d.cause_code, d]));
  const neoplasms = byCode.get('1-026')?.deaths ?? 0;
  const all = byCode.get('total')?.deaths ?? 0;
  const change = (neoplasms - data.deaths2023) / data.deaths2023;
  const national = data.rates.find((r) => r.region_code === 'PH');
  const incidence = data.estimates.find((e) => e.measure === 'incidence' && e.cancer_code === '39')?.count ?? 0;

  const sites: BarRow[] = data.deaths
    .filter((d) => /^1-0(2[7-9]|3\d|4[0-7])$/.test(d.cause_code) && d.deaths > 0)
    .sort((a, b) => Number(RESIDUAL.includes(a.cause_code)) - Number(RESIDUAL.includes(b.cause_code)) || b.deaths - a.deaths)
    .map((d) => ({
      key: d.cause_code, label: siteName(d.cause), values: [d.deaths],
      detail: [`${pct.format(d.deaths / neoplasms)} of cancer deaths`, `ICD-10 ${d.icd10}`],
    }));

  const regions: BarRow[] = data.rates
    .filter((r) => r.region_code !== 'PH')
    .map((r) => ({
      key: r.region_code, label: regionName(r.region), values: [r.rate_per_100k],
      detail: [r.region, `${int.format(r.deaths)} deaths · population ${int.format(r.population)}`],
    }));

  // GLOBOCAN: colon (8), rectum (9) and anus (10) combine as colorectum; the top 12 sites by
  // new cases, then everything else (incl. other/unspecified and non-melanoma skin) as one row.
  const est = new Map<string, { label: string; values: number[] }>();
  const totals = [0, 0];
  const column: Record<string, number | undefined> = { incidence: 0, mortality: 1 };
  for (const e of data.estimates) {
    const col = column[e.measure];
    if (col === undefined) continue;
    if (e.cancer_code === '39') totals[col] = e.count;
    const code = Number(e.cancer_code);
    if (!(code <= 36) || code === 17) continue;
    const key = [8, 9, 10].includes(code) ? 'colorectum' : e.cancer_code;
    const row = est.get(key) ?? { label: key === 'colorectum' ? 'Colorectum' : ESTIMATE_NAMES[e.cancer] ?? e.cancer, values: [0, 0] };
    row.values[col] += e.count;
    est.set(key, row);
  }
  const top = [...est.entries()].filter(([, r]) => r.values[0] > 0)
    .sort((a, b) => b[1].values[0] - a[1].values[0]).slice(0, 12);
  const estimates: BarRow[] = [
    ...top.map(([key, r]) => ({ key, label: r.label, values: r.values })),
    { key: 'other', label: 'All other sites',
      values: totals.map((t, i) => t - top.reduce((s, [, r]) => s + r.values[i], 0)) },
  ];

  // Key percentages, in words.
  const top3 = sites.filter((r) => !RESIDUAL.includes(r.key)).slice(0, 3);
  const ageShare = (groups: string[]) =>
    data.ages.filter((a) => groups.includes(a.age_group)).reduce((n, a) => n + a.deaths, 0) / neoplasms;
  const above = national ? regions.filter((r) => r.values[0] > national.rate_per_100k).length : 0;
  const [, topSite] = top[0];
  const facts: [number, string][] = [
    [top3.reduce((n, r) => n + r.values[0], 0) / neoplasms,
     `of cancer deaths are ${list(top3.map((r) => SHORT[r.key] ?? r.label.toLowerCase()))} cancer`],
    [ageShare(OLDER), 'of cancer deaths were people aged 60 or older'],
    [ageShare(YOUNG), 'of cancer deaths were children and young people under 20'],
    [data.female / (data.female + data.male), 'of all cancer deaths in 2024 were women'],
    [above / regions.length, `of regions (${above} of ${regions.length}) have a cancer death rate above the national rate`],
    [topSite.values[0] / totals[0], `of estimated new cancer cases are ${topSite.label.toLowerCase()} cancer`],
  ];

  // Survival: adults (Metro Manila vs Filipino-Americans) and children, published studies.
  const adults = data.survival.filter((r) => r.age === 'adults');
  const survivalIn = (site: string, population: string) =>
    adults.find((r) => r.site === site && r.population.startsWith(population))?.pct ?? 0;
  const adultRows: BarRow[] = adults.filter((r) => r.population === 'Philippine residents')
    .sort((a, b) => b.pct - a.pct)
    .map((r) => ({
      key: r.site, label: r.site, values: [r.pct, survivalIn(r.site, 'Filipino-Americans')],
      detail: [`Caucasians in the US: ${rate.format(survivalIn(r.site, 'Caucasians'))}%`,
               `Metro Manila standard error ±${r.se}`],
    }));
  const childRows: BarRow[] = data.survival.filter((r) => r.age === '0-19')
    .sort((a, b) => b.pct - a.pct)
    .map((r) => ({
      key: r.site, label: r.site.replace('’', '\''), values: [r.pct], display: [`${r.bound}${rate.format(r.pct)}%`],
      detail: [`${int.format(r.cases ?? 0)} children diagnosed`,
               `${rate.format(r.censored_pct ?? 0)}% lost to follow-up (censored)`],
    }));
  const percent = (n: number) => `${rate.format(n)}%`;

  // Deaths per 100 new cases (MIR x 100) for the 12 most common cancers, worst first.
  const per100 = (r: Ratio) => (r.deaths / r.new_cases) * 100;
  const allCancers = data.ratios.find((r) => r.cancer_code === '39');
  const ratios: BarRow[] = data.ratios.filter((r) => r.cancer_code !== '39').slice(0, 12)
    .sort((a, b) => per100(b) - per100(a))
    .map((r) => ({
      key: r.cancer_code, label: ESTIMATE_NAMES[r.cancer] ?? r.cancer, values: [per100(r)],
      detail: [`${int.format(r.deaths)} deaths ÷ ${int.format(r.new_cases)} new cases`,
               `1 − MIR ≈ ${pct.format(1 - r.deaths / r.new_cases)}, a rough survival proxy`],
    }));

  return (
    <div className={stale ? 'dashboard stale' : 'dashboard'} aria-busy={stale}>
      <dl className="tiles">
        <div className="card tile" data-reveal style={{ '--stagger': 0 } as CSSProperties}>
          <dt>Registered cancer deaths, 2024</dt>
          <dd className="tile-value"><CountUp value={neoplasms} format={int.format} /></dd>
          <dd className="caption">
            {change >= 0 ? '▲' : '▼'} {pct.format(Math.abs(change))} vs 2023 ({int.format(data.deaths2023)})
          </dd>
        </div>
        <div className="card tile" data-reveal style={{ '--stagger': 1 } as CSSProperties}>
          <dt>Share of all registered deaths</dt>
          <dd className="tile-value"><CountUp value={neoplasms / all} format={pct.format} /></dd>
          <dd className="caption">of {int.format(all)} deaths, {who}</dd>
        </div>
        <div className="card tile" data-reveal style={{ '--stagger': 2 } as CSSProperties}>
          <dt>Cancer deaths per 100,000</dt>
          <dd className="tile-value">{national ? <CountUp value={national.rate_per_100k} format={rate.format} /> : '–'}</dd>
          <dd className="caption">crude rate, 2024 census population</dd>
        </div>
        <div className="card tile" data-reveal style={{ '--stagger': 3 } as CSSProperties}>
          <dt>Estimated new cases, 2024</dt>
          <dd className="tile-value"><CountUp value={incidence} format={int.format} /></dd>
          <dd className="caption">GLOBOCAN modelled estimate</dd>
        </div>
      </dl>

      <section aria-labelledby="facts-heading">
        <h2 id="facts-heading" className="card-heading facts-heading">In percentages</h2>
        <dl className="facts">
          {facts.map(([value, text], i) => (
            // The text fades in, not the cell: a fading cell would show the hairline grid behind it.
            <div className="fact" key={text} style={{ '--stagger': i } as CSSProperties}>
              <dt className="fact-value" data-reveal><CountUp value={value} format={pct.format} /></dt>
              <dd data-reveal>{text}</dd>
            </div>
          ))}
        </dl>
        <p className="caption">Registered deaths and census population, 2024, {who}; the last figure is a GLOBOCAN estimate.</p>
          <Verified v={v} ids={['psa-headlines', 'psa-table12', 'population', 'globocan']} />
      </section>

      <div className="chart-grid">
        <section className="card chart" data-reveal>
          <h2 className="card-heading">Deaths by cancer site</h2>
          <p className="caption">Registered deaths, 2024, {who}, with each site’s share of all cancer deaths. Residual groups are listed last.</p>
          <Bars rows={sites} columns={['Deaths']} format={(n) => `${int.format(n)} · ${pct.format(n / neoplasms)}`}
                caption={`Registered cancer deaths by site, 2024, ${who}`} />
          <p className="caption source">PSA registered deaths, ICD-10 Mortality Tabulation List 1.</p>
          <Verified v={v} ids={['psa-table12', 'psa-arithmetic']} />
        </section>

        <section className="card chart" data-reveal>
          <h2 className="card-heading">Death rate by region</h2>
          <p className="caption">
            Cancer deaths per 100,000 residents, 2024, {who}, and how far each region sits above or below the
            national rate. Crude rates: regions with older populations rank higher partly for that reason.
          </p>
          <Bars rows={regions} columns={['Per 100,000']}
                format={(n) => national ? `${rate.format(n)} · ${signed.format(n / national.rate_per_100k - 1)}` : rate.format(n)}
                reference={national && { value: national.rate_per_100k, label: `Philippines ${rate.format(national.rate_per_100k)}` }}
                caption={`Cancer deaths per 100,000 by region of residence, 2024, ${who}`} />
          <p className="caption source">
            PSA registered deaths ÷ 2024 Census population{who === 'both sexes' ? '' : ' (household population by sex)'}.
          </p>
          <Verified v={v} ids={['psa-table12', 'population']} />
        </section>
      </div>

      <section className="card chart" data-reveal>
        <h2 className="card-heading">Estimated new cases and deaths</h2>
        <p className="caption">
          GLOBOCAN 2024, {who}, with each site’s share of all new cases and of all deaths. Modelled from the Manila
          and Rizal registries and WHO mortality trends, so its deaths don’t match PSA’s registered count; compare
          within this chart only.
        </p>
        <Bars rows={estimates} columns={['New cases', 'Deaths']}
              format={(n, col) => `${int.format(n)} · ${pct.format(n / totals[col])}`}
              caption={`GLOBOCAN 2024 estimated new cases and deaths by site, ${who}`} />
        <p className="caption source">IARC Global Cancer Observatory, GLOBOCAN 2024 (© IARC).</p>
          <Verified v={v} ids={['globocan']} />
      </section>

      <section className="card chart" data-reveal>
        <h2 className="card-heading">Deaths per 100 new cases</h2>
        <p className="caption">
          GLOBOCAN 2024, {who}: estimated deaths divided by estimated new cases (the mortality-to-incidence ratio)
          for the 12 most common cancers. Higher means worse outcomes. This is a rough proxy, not a survival rate:
          the cases and the deaths come from different models, and neither follows patients over time.
        </p>
        <Bars rows={ratios} columns={['Deaths per 100 new cases']} format={(n) => int.format(Math.round(n))}
              reference={allCancers && { value: per100(allCancers), label: `All cancers ${Math.round(per100(allCancers))}` }}
              caption={`Estimated deaths per 100 new cases by site, GLOBOCAN 2024, ${who}`} />
        <p className="caption source">Derived from IARC GLOBOCAN 2024 (© IARC). Not a survival rate.</p>
          <Verified v={v} ids={['globocan']} />
      </section>

      <div className="chart-grid">
        <section className="card chart" data-reveal>
          <h2 className="card-heading">Five-year survival, adults</h2>
          <p className="caption">
            Share of patients still alive five years after diagnosis, Metro Manila 1998–2002, next to Filipino-Americans
            in the US over the same years (relative survival, age-standardised). These are the most recent adult
            figures that exist for the Philippines, and they aren’t split by sex.
          </p>
          <Bars rows={adultRows} columns={['Metro Manila', 'Filipino-Americans (US)']} max={100} format={percent}
                caption="Five-year relative survival by site, Metro Manila residents and Filipino-Americans, 1998–2002" />
          <p className="caption source">
            Redaniel et al., Br J Cancer 2009 (CC BY 4.0); Manila and Rizal cancer registries. Incomplete follow-up
            probably overstates survival.
          </p>
          <Verified v={v} ids={['survival']} />
        </section>

        <section className="card chart" data-reveal>
          <h2 className="card-heading">Five-year survival, children</h2>
          <p className="caption">
            Children and young people aged 0–19 still alive five years after diagnosis, Metro Manila 2006–2017
            (observed survival). Over half of each group was lost to follow-up, so read these as rough; “≤” marks an
            upper bound.
          </p>
          <Bars rows={childRows} columns={['Survived 5 years']} max={100} format={percent}
                caption="Five-year observed survival by cancer, ages 0–19, Metro Manila, 2006–2017" />
          <p className="caption source">Rosario et al., Philippine Journal of Oncology 2025; Manila and Rizal cancer registries.</p>
          <Verified v={v} ids={['survival']} />
        </section>
      </div>
    </div>
  );
}

export default App;
