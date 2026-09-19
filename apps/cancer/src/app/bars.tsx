// Ranked horizontal bars: one ink series per column, value at the tip, a tooltip on hover
// and keyboard focus, a reference line, and a table view. Columns share one scale.
import { useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';

// display overrides the formatted value per column, e.g. "≤12.5%" for an upper bound.
export type BarRow = { key: string; label: string; values: number[]; detail?: string[]; display?: string[] };
type Tip = { x: number; y: number; row: BarRow; column: number };

export function Bars({ rows, columns, format, reference, caption, max: fixedMax }: {
  rows: BarRow[];
  columns: string[];
  format: (n: number, column: number) => string;
  reference?: { value: number; label: string };
  caption: string;
  max?: number; // fixed scale, e.g. 100 for percentages
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const max = fixedMax ?? (Math.max(...rows.flatMap((r) => r.values), reference?.value ?? 0) || 1);
  const valueText = (row: BarRow, i: number) => row.display?.[i] ?? format(row.values[i], i);
  const pct = (n: number) => `${(n / max) * 100}%`;
  const show = (row: BarRow, column: number) => (e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = 'clientX' in e ? e.clientX : box.left + box.width / 2;
    setTip({ x, y: box.top, row, column });
  };

  return (
    <figure className="bars" data-reveal style={{ '--columns': columns.length } as CSSProperties}>
      {columns.length > 1 && (
        <div className="bars-row bars-head" aria-hidden="true">
          <span />
          {columns.map((c) => <span key={c} className="caption">{c}</span>)}
        </div>
      )}
      {rows.map((row, r) => (
        <div className="bars-row" key={row.key} style={{ '--row': r } as CSSProperties}>
          <span className="bars-label">{row.label}</span>
          {row.values.map((v, i) => (
            <div
              key={i}
              className="bars-track"
              tabIndex={0}
              aria-label={`${row.label}${columns.length > 1 ? `, ${columns[i]}` : ''}: ${valueText(row, i)}`}
              onPointerMove={show(row, i)}
              onFocus={show(row, i)}
              onPointerLeave={() => setTip(null)}
              onBlur={() => setTip(null)}
            >
              <div className="bars-plot">
                {reference && <span className="bars-ref" style={{ left: pct(reference.value) }} />}
                <span className="bars-bar" style={{ width: pct(v) }} />
                <span className="bars-value">{valueText(row, i)}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
      {reference && (
        <div className="bars-row bars-foot" aria-hidden="true">
          <span />
          <div className="bars-track">
            <div className="bars-plot">
              <span className="bars-ref-label caption" style={{ left: pct(reference.value) }}>{reference.label}</span>
            </div>
          </div>
        </div>
      )}
      {tip && (
        <div className="tooltip" role="presentation" style={{ left: tip.x, top: tip.y }}>
          <strong>{valueText(tip.row, tip.column)}</strong>
          <span>{tip.row.label}{columns.length > 1 ? ` · ${columns[tip.column]}` : ''}</span>
          {tip.row.detail?.map((d) => <span key={d} className="caption">{d}</span>)}
        </div>
      )}
      <details className="bars-table">
        <summary className="caption">Show table</summary>
        <table>
          <caption className="caption">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{columns.length > 1 ? 'Site' : ''}</th>
              {columns.map((c) => <th scope="col" key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                {r.values.map((_, i) => <td key={i}>{valueText(r, i)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
