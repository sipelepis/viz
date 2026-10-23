import { useEffect, useState, type CSSProperties } from 'react';
import { Bars } from './bars';
import { LineChart } from './line';
import { callTool } from './mcp';
import { McpModal } from './mcpmodal';
import { useRevealOnScroll } from './motion';
import { DataValidity, ValidityBadge, Verified, type Validity } from './validity';
import './app.css';

type Rate = { period: string; frequency: 'month' | 'year'; measure: string; value: number; status: string;
  ci_low: number | null; ci_high: number | null };
type RatesResult = { source: string; url: string; notes: string[]; rows: Rate[] };
type Work = { years: string[]; national: { period: string; rate: number | null };
  rows: { period: string; level_order: number; level: string; employed: number; underemployed: number; rate: number }[];
  sources: { name: string; url: string }[] };
const LEVELS = ['Elementary', 'Junior high', 'Senior high'] as const;
type Level = (typeof LEVELS)[number];
type Completion = { school_year: string; url: string; rows: { region_code: string; region: string; value: number }[] };
type Figure = { id: string; section: string; figure: string; value: number; measure: string; population: string; year: number;
  sample: string; kind: string; source: string; url: string; checked_against: string };
type Data = { unemployment: RatesResult; underemployment: RatesResult; work: Work; completion: Record<Level, Completion>; published: Figure[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (period: string) => {
  const [year, month] = period.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
};
const pct1 = (n: number) => `${n.toFixed(1)}%`;

async function load(): Promise<Data> {
  const [unemployment, underemployment] = await Promise.all([
    callTool<RatesResult>('labour_rates', { measure: 'Unemployment rate', frequency: 'month' }),
    callTool<RatesResult>('labour_rates', { measure: 'Underemployment rate', frequency: 'month' }),
  ]);
  const [work, published, ...done] = await Promise.all([
    callTool<Work>('underemployment_by_education', {}),
    callTool<{ rows: Figure[] }>('published_figures', {}),
    ...LEVELS.map((level) => callTool<Completion>('school_completion', { level })),
  ]);
  const completion = Object.fromEntries(LEVELS.map((l, i) => [l, done[i]])) as Record<Level, Completion>;
  return { unemployment, underemployment, work, completion, published: published.rows };
}

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validity, setValidity] = useState<Validity | null>(null);
  useRevealOnScroll();

  useEffect(() => {
    callTool<Validity>('data_validation').then(setValidity, (e: unknown) =>
      setValidity({ verified: false, reason: `Couldn’t read the validation report (${e instanceof Error ? e.message : e}).`, report: null }));
    load().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <>
      <a className="skip-link btn" href="#main">Skip to content</a>
      <header className="container site-header">
        <span className="wordmark">viz</span>
        <McpModal validity={validity} />
      </header>

      <main id="main" className="container">
        <section className="split intro">
          <h1 className="display" data-reveal>Schooling and work in the Philippines <span className="quiet">what the figures show.</span></h1>
          <p className="lead" data-reveal style={{ '--stagger': 2 } as CSSProperties}>
            Unemployment and underemployment from the Philippine Statistics Authority’s Labor Force Survey, how they
            differ by the level of schooling people completed, and what published studies and employer surveys say
            about hiring. Every figure is checked against its publisher where possible, or labelled as quoted, and read
            through this project’s MCP server.
          </p>
        </section>

        <ValidityBadge v={validity} />

        {error && (
          <p className="card error" role="alert">
            Couldn’t read the data: {error}. Build it with{' '}
            <code className="mention">pnpm nx run @viz/data:build-education</code>, then reload.
          </p>
        )}
        {!data && !error && <p className="caption" aria-live="polite">Loading data from the MCP server…</p>}
        {data && <Tiles data={data} v={validity} />}
        {data && validity && (
          <>
            <Trend data={data} v={validity} />
            <Schooling completion={data.completion} v={validity} />
            <ByEducation work={data.work} v={validity} />
            <Studies rows={data.published} v={validity} />
            <Employers rows={data.published} v={validity} />
          </>
        )}

        <DataValidity v={validity} />
      </main>

      <footer className="container site-footer caption">
        <p>
          Sources: Philippine Statistics Authority, Labor Force Survey (OpenSTAT and press releases) and SDG Watch;
          DepEd administrative data; World Bank PRWP 11163 (CC BY 3.0 IGO); Melchor 2022, Philippine Journal of
          Development (CC BY-NC 4.0); PIDS Policy Note 2024-09 (CC BY-NC). Labour force figures are survey
          estimates; the latest months are preliminary.
        </p>
      </footer>
    </>
  );
}

function Tiles({ data, v }: { data: Data; v: Validity | null }) {
  const tile = (title: string, result: RatesResult, base: string) => {
    const last = result.rows[result.rows.length - 1];
    if (!last) return null;
    return (
      <div className="card tile" data-reveal>
        <dt>{title}, {monthLabel(last.period)}</dt>
        <dd>
          <div className="tile-value">{pct1(last.value)}</div>
          <span className="caption">{last.status === 'preliminary' ? 'preliminary estimate' : 'estimate'} · share of {base}</span>
        </dd>
      </div>
    );
  };
  return (
    <>
      <dl className="tiles">
        {tile('Unemployment rate', data.unemployment, 'the labour force')}
        {tile('Underemployment rate', data.underemployment, 'employed people')}
      </dl>
      <Verified v={v} ids={['lfs-headlines']} />
    </>
  );
}

const MEASURES = [
  ['Unemployment rate', 'unemployment', 'the labour force'],
  ['Underemployment rate', 'underemployment', 'employed people'],
] as const;

// First point of the trailing run of consecutive months: where quarterly rounds give way to monthly ones.
function monthlyFrom(rows: Rate[]) {
  const idx = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7));
  let i = rows.length - 1;
  while (i > 0 && idx(rows[i].period) - idx(rows[i - 1].period) === 1) i--;
  return i > 0 ? rows[i].period : undefined;
}

function Trend({ data, v }: { data: Data; v: Validity }) {
  const [active, setActive] = useState<(typeof MEASURES)[number]>(MEASURES[0]);
  const result = data[active[1]];
  const at = monthlyFrom(result.rows);
  const noCi = !result.rows[result.rows.length - 1]?.ci_low;
  return (
    <section id="trend" className="card chart">
      <h2>Unemployment since 2005</h2>
      <div className="filters" role="radiogroup" aria-label="Measure">
        {MEASURES.map((m) => (
          <label key={m[0]}>
            <input type="radio" name="trend-measure" checked={active === m} onChange={() => setActive(m)} />
            {m[0]}
          </label>
        ))}
      </div>
      <p className="caption">
        {active[0]}, share of {active[2]}.{noCi && ' 95% confidence intervals are not shown yet; PSA publishes them in Table A of each release.'}
      </p>
      <LineChart
        label={`${active[0]} since 2005`}
        caption={`${active[0]}, share of ${active[2]}`}
        points={result.rows.map((r) => ({
          key: r.period, label: monthLabel(r.period), value: r.value,
          ci: r.ci_low != null && r.ci_high != null ? [r.ci_low, r.ci_high] : undefined,
          preliminary: r.status === 'preliminary',
        }))}
        rule={at ? { at, label: `Monthly rounds from ${monthLabel(at)}` } : undefined}
      />
      {result.notes.length > 0 && <ul className="chart-notes caption">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="caption source">Source: <a className="source" href={result.url}>{result.source}</a></p>
      <Verified v={v} ids={['lfs-headlines']} />
    </section>
  );
}

function Schooling({ completion, v }: { completion: Record<Level, Completion>; v: Validity }) {
  const [level, setLevel] = useState<Level>('Elementary');
  const c = completion[level];
  const ph = c.rows.find((r) => r.region_code === 'PH');
  return (
    <section id="schooling" className="card chart">
      <h2>Who finishes school</h2>
      <div className="filters" role="radiogroup" aria-label="School level">
        {LEVELS.map((l) => (
          <label key={l}>
            <input type="radio" name="school-level" checked={level === l} onChange={() => setLevel(l)} />
            {l}
          </label>
        ))}
      </div>
      <p className="caption">
        Completion rate, {level.toLowerCase()}, school year {c.school_year}, both sexes. DepEd administrative,
        enrolment-based figures as published by PSA; shown as published, so some exceed 100%.
      </p>
      <Bars
        key={level}
        columns={['Completion rate']}
        rows={c.rows.filter((r) => r.region_code !== 'PH').map((r) => ({ key: r.region_code, label: r.region, values: [r.value] }))}
        format={(n) => `${n}%`}
        reference={ph && { value: ph.value, label: `Philippines ${ph.value}%` }}
        rowHeader="Region"
        caption={`Completion rate by region, ${level.toLowerCase()}, school year ${c.school_year}`}
      />
      <p className="caption source"><a className="source" href={c.url}>PSA SDG Watch, completion rate</a></p>
      <Verified v={v} ids={['sdg-completion']} />
    </section>
  );
}

const num = new Intl.NumberFormat('en-PH');

function ByEducation({ work, v }: { work: Work; v: Validity }) {
  const levels = [...new Map(work.rows.map((r) => [r.level, r.level_order]))].sort((a, b) => a[1] - b[1]).map((l) => l[0]);
  const rows = levels.map((level) => {
    const mine = work.years.map((y) => work.rows.find((r) => r.level === level && r.period === y));
    return {
      key: level, label: level,
      values: mine.map((r) => r?.rate ?? 0), // a missing cell has no bar: display says so
      display: mine.map((r) => (r ? pct1(r.rate) : 'no figure')),
      detail: mine.map((r, i) => `${work.years[i]}: ${r ? `${num.format(r.underemployed)} thousand underemployed of ${num.format(r.employed)} thousand employed` : 'no figure'}`),
    };
  });
  return (
    <section id="by-education" className="card chart">
      <h2>Underemployment by highest grade completed</h2>
      <p className="caption">
        Underemployed people as a share of employed people, by highest grade completed. This rate is derived here from
        PSA’s counts; PSA doesn’t publish it. The base is all employed people aged 15 and over, not adjusted for age,
        so it isn’t comparable with the 25–34 figures below.
      </p>
      <Bars
        columns={work.years}
        rows={rows}
        format={pct1}
        reference={work.national.rate != null ? { value: work.national.rate, label: `Philippines ${pct1(work.national.rate)}` } : undefined}
        rowHeader="Highest grade completed"
        caption="Underemployed ÷ employed, by highest grade completed"
      />
      <p className="caption source">
        {work.sources.map((s) => <a key={s.url} className="source" href={s.url}>{s.name}</a>)}
      </p>
      <Verified v={v} ids={['lfs-education']} />
    </section>
  );
}

const paperCheck = (v: Validity, f: Figure) =>
  !f.checked_against ? 'Quoted from news coverage; the original survey isn’t public'
    : v.report?.checks.find((c) => c.id === 'published-figures')?.passed && !v.changed?.includes('published_figures.csv') ? 'Checked against the paper'
    : 'Not verified: see “Is this data valid?” below';

function Studies({ rows, v }: { rows: Figure[]; v: Validity }) {
  const groups = new Map<string, Figure[]>();
  for (const r of rows.filter((f) => f.section === 'gap' && f.kind === 'published_estimate'))
    groups.set(`${r.source}|${r.measure}`, [...(groups.get(`${r.source}|${r.measure}`) ?? []), r]);
  return (
    <section id="studies" className="card">
      <h2>What a degree is worth, in published studies</h2>
      <div className="studies">
        {[...groups.values()].map((g) => {
          const first = g[0];
          const pair = g.length > 1;
          const pops = new Set(g.map((r) => r.population));
          const population = pops.size === 1 ? first.population : (first.population.match(/aged (\d+–\d+)/) ? `ages ${first.population.match(/aged (\d+–\d+)/)![1]}` : [...pops].join(', '));
          const years = [...new Set(g.map((r) => r.year))].join(' and ');
          const labels = (r: Figure, i: number) => (first.population.startsWith('college') ? ['People who finished college', 'People with less education'][i] : String(r.year));
          return (
            <article className="study" key={first.id}>
              <h3>{pair ? first.measure.charAt(0).toUpperCase() + first.measure.slice(1) : first.figure}</h3>
              <p className="caption">Published estimate · {population} · {years}</p>
              {pair ? (
                <Bars
                  columns={[first.measure]}
                  rows={g.map((r, i) => ({ key: r.id, label: labels(r, i), values: [r.value] }))}
                  format={(n) => `${n}%`}
                  rowHeader="Group"
                  caption={first.measure}
                />
              ) : (
                <p className="stat">{first.value}%<span className="caption"> more, {first.measure}</span></p>
              )}
              <p className="caption">
                <a href={first.url}>{first.source}</a> · {paperCheck(v, first)}
              </p>
            </article>
          );
        })}
      </div>
      <p className="caption">These figures describe differences between groups; they don’t show that the degree causes them.</p>
    </section>
  );
}

function Employers({ rows, v }: { rows: Figure[]; v: Validity }) {
  const cards = rows.filter((f) => f.section === 'employers');
  return (
    <section id="employers" className="card">
      <h2>What employers say</h2>
      <div className="employer-grid">
        {cards.map((f) => (
          <article className="card" key={f.id}>
            <p className="caption">{f.kind === 'employer_self_report' ? 'Self-reported by employers' : 'Study estimate'}</p>
            <p className="stat">{f.value}%</p>
            <p>{f.figure}</p>
            {f.id === 'jobstreet-2023-pup' && (
              <p>PUP leads where employers actually hire; UP (University of the Philippines) leads where they wish applicants came from.</p>
            )}
            <p className="caption">{f.kind === 'study_estimate' ? `Published ${f.year} · ${f.population}` : `Year: ${f.year}`}</p>
            <p className="caption">{f.sample === 'not published' ? 'Sample size not published' : `Sample: ${f.sample}`}</p>
            {f.kind === 'study_estimate' && <p className="caption">Measure: {f.measure}</p>}
            {f.id === 'melchor-2022-overeducated' && (
              <p className="caption">The paper treats this job-analysis figure as the upper bound estimate of overeducation; its other two methods give about 10% and about 25%.</p>
            )}
            <p className="caption"><a href={f.url}>{f.source}</a></p>
            <p className="caption">{paperCheck(v, f)}</p>
          </article>
        ))}
      </div>
      <p className="caption">
        No dataset of Philippine job ads or hiring decisions exists, so these figures show what employers say, not what they do.
      </p>
    </section>
  );
}

export default App;
