// Tells readers whether the numbers are valid: the ground-truth checks from data/check.py, as
// reported by the MCP server's data_validation tool (which also re-hashes the files it serves).

export type Check = { id: string; title: string; against: string; assertions: number; passed: boolean; failures: string[] };
export type Validity = {
  verified: boolean;
  reason: string | null;
  changed?: string[];
  report: {
    status: 'pass' | 'fail';
    checked_at: string;
    checks: Check[];
    files: Record<string, string>;
    sources: { name: string; retrieved: string | null; url: string }[];
  } | null;
};

const int = new Intl.NumberFormat('en-PH');
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
const SHORT: Record<string, string> = {
  'psa-headlines': 'PSA Table 10',
  'psa-table12': 'PSA Table 12',
  'psa-arithmetic': 'internal totals',
  population: 'the 2024 Census',
  globocan: 'the IARC fact sheet',
  survival: 'the published studies',
};
const list = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** One line at the top of the page: verified, or why not. */
export function ValidityBadge({ v }: { v: Validity | null }) {
  if (!v) return <p className="validity caption" aria-live="polite">Checking the data against its sources…</p>;
  const checks = v.report?.checks ?? [];
  if (!v.verified) {
    return (
      <p className="validity validity-warn" role="alert">
        <span aria-hidden="true">⚠</span> <strong>Not verified.</strong> {v.reason} Treat the figures below with
        caution. <a href="#data-validity">Details</a>
      </p>
    );
  }
  const assertions = checks.reduce((n, c) => n + c.assertions, 0);
  return (
    <p className="validity">
      <span aria-hidden="true">✓</span> <strong>Verified against the publishers.</strong> All {checks.length}{' '}
      ground-truth checks passed ({int.format(assertions)} comparisons), last run {date(v.report!.checked_at)}.{' '}
      <a href="#data-validity">How we check</a>
    </p>
  );
}

/** A chart's own verification line, for the checks that cover its numbers. */
export function Verified({ v, ids }: { v: Validity | null; ids: string[] }) {
  if (!v?.report) return null;
  const checks = v.report.checks.filter((c) => ids.includes(c.id));
  const ok = v.verified && checks.every((c) => c.passed);
  return (
    <p className={`verified caption${ok ? '' : ' verified-warn'}`} title={checks.map((c) => c.against).join('\n')}>
      <span aria-hidden="true">{ok ? '✓' : '⚠'}</span>{' '}
      {ok ? `Verified against ${list(ids.map((id) => SHORT[id] ?? id))}` : 'Not verified: see “Is this data valid?” below'}
    </p>
  );
}

/** The full account: every check, the sources and the caveats. */
export function DataValidity({ v }: { v: Validity | null }) {
  const report = v?.report;
  return (
    <section id="data-validity" className="card validity-section" aria-labelledby="validity-heading" data-reveal>
      <h2 id="validity-heading" className="card-heading">Is this data valid?</h2>
      {!report ? (
        <p className="caption">{v ? v.reason : 'Checking…'}</p>
      ) : (
        <>
          <p className="lead-sm">
            {v!.verified
              ? 'Yes, as far as it can be checked. Every number on this page comes from a snapshot that was compared, ' +
                'cell by cell, with the publisher’s own tables, and the files served now are byte-for-byte the ones ' +
                'that were checked.'
              : `Not right now. ${v!.reason}`}
          </p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Ground-truth checks table">
          <table className="panel-table validity-table">
            <caption className="caption">Ground-truth checks, last run {date(report.checked_at)}</caption>
            <thead>
              <tr><th scope="col">Check</th><th scope="col">Compared against</th><th scope="col">Comparisons</th><th scope="col">Result</th></tr>
            </thead>
            <tbody>
              {report.checks.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.title}</th>
                  <td>{c.against}</td>
                  <td className="num">{int.format(c.assertions)}</td>
                  <td>
                    {c.passed
                      ? <><span aria-hidden="true">✓</span> Passed</>
                      : <><span aria-hidden="true">⚠</span> {c.failures.length} failed<span className="caption">{c.failures[0]}</span></>}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row">Served files unchanged</th>
                <td>SHA-256 of {Object.keys(report.files).join(', ')} at check time</td>
                <td className="num">{Object.keys(report.files).length}</td>
                <td>
                  {v!.changed?.length
                    ? <><span aria-hidden="true">⚠</span> Changed: {v!.changed.join(', ')}</>
                    : <><span aria-hidden="true">✓</span> Identical</>}
                </td>
              </tr>
            </tbody>
          </table>
          </div>

          <div className="validity-grid">
            <div>
              <h3 className="validity-subhead">Sources</h3>
              <ul className="validity-list">
                {report.sources.map((s) => (
                  <li key={s.name}>
                    <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
                    {s.retrieved && <span className="caption"> · retrieved {date(s.retrieved)}</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="validity-subhead">Valid, but read with care</h3>
              <ul className="validity-list">
                <li>Registered deaths are counts of registrations, not adjusted for deaths that go unregistered.</li>
                <li>GLOBOCAN figures are modelled estimates, not counts; its deaths won’t match PSA’s.</li>
                <li>2025 and 2026 figures are still provisional at PSA and aren’t included.</li>
                <li>Survival figures are from Metro Manila only, adults 1998–2002 and children 2006–2017.</li>
                <li>Regional death rates are crude: they aren’t adjusted for regions’ different age profiles.</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
