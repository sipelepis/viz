// Tool-level checks against figures already verified by data/check.py. Run: pnpm nx test cancer
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './mcp.ts';

const client = new Client({ name: 'test', version: '0' });
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0].text;
  return res.isError ? { error: text } : JSON.parse(text);
};

before(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(a);
  await client.connect(b);
});
after(() => client.close());

test('registered deaths match PSA 2024 Table 10', async () => {
  const { rows } = await call('registered_cancer_deaths', { region: 'PH', cause: '1-026' });
  assert.deepEqual(rows.map((r: { deaths: number }) => r.deaths), [77504]);
});

test('region names resolve exactly before falling back to substrings', async () => {
  for (const region of ['Region I', 'Ilocos Region']) {
    const { rows } = await call('registered_cancer_deaths', { region, cause: 'total' });
    assert.deepEqual(rows.map((r: { region: string }) => r.region), ['REGION I (ILOCOS REGION)']);
  }
});

test('ambiguous cause is an error, national crude rate is 68.8', async () => {
  assert.match((await call('cancer_death_rates', { cause: 'neoplasm' })).error, /matches 1-026 Neoplasms; 1-027/);
  const { rows } = await call('cancer_death_rates');
  assert.equal(rows.find((r: { region_code: string }) => r.region_code === 'PH').rate_per_100k, 68.8);
});

test('mortality-to-incidence ratio', async () => {
  const { rows } = await call('mortality_incidence_ratio');
  const by = Object.fromEntries(rows.map((r: { cancer: string }) => [r.cancer, r]));
  assert.equal(rows[0].cancer, 'All cancers');
  assert.deepEqual([by['All cancers'].new_cases, by['All cancers'].deaths, by['All cancers'].mir], [149852, 86338, 0.576]);
  assert.deepEqual([by.Colorectum.new_cases, by.Colorectum.deaths], [17462, 9302]); // fact sheet "Colorectum"
  assert.ok(!rows.some((r: { cancer: string }) => ['Colon', 'Rectum', 'Anus'].includes(r.cancer)));
  const male = await call('mortality_incidence_ratio', { sex: 'Male' });
  assert.ok(!male.rows.some((r: { cancer: string }) => r.cancer === 'Cervix uteri'));
});

test('survival: published figures, adults and children', async () => {
  const adults = await call('cancer_survival', { age: 'adults', population: 'Philippine residents' });
  const by = Object.fromEntries(adults.rows.map((r: { site: string; pct: number }) => [r.site, r.pct]));
  assert.deepEqual([adults.rows.length, by.Breast, by.Leukaemia, by.Thyroid], [9, 58.6, 5.2, 82.4]);
  const kids = await call('cancer_survival', { age: '0-19' });
  assert.equal(kids.rows.length, 6);
  const wilms = kids.rows.find((r: { site: string }) => r.site === 'Nephroblastoma');
  assert.deepEqual([wilms.pct, wilms.bound, wilms.cases], [12.5, '≤', 148]);
});

test('data validation: every ground-truth check passed and served files match', async () => {
  const v = await call('data_validation');
  assert.equal(v.verified, true, v.reason);
  assert.equal(v.report.checks.length, 6);
  assert.ok(v.report.checks.every((c: { passed: boolean; assertions: number }) => c.passed && c.assertions > 0));
  assert.deepEqual(Object.keys(v.report.files).sort(), ['globocan.csv', 'neoplasm_deaths.csv', 'population.csv', 'survival.csv']);
});
