// Tool-level checks for the viz-education MCP server. Run: pnpm nx test education
//
// EXPECTED TO FAIL until the August 2026 LFS press release (Table A-1) is pinned in data/fetch_education.py
// (psa.gov.ph is Cloudflare-blocked from the dev box, so fetch_education.table_a1() returns {} today):
//   - labour_rates for a Table A-1 month equals the press release
//   - labour_rates for 2024 annual equals the press release
//   - underemployment_by_education 2024 total is within 0.05 of Table A-1's 2024 Underemployment rate
//   - data_validation is verified with 4 passed checks (lfs-headlines fails while nothing is pinned)
// Every other test passes once the server exists. Expected Table A-1 values come from the pinned release via
// python3, never from the CSVs (that would be circular).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpServer } from './mcp.ts';

const client = new Client({ name: 'test', version: '0' });
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0].text;
  return res.isError ? { error: text } : JSON.parse(text);
};

// Table A-1 of the pinned press release: Map "period|measure" -> { value, status }.
const dataDir = new URL('../../../data/', import.meta.url).pathname;
const tableA1 = () => {
  const out = execFileSync(
    'python3',
    ['-c', 'import sys,json;sys.path.insert(0,sys.argv[1]);import fetch_education as f;print(json.dumps([[p,m,v,s] for (p,m),(v,s) in f.table_a1().items()]))', dataDir],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const rows = JSON.parse(out.trim().split('\n').pop() as string) as [string, string, number, string][];
  assert.ok(rows.length > 0, 'no LFS press release pinned (Table A-1 empty): pin psa-lfs-press-release-*.pdf in data/fetch_education.py');
  return new Map(rows.map(([p, m, v, s]) => [`${p}|${m}`, { value: v, status: s }]));
};

before(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(a);
  await client.connect(b);
});
after(() => client.close());

test('labour_rates: a Table A-1 month equals the press release', async () => {
  const a1 = tableA1();
  const months = [...a1.keys()].filter((k) => k.endsWith('|Unemployment rate') && k.length > 'YYYY|Unemployment rate'.length).map((k) => k.split('|')[0]).sort();
  assert.ok(months.length > 0, 'Table A-1 has no monthly Unemployment rate');
  const m = months[months.length - 1];
  const { rows } = await call('labour_rates', { measure: 'Unemployment rate', frequency: 'month', from: m, to: m });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].period, m);
  assert.equal(rows[0].value, a1.get(`${m}|Unemployment rate`)!.value);
});

test('labour_rates: every Table A-1 cell for 2024 annual matches', async () => {
  const a1 = tableA1();
  const { rows } = await call('labour_rates', { frequency: 'year', from: '2024', to: '2024' });
  const by = Object.fromEntries(rows.map((r: { measure: string; value: number }) => [r.measure, r.value]));
  for (const m of ['Labor force participation rate', 'Employment rate', 'Unemployment rate', 'Underemployment rate']) {
    assert.equal(by[m], a1.get(`2024|${m}`)!.value, m);
  }
});

test('labour_rates: filters, ordering, denominators and source', async () => {
  const r = await call('labour_rates', { measure: 'Underemployment rate', frequency: 'year' });
  assert.ok(r.rows.length > 0);
  assert.ok(r.rows.every((x: { measure: string; frequency: string }) => x.measure === 'Underemployment rate' && x.frequency === 'year'));
  const periods = r.rows.map((x: { period: string }) => x.period);
  assert.deepEqual(periods, [...periods].sort());
  assert.equal(r.denominators['Underemployment rate'], 'employed people');
  assert.equal(r.denominators['Unemployment rate'], 'the labour force');
  assert.equal(r.denominators['Labor force participation rate'], 'the household population aged 15 and over');
  assert.match(r.url, /openstat\.psa\.gov\.ph.*0021B3FKEI2\.px\/$/);
  assert.ok(Array.isArray(r.notes) && r.notes.length > 0);
  assert.equal(typeof r.precision, 'string');
  const win = await call('labour_rates', { measure: 'Employment rate', frequency: 'month', from: '2024-01', to: '2024-03' });
  assert.deepEqual(win.rows.map((x: { period: string }) => x.period), ['2024-01', '2024-02', '2024-03']);
  assert.ok((await call('labour_rates', { from: '24' })).error);
});

test('underemployment_by_education: 2024 all-levels total matches labour_rates own Underemployment rate', async () => {
  const u = await call('underemployment_by_education', { period: '2024' });
  const { rows } = await call('labour_rates', { measure: 'Underemployment rate', frequency: 'year', from: '2024', to: '2024' });
  assert.equal(rows.length, 1);
  assert.equal(u.totals.length, 1);
  assert.equal(u.totals[0].period, '2024');
  assert.ok(Math.abs(u.totals[0].rate - rows[0].value) <= 0.05, `${u.totals[0].rate} vs ${rows[0].value}`);
});

test('underemployment_by_education: 2024 all-levels total is within 0.05 of Table A-1', async () => {
  const published = tableA1().get('2024|Underemployment rate')!.value;
  const u = await call('underemployment_by_education', { period: '2024' });
  assert.ok(Math.abs(u.totals[0].rate - published) <= 0.05, `${u.totals[0].rate} vs ${published}`);
});

test('underemployment_by_education: rows in level order, rates derived, totals add up', async () => {
  const u = await call('underemployment_by_education', { period: '2024' });
  const order = u.rows.map((r: { level_order: number }) => r.level_order);
  assert.ok(order.length > 1);
  assert.deepEqual(order, [...order].sort((a: number, b: number) => a - b));
  for (const r of u.rows) assert.equal(r.rate, Math.round((r.underemployed / r.employed) * 1000) / 10);
  const e = u.rows.reduce((s: number, r: { employed: number }) => s + r.employed, 0);
  const x = u.rows.reduce((s: number, r: { underemployed: number }) => s + r.underemployed, 0);
  assert.ok(Math.abs(u.totals[0].employed - e) < 0.01 && Math.abs(u.totals[0].underemployed - x) < 0.01);
  assert.equal(u.totals[0].rate, Math.round((u.totals[0].underemployed / u.totals[0].employed) * 1000) / 10);
});

test('underemployment_by_education: no period returns every complete year, plus national and sources', async () => {
  const u = await call('underemployment_by_education');
  assert.ok(u.years.length >= 2);
  assert.deepEqual(u.years, [...u.years].sort());
  assert.deepEqual(u.totals.map((t: { period: string }) => t.period), u.years);
  assert.ok(u.years.every((y: string) => /^\d{4}$/.test(y)));
  assert.equal(u.national.period, u.years[u.years.length - 1]);
  const { rows } = await call('labour_rates', { measure: 'Underemployment rate', frequency: 'year', from: u.national.period, to: u.national.period });
  assert.equal(u.national.rate, rows[0].value);
  assert.match(u.derived, /not publish/);
  assert.equal(u.sources.length, 2);
  assert.match(u.sources[0].url, /0141B3FEMP7\.px\/$/);
  assert.match(u.sources[1].url, /0151B3FUDR2\.px\/$/);
  const keys = (r: { period: string; level_order: number }) => `${r.period}|${String(r.level_order).padStart(3, '0')}`;
  const ks = u.rows.map(keys);
  assert.deepEqual(ks, [...ks].sort());
});

test('school_completion: defaults to national-capable rows for the latest school year', async () => {
  const c = await call('school_completion');
  assert.equal(c.indicator, 'completion_rate');
  assert.ok(c.rows.length > 0);
  assert.ok(c.rows.every((r: { school_year: string; sex: string; indicator: string }) => r.school_year === c.school_year && r.sex === 'Both Sexes' && r.indicator === 'completion_rate'));
  assert.ok(c.rows.some((r: { region_code: string }) => r.region_code === 'PH'));
  assert.match(c.note, /EBEIS/);
  assert.match(c.url, /0023I3C0412\.px\/$/);
  const old = await call('school_completion', { school_year: '2000', level: 'Elementary', region: 'PH' });
  assert.deepEqual(old.rows.map((r: { value: number }) => r.value), [62.7]); // PSA SDG Watch national row
});

test('school_completion: cohort survival uses its own table and region matching', async () => {
  const c = await call('school_completion', { indicator: 'cohort_survival_rate', level: 'Elementary', region: 'PH' });
  assert.equal(c.indicator, 'cohort_survival_rate');
  assert.match(c.url, /0033I3C41S1\.px\/$/);
  assert.ok(c.rows.length > 0 && c.rows.every((r: { region_code: string; level: string }) => r.region_code === 'PH' && r.level === 'Elementary'));
});

test('published_figures: all 11 quoted figures, sections filter', async () => {
  const all = await call('published_figures');
  assert.deepEqual(all.rows.map((r: { id: string }) => r.id).sort(), [
    'jobstreet-2023-pup', 'jobstreet-alma-mater-2014', 'jobstreet-alma-mater-2015', 'jobstreet-alma-mater-2016',
    'melchor-2022-overeducated', 'pbed-2024-college-share', 'pids-return-college-2010', 'pids-return-college-2022',
    'wb-earnings-premium-2024', 'wb-unemployment-college-25-34', 'wb-unemployment-less-25-34',
  ]);
  assert.match(all.note, /not comparable/);
  const wb = all.rows.find((r: { id: string }) => r.id === 'wb-unemployment-college-25-34');
  assert.deepEqual([wb.value, wb.year, wb.kind], [6.7, 2024, 'published_estimate']);
  for (const section of ['gap', 'employers']) {
    const s = await call('published_figures', { section });
    assert.ok(s.rows.length > 0 && s.rows.every((r: { section: string }) => r.section === section));
  }
});

test('about_the_data returns the README as text', async () => {
  const res = await client.callTool({ name: 'about_the_data', arguments: {} });
  const text = (res.content as { text: string }[])[0].text;
  assert.ok(text.length > 100 && !res.isError);
});

test('data validation: 4 ground-truth checks passed and served files match', async () => {
  const v = await call('data_validation');
  assert.equal(v.verified, true, v.reason);
  assert.deepEqual(v.report.checks.map((c: { id: string }) => c.id).sort(), ['lfs-education', 'lfs-headlines', 'published-figures', 'sdg-completion']);
  assert.ok(v.report.checks.every((c: { passed: boolean; assertions: number }) => c.passed && c.assertions > 0));
  assert.deepEqual(Object.keys(v.report.files).sort(), ['completion.csv', 'education_work.csv', 'labour_rates.csv', 'published_figures.csv']);
});

test('every tool is read-only', async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
});

test('stdio lists the six tools', async () => {
  const stdio = new Client({ name: 'test-stdio', version: '0' });
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('./stdio.ts', import.meta.url).pathname] }));
  try {
    const { tools } = await stdio.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['about_the_data', 'data_validation', 'labour_rates', 'published_figures', 'school_completion', 'underemployment_by_education']);
  } finally {
    await stdio.close();
  }
});
