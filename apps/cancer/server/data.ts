// Read-only access to the verified tables in data/clean (built by `nx run @viz/data:build`).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The repo's data/ folder by default; VIZ_DATA_DIR overrides it for bundled deployments.
const DATA = process.env.VIZ_DATA_DIR ? pathToFileURL(`${process.env.VIZ_DATA_DIR}/`) : new URL('../../../data/', import.meta.url);
const CLEAN = new URL('clean/', DATA);
const README = new URL('README.md', DATA);

export type Death = {
  year: number; region_code: string; region: string; cause_code: string; cause: string;
  icd10: string; age_group: string; sex: string; deaths: number;
};
export type Population = {
  year: number; region_code: string; region: string; measure: string;
  age_group: string; sex: string; value: number;
};
export type Estimate = {
  year: number; measure: string; sex: string; cancer_code: string; cancer: string; icd10: string;
  count: number; asr_world: number | null; crude_rate: number | null; cum_risk_74: number | null;
  rank: number | null;
};

export type Survival = {
  source: string; population: string; place: string; period: string; age: string; site: string; measure: string;
  pct: number; bound: string; se: number | null; cases: number | null; censored_pct: number | null;
};

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function load<T>(name: string, numeric: string[]): T[] {
  let text: string;
  try {
    text = readFileSync(new URL(`${name}.csv`, CLEAN), 'utf8');
  } catch {
    throw new Error(`data/clean/${name}.csv is missing; run \`pnpm nx run @viz/data:build\``);
  }
  const [header, ...lines] = text.trimEnd().split('\n').map(parseLine);
  return lines.map((cells) => Object.fromEntries(header.map((h, i) => [
    h, numeric.includes(h) ? (cells[i] === '' ? null : Number(cells[i])) : cells[i],
  ])) as T);
}

let cache: { deaths: Death[]; population: Population[]; estimates: Estimate[]; survival: Survival[] } | undefined;

export function tables() {
  cache ??= {
    deaths: load<Death>('neoplasm_deaths', ['year', 'deaths']),
    population: load<Population>('population', ['year', 'value']),
    estimates: load<Estimate>('globocan', ['year', 'count', 'asr_world', 'crude_rate', 'cum_risk_74', 'rank']),
    survival: load<Survival>('survival', ['pct', 'se', 'cases', 'censored_pct']),
  };
  return cache;
}

export const readme = () => readFileSync(README, 'utf8');

type Report = {
  status: 'pass' | 'fail';
  checked_at: string;
  checks: { id: string; title: string; against: string; assertions: number; passed: boolean; failures: string[] }[];
  files: Record<string, string>;
  sources: { name: string; retrieved: string | null; url: string }[];
};

/**
 * The ground-truth report from data/check.py, plus whether the files served right now are the
 * files it verified (by SHA-256). Data is only "verified" if every check passed and nothing
 * changed since.
 */
export function validation() {
  let report: Report;
  try {
    report = JSON.parse(readFileSync(new URL('validation.json', CLEAN), 'utf8'));
  } catch {
    return { verified: false, reason: 'No validation report: run `pnpm nx run @viz/data:build`.', report: null };
  }
  const changed = Object.entries(report.files).filter(([name, hash]) => {
    try {
      return createHash('sha256').update(readFileSync(new URL(name, CLEAN))).digest('hex') !== hash;
    } catch {
      return true;
    }
  }).map(([name]) => name);
  const failed = report.checks.filter((c) => !c.passed).map((c) => c.title);
  const verified = report.status === 'pass' && changed.length === 0;
  const reason = verified ? null
    : changed.length ? `Changed since the last check: ${changed.join(', ')}.`
    : `Failed checks: ${failed.join(', ')}.`;
  return { verified, reason, changed, report };
}
