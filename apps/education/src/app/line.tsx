// Line chart: one ink line, an optional 95% CI band, a labelled vertical rule, a keyboard
// cursor (one tab stop) with a tooltip, and a table view. Y always starts at 0.
import { useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import './line.css';

export type LinePoint = { key: string; label: string; value: number; ci?: [number, number]; preliminary?: boolean };

const W = 800, H = 320;
const PAD = { l: 44, r: 16, t: 16, b: 28 };
const pct = (n: number) => `${n.toFixed(1)}%`;
const ciText = (ci: [number, number]) => `95% CI ${ci[0].toFixed(1)}–${ci[1].toFixed(1)}%`;
const status = (p: LinePoint) => (p.preliminary ? 'preliminary estimate' : 'estimate');

export function LineChart({ points, label, caption, rule, max: fixedMax }: {
  points: LinePoint[];
  label: string;
  caption: string;
  rule?: { at: string; label: string };
  max?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
  const top = Math.max(0, ...points.flatMap((p) => [p.value, ...(p.ci ?? [])]));
  const max = fixedMax ?? (Math.max(5, Math.ceil(top / 5) * 5));
  const n = points.length;
  const x = (i: number) => PAD.l + (n > 1 ? (i / (n - 1)) * (W - PAD.l - PAD.r) : 0);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const step = max > 20 ? 10 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
  // Band: one closed shape per run of consecutive points that have a ci.
  let band = '';
  for (let i = 0; i < n; ) {
    if (!points[i].ci) { i++; continue; }
    let j = i;
    while (j + 1 < n && points[j + 1].ci) j++;
    const idx = Array.from({ length: j - i + 1 }, (_, k) => i + k);
    const up = idx.map((k) => `${k === i ? 'M' : 'L'}${x(k).toFixed(1)} ${y(points[k].ci![1]).toFixed(1)}`);
    const down = idx.reverse().map((k) => `L${x(k).toFixed(1)} ${y(points[k].ci![0]).toFixed(1)}`);
    band += `${up.join('')}${down.join('')}Z`;
    i = j + 1;
  }

  // Year labels at each first point of a year, thinned so they stay ~56 units apart.
  const years: { i: number; text: string }[] = [];
  let lastX = -Infinity;
  points.forEach((p, i) => {
    const yr = p.key.slice(0, 4);
    if (i > 0 && points[i - 1].key.slice(0, 4) === yr) return;
    if (x(i) - lastX < 56) return;
    years.push({ i, text: yr });
    lastX = x(i);
  });

  const ruleIdx = rule ? points.findIndex((p) => p.key === rule.at) : -1;

  const pos = (svg: SVGSVGElement, i: number) => {
    const box = svg.getBoundingClientRect();
    return { x: box.left + (x(i) / W) * box.width, y: box.top + (y(points[i].value) / H) * box.height };
  };
  const activate = (svg: SVGSVGElement | null, i: number) => {
    if (!svg || !points[i]) return;
    setActive(i);
    setTipPos(pos(svg, i));
  };
  const svgOf = (el: HTMLElement) => el.querySelector<SVGSVGElement>('.line-svg');
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if (active === null) activate(svgOf(e.currentTarget), n - 1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const cur = active ?? n - 1;
    const next = e.key === 'ArrowLeft' ? cur - 1 : e.key === 'ArrowRight' ? cur + 1
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    activate(svgOf(e.currentTarget), Math.min(n - 1, Math.max(0, next)));
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const svg = svgOf(e.currentTarget);
    if (!svg || !n) return;
    const box = svg.getBoundingClientRect();
    const ux = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - ux) < Math.abs(x(best) - ux)) best = i;
    activate(svg, best);
  };
  const hide = () => { setActive(null); setTipPos(null); };

  const p = active !== null ? points[active] : null;
  const tipText = p ? `${pct(p.value)}, ${p.label}, ${status(p)}${p.ci ? `, ${ciText(p.ci)}` : ''}` : '';

  return (
    <figure className="line" data-reveal>
      <div
        className="line-plot"
        tabIndex={0}
        role="group"
        aria-roledescription="line chart"
        aria-label={label}
        onFocus={onFocus}
        onBlur={hide}
        onKeyDown={onKeyDown}
        onPointerMove={onMove}
        onPointerLeave={hide}
      >
        <svg className="line-svg" viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
          <g className="line-y">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
                <text x={PAD.l - 8} y={y(t) + 4}>{`${t}%`}</text>
              </g>
            ))}
          </g>
          <g className="line-x">
            {years.map((yr) => <text key={yr.i} x={x(yr.i)} y={H - 8}>{yr.text}</text>)}
          </g>
          {band && <path className="line-band" d={band} />}
          <path className="line-path" d={path} />
          {rule && ruleIdx >= 0 && (
            <>
              <line className="line-rule" x1={x(ruleIdx)} x2={x(ruleIdx)} y1={PAD.t} y2={H - PAD.b} />
              <text className="line-rule-label" x={x(ruleIdx) + 6} y={PAD.t + 12}>{rule.label}</text>
            </>
          )}
          {active !== null && p && (
            <>
              <line className="line-cursor" x1={x(active)} x2={x(active)} y1={PAD.t} y2={H - PAD.b} />
              <circle className="line-cursor-dot" cx={x(active)} cy={y(p.value)} r={5} />
            </>
          )}
        </svg>
      </div>
      {p && tipPos && (
        <div className="tooltip" role="presentation" style={{ left: tipPos.x, top: tipPos.y }}>
          <strong>{pct(p.value)}</strong>
          <span>{p.label}</span>
          <span className="caption">{status(p)}</span>
          {p.ci && <span className="caption">{ciText(p.ci)}</span>}
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">{tipText}</p>
      <details className="bars-table">
        <summary className="caption">Show table</summary>
        <table>
          <caption className="caption">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Rate</th>
              <th scope="col">95% CI</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {points.map((pt) => (
              <tr key={pt.key}>
                <th scope="row">{pt.label}</th>
                <td>{pct(pt.value)}</td>
                <td>{pt.ci ? `${pt.ci[0].toFixed(1)}–${pt.ci[1].toFixed(1)}%` : '–'}</td>
                <td>{status(pt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
