import { useEffect, useState, type CSSProperties } from 'react';
import { callTool } from './mcp';
import { McpModal } from './mcpmodal';
import { useRevealOnScroll } from './motion';
import { DataValidity, ValidityBadge, type Validity } from './validity';
import './app.css';

type Rate = { period: string; frequency: 'month' | 'year'; measure: string; value: number; status: string;
  ci_low: number | null; ci_high: number | null };
type RatesResult = { source: string; url: string; notes: string[]; rows: Rate[] };
type Data = { unemployment: RatesResult; underemployment: RatesResult };

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
  return { unemployment, underemployment };
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
            about hiring. Every figure is checked against the publishers’ own tables and read through this
            project’s MCP server.
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
        {data && <Tiles data={data} />}

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

function Tiles({ data }: { data: Data }) {
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
    <dl className="tiles">
      {tile('Unemployment rate', data.unemployment, 'the labour force')}
      {tile('Underemployment rate', data.underemployment, 'employed people')}
    </dl>
  );
}

export default App;
