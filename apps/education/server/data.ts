// Read-only access to the verified tables in data/clean-education (built by `nx run @viz/data:build-education`).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The repo's data/ folder by default; VIZ_DATA_DIR overrides it for bundled deployments.
const DATA = process.env.VIZ_DATA_DIR ? pathToFileURL(`${process.env.VIZ_DATA_DIR}/`) : new URL('../../../data/', import.meta.url);
const CLEAN = new URL('clean-education/', DATA);
const README = new URL('README.md', DATA);

export type LabourRate = {
  period: string; frequency: 'month' | 'year'; measure: string; value: number; status: string;
  ci_low: number | null; ci_high: number | null;
};
export type EducationWork = {
  period: string; frequency: 'month' | 'year'; level_order: number; level: string; employed: number; underemployed: number;
};
export type Completion = {
  school_year: string; region_code: string; region: string; level: string; sex: string;
  indicator: 'completion_rate' | 'cohort_survival_rate'; value: number;
};
export type PublishedFigure = {
  id: string; section: 'gap' | 'employers'; figure: string; value: number | null; unit: string; measure: string;
  population: string; year: number; sample: string; kind: 'published_estimate' | 'employer_self_report' | 'study_estimate';
  source: string; url: string; quote: string; checked_against: string;
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
    throw new Error(`data/clean-education/${name}.csv is missing; run \`pnpm nx run @viz/data:build-education\``);
  }
  const [header, ...lines] = text.trimEnd().split('\n').map(parseLine);
  return lines.map((cells) => Object.fromEntries(header.map((h, i) => [
    h, numeric.includes(h) ? (cells[i] === '' ? null : Number(cells[i])) : cells[i],
  ])) as T);
}

let cache: { rates: LabourRate[]; work: EducationWork[]; completion: Completion[]; published: PublishedFigure[] } | undefined;

export function tables() {
  cache ??= {
    rates: load<LabourRate>('labour_rates', ['value', 'ci_low', 'ci_high']),
    work: load<EducationWork>('education_work', ['level_order', 'employed', 'underemployed']),
    completion: load<Completion>('completion', ['value']),
    published: load<PublishedFigure>('published_figures', ['value', 'year']),
  };
  return cache;
}

/** Only the '## Education' section of the shared README: up to the next '## ' heading or the end. */
export function readme() {
  const text = readFileSync(README, 'utf8');
  const start = text.search(/^## Education[ \t]*$/m);
  if (start < 0) throw new Error("data/README.md has no '## Education' section");
  const rest = text.slice(start + 1);
  const next = rest.search(/^## /m);
  return (next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)).trimEnd() + '\n';
}

export type Report = {
  status: 'pass' | 'fail';
  checked_at: string;
  checks: { id: string; title: string; against: string; assertions: number; passed: boolean; failures: string[] }[];
  files: Record<string, string>;
  sources: { name: string; retrieved: string | null; url: string; table?: string; notes?: string[] }[];
};

/**
 * The ground-truth report from data/check_education.py, plus whether the files served right now are the
 * files it verified (by SHA-256). Data is only "verified" if every check passed and nothing
 * changed since.
 */
export function validation() {
  let report: Report;
  try {
    report = JSON.parse(readFileSync(new URL('validation.json', CLEAN), 'utf8'));
  } catch {
    return { verified: false, reason: 'No validation report: run `pnpm nx run @viz/data:build-education`.', report: null };
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
