// Browser checks for the education page (criteria C3..C10). Run: node check.cjs <id> | --list
// Needs NODE_PATH to a node_modules with playwright. BASE_URL defaults to http://localhost:4310.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4310';
const IDS = ['C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (p) => { const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };

async function tool(name, args) {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${name}: ${JSON.stringify(json.error)}`);
  if (json.result.isError) throw new Error(`${name}: ${json.result.content[0].text}`);
  return JSON.parse(json.result.content[0].text);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const eq = (a, b, what) => assert(JSON.stringify(a) === JSON.stringify(b), `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// Scroll a section into view and wait until its bar figures have been revealed.
async function reveal(page, sel) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForFunction(
    (s) => [...document.querySelectorAll(`${s} figure.bars`)].every((f) => f.hasAttribute('data-shown')), sel);
}
const texts = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.textContent.trim()));
const text = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.textContent).join('\n'));
const radio = (page, sec, label) =>
  page.locator(`${sec} .filters label`).filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();

const checks = {
  async C3(page, errors) {
    await page.getByText('Verified against the publishers').first().waitFor();
    const ff = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily);
    assert(ff.includes('Zen Kaku Gothic New'), `h1 font-family ${ff}`);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(bg === 'rgb(250, 250, 250)', `body background ${bg}`);
    await page.waitForLoadState('networkidle');
    const r = await page.evaluate(() => {
      const ok = (c) => {
        c = c.trim();
        if (c === 'none' || c === 'transparent') return true;
        const m = c.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+%?))?\s*\)$/);
        if (!m) return false;
        if (m[4] !== undefined && parseFloat(m[4]) === 0) return true;
        return m[1] === m[2] && m[2] === m[3];
      };
      const marks = [...document.querySelectorAll('.chart svg path, .chart svg line, .chart svg circle, .chart svg rect, .bars-bar')];
      const bad = [];
      for (const el of marks) {
        const cs = getComputedStyle(el);
        for (const p of ['stroke', 'fill', 'backgroundColor']) if (!ok(cs[p])) bad.push(`${el.tagName}.${el.getAttribute('class')} ${p}=${cs[p]}`);
      }
      return { n: marks.length, bad };
    });
    assert(r.n > 0, 'no chart marks found');
    assert(r.bad.length === 0, `non-grey marks: ${r.bad.slice(0, 5).join('; ')}`);
    assert(errors.length === 0, `console errors: ${errors.length}`);
  },

  async C4(page) {
    const { rows } = await tool('labour_rates', { measure: 'Unemployment rate', frequency: 'month' });
    assert(rows.length > 0, 'labour_rates returned no rows');
    const last = rows[rows.length - 1];
    eq(rows[0].period, '2005-04', 'first period');
    await reveal(page, '#trend');
    await page.locator('#trend summary').click();
    await page.locator('#trend tbody tr').first().waitFor();
    eq(await page.locator('#trend tbody tr').count(), rows.length, 'table row count');
    const ths = await texts(page, '#trend tbody tr th');
    eq(ths[0], 'Apr 2005', 'first th');
    eq(ths[ths.length - 1], monthLabel(last.period), 'last th');
    const ticks = await texts(page, '#trend .line-y text');
    assert(ticks.length > 0, 'no y ticks');
    const min = ticks.reduce((a, b) => (parseFloat(b) < parseFloat(a) ? b : a));
    eq(min, '0%', 'lowest y tick');
    const rule = await texts(page, '#trend .line-rule-label');
    assert(rule.length > 0 && rule.every((t) => t.length > 0), 'rule label empty or missing');
    assert(rule.every((t) => t.includes('Jan 2021')), `rule label lacks 'Jan 2021': ${rule}`);
    assert(await page.locator('#trend line.line-rule').count() > 0, 'no line.line-rule');
    await page.locator('#trend .line-plot').focus();
    await page.keyboard.press('End');
    const tip = await page.locator('#trend .tooltip').first().innerText();
    assert(/estimate/.test(tip), `tooltip lacks 'estimate': ${tip}`);
    assert(tip.includes(monthLabel(last.period)), `tooltip lacks month: ${tip}`);
    if (typeof last.value === 'number') assert(tip.includes(last.value.toFixed(1)), `tooltip lacks value ${last.value.toFixed(1)}: ${tip}`);
    let kind;
    if (last.ci_low != null && last.ci_high != null) {
      assert(tip.includes('95%'), `tooltip lacks 95%: ${tip}`);
      assert(tip.includes(last.ci_low.toFixed(1)) && tip.includes(last.ci_high.toFixed(1)), `tooltip lacks CI bounds: ${tip}`);
      kind = 'ci';
    } else {
      const cap = await text(page, '#trend');
      assert(/not shown yet/i.test(cap) && /Table A/.test(cap), `no-CI caption must say CIs are not shown yet and PSA publishes them in Table A: ${cap.slice(0, 300)}`);
      kind = 'no ci';
    }
    const lastVal = () => page.locator('#trend tbody tr').last().locator('td').last().innerText();
    const before = await lastVal();
    await radio(page, '#trend', 'Underemployment rate').click();
    await page.waitForFunction(() => /employed people/i.test([...document.querySelectorAll('#trend p.caption')].map((e) => e.textContent).join(' ')));
    await page.waitForFunction(([b]) => { const tds = document.querySelectorAll('#trend tbody tr:last-child td'); return tds.length && tds[tds.length - 1].textContent.trim() !== b; }, [before.trim()]);
    assert((await lastVal()).trim() !== before.trim(), `plotted series unchanged after switching to Underemployment: ${before}`);
    const hrefs = await page.locator('#trend a.source').evaluateAll((as) => as.map((a) => a.href));
    assert(hrefs.length > 0 && hrefs.every((h) => h.startsWith('https://openstat.psa.gov.ph')), `source links: ${hrefs}`);
    return ` (${kind})`;
  },

  async C5(page) {
    const u = await tool('underemployment_by_education', {});
    const order = new Map();
    for (const r of u.rows) order.set(r.level, r.level_order);
    const expected = [...order.keys()].sort((a, b) => order.get(a) - order.get(b));
    await reveal(page, '#by-education');
    eq(await texts(page, '#by-education .bars-label'), expected, 'row labels');
    eq(await texts(page, '#by-education .bars-head span.caption'), u.years.map(String), 'column headers');
    const ref = (await text(page, '#by-education .bars-ref-label'));
    assert(ref.includes(u.national.rate.toFixed(1)), `reference label '${ref}' lacks ${u.national.rate.toFixed(1)}`);
    await page.locator('#by-education .bars-track').first().focus();
    const tip = await page.locator('#by-education .tooltip').first().innerText();
    assert(/thousand underemployed of .* thousand employed/.test(tip), `tooltip: ${tip}`);
    const all = await text(page, '#by-education');
    assert(/derived/i.test(all), "no 'derived'");
    assert(/15 and over/.test(all), "no '15 and over'");
    eq(await page.locator('#by-education a[href^="https://openstat.psa.gov.ph"]').count(), 2, 'openstat link count');
  },

  async C6(page) {
    await reveal(page, '#studies');
    const t = await text(page, '#studies');
    for (const s of ['6.7%', '4.4%', '80%', '141.4%', '93.7%', 'Published estimate', 'Checked against the paper'])
      assert(t.includes(s), `#studies lacks '${s}'`);
    assert(/25.34/.test(t), 'no 25.34');
    assert(await page.locator('#studies a[href*="openknowledge.worldbank.org"]').count() > 0, 'no worldbank link');
    assert(await page.locator('#studies a[href*="pids.gov.ph"]').count() > 0, 'no pids link');
    const ratio = await page.evaluate(() => {
      for (const fig of document.querySelectorAll('#studies figure.bars')) {
        const w = {};
        for (const row of fig.querySelectorAll('.bars-row')) {
          const v = row.querySelector('.bars-value')?.textContent.trim();
          const b = row.querySelector('.bars-bar');
          if (b && (v === '6.7%' || v === '4.4%')) w[v] = b.getBoundingClientRect().width;
        }
        if (w['6.7%'] && w['4.4%'] !== undefined) return w['4.4%'] / w['6.7%'];
      }
      return null;
    });
    assert(ratio !== null, 'no figure.bars with 6.7% and 4.4% bars');
    assert(Math.abs(ratio - 4.4 / 6.7) <= 0.01, `bar ratio ${ratio}, expected ${4.4 / 6.7}`);
    assert(/(don.t|do not) show .*cause/i.test(t), "no 'don't show ... cause' sentence");
  },

  async C7(page) {
    await page.locator('#employers').scrollIntoViewIfNeeded();
    const cards = await texts(page, '#employers article.card');
    assert(cards.length >= 6, `employer cards: ${cards.length}`);
    cards.forEach((c, i) => {
      assert(/Self-reported by employers|Study estimate/.test(c), `card ${i} lacks source type`);
      assert(/\b(19|20)\d\d\b/.test(c), `card ${i} lacks year`);
      assert(/sample|firms|not published/i.test(c), `card ${i} lacks sample line`);
      assert(/Checked against the paper|Quoted from news coverage/.test(c), `card ${i} lacks check status`);
    });
    const links = await page.locator('#employers article.card').evaluateAll((cs) => cs.map((c) => c.querySelectorAll('a[href^=http]').length));
    links.forEach((n, i) => assert(n > 0, `card ${i} has no external link`));
    const t = await text(page, '#employers');
    for (const s of ['77%', '71%', '62%', '23%', 'PUP', '73%', '299', '39%']) assert(t.includes(s), `#employers lacks '${s}'`);
    const pupCard = cards.find((c) => c.includes('23%') && c.includes('PUP'));
    assert(pupCard && (/\bUP\b/.test(pupCard) || pupCard.includes('University of the Philippines')), `no card with PUP's 23% and the UP half of the finding: ${pupCard}`);
    eq(await page.locator('#employers svg').count(), 0, 'svg count in #employers');
    assert(/what employers say, not what they do/i.test(t), 'no employer note');
  },

  async C8(page) {
    await reveal(page, '#schooling');
    for (const level of ['Elementary', 'Junior high', 'Senior high']) {
      const all = (await tool('school_completion', { level })).rows;
      const yr = all.some((r) => r.year != null) ? Math.max(...all.map((r) => r.year ?? -Infinity)) : null;
      const regions = all.filter((r) => r.region_code !== 'PH' && (yr === null || r.year === yr));
      assert(regions.length > 0, `no regions for ${level}`);
      await radio(page, '#schooling', level).click();
      await page.waitForFunction(([n]) => document.querySelectorAll('#schooling .bars-track').length === n, [regions.length]);
      const key = ['value', 'rate', 'completion_rate', 'pct'].find((k) => typeof regions[0][k] === 'number')
        ?? Object.keys(regions[0]).find((k) => typeof regions[0][k] === 'number' && !/year|order|code/.test(k));
      const labels = await page.locator('#schooling .bars-track').evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label')));
      for (const r of [regions[0], regions[regions.length - 1]]) {
        const l = labels.find((x) => x.startsWith(`${r.region}:`));
        assert(l, `${level}: no track for ${r.region}`);
        const n = parseFloat(l.slice(r.region.length + 1).match(/-?\d+(\.\d+)?/)[0]);
        assert(Math.abs(n - r[key]) <= 0.05, `${level} ${r.region}: ${n} vs ${r[key]}`);
      }
    }
    const t = await text(page, '#schooling');
    assert(t.includes('DepEd') && t.includes('administrative'), "caption lacks 'DepEd'/'administrative'");
  },

  async C9(page) {
    await page.waitForFunction(() => /Not verified/.test(document.querySelector('p.validity[role=alert]')?.textContent ?? ''));
    const { report } = await tool('data_validation');
    const title = report.checks.find((c) => c.id === 'lfs-headlines').title;
    const badge = await page.locator('p.validity[role=alert]').first().innerText();
    assert(badge.includes(title), `badge '${badge}' lacks '${title}'`);
  },

  async C10(page) {
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[role=alert]')].some((e) => e.textContent.includes('pnpm nx run @viz/data:build-education')));
    assert(/Not verified/.test(await page.locator('p.validity').first().innerText()), "badge lacks 'Not verified'");
    eq(await page.locator('.bars-track, svg.line-svg').count(), 0, 'charts drawn');
  },
};

async function main() {
  const id = process.argv[2];
  if (id === '--list') { console.log(IDS.join('\n')); return 0; }
  if (!IDS.includes(id)) { console.error(`usage: check.cjs <${IDS.join('|')}> | --list`); return 2; }
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  let code = 0;
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} (${m.location().url})`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(BASE_URL);
    const suffix = (await checks[id](page, errors)) || '';
    console.log(`${id} PASS${suffix}`);
  } catch (e) {
    console.log(`${id} FAIL: ${e.message.split('\n')[0]}`);
    for (const m of errors) console.log(`  console error: ${m}`);
    code = 1;
  } finally {
    await browser.close();
  }
  return code;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
