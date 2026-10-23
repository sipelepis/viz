// MCP server over the verified education tables. Served two ways from the same tools:
// stdio (server/stdio.ts, for Claude Code via .mcp.json) and stateless HTTP at /mcp.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { readme, tables, validation } from './data.ts';

const LIMIT = 1000;
const MAX_BODY = 1_000_000;

const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
const period = z.string().regex(/^\d{4}(-\d{2})?$/);

const openstat = (dirs: string, table: string) => `https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__${dirs}/${table}.px/`;
const TABLE_URL = {
  '0021B3FKEI2': openstat('1B__LFS', '0021B3FKEI2'),
  '0141B3FEMP7': openstat('1B__LFS', '0141B3FEMP7'),
  '0151B3FUDR2': openstat('1B__LFS', '0151B3FUDR2'),
  '0023I3C0412': openstat('3I__G04', '0023I3C0412'),
  '0033I3C41S1': openstat('3I__G04', '0033I3C41S1'),
};

const rate = (u: number, e: number) => Math.round((u / e) * 1000) / 10;

/**
 * Rows where a field, or either half of a "Name (Alias)" field, equals the query
 * (case-insensitive), so "Region I" and "Ilocos Region" hit only Region I; failing that,
 * rows containing the query anywhere.
 */
function pick<T extends Record<string, unknown>>(rows: T[], query: string | undefined, fields: (keyof T)[]): T[] {
  if (!query) return rows;
  const q = query.toLowerCase().trim();
  const text = (r: T) => fields.map((f) => String(r[f]).toLowerCase());
  const exact = rows.filter((r) => text(r).some((t) => t === q || t.split(/\s*[()]\s*/).includes(q)));
  return exact.length ? exact : rows.filter((r) => text(r).some((t) => t.includes(q)));
}

function page<T>(rows: T[]) {
  return { rows: rows.slice(0, LIMIT), total_rows: rows.length, truncated: rows.length > LIMIT };
}

export function createMcpServer() {
  const server = new McpServer(
    { name: 'viz-education', version: '0.1.0' },
    {
      instructions:
        "Philippine education and work data. Labour force survey (LFS) rates are verified against PSA's press release; " +
        'underemployment by education level is derived here from PSA counts; school completion and cohort survival ' +
        'are DepEd administrative data published by PSA; published figures are quoted from studies and news, not ' +
        'computed. Rates with different denominators never share an axis. Make no causal claims. Call ' +
        'data_validation first, and about_the_data for caveats.',
    },
  );

  server.registerTool('labour_rates', {
    title: 'Labour force rates (PSA LFS)',
    description:
      'PSA Labor Force Survey headline rates, monthly from April 2005 and annual: labour force participation, ' +
      'employment, unemployment and underemployment. The rates have different denominators (see denominators), ' +
      'so they must not share an axis. Latest months are preliminary (status).',
    inputSchema: {
      measure: z.enum(['Labor force participation rate', 'Employment rate', 'Unemployment rate', 'Underemployment rate']).optional(),
      frequency: z.enum(['month', 'year']).optional(),
      from: period.optional().describe('First period, "YYYY" or "YYYY-MM".'),
      to: period.optional().describe('Last period, "YYYY" or "YYYY-MM".'),
    },
    annotations: { readOnlyHint: true },
  }, ({ measure, frequency, from, to }) => {
    const rows = tables().rates
      .filter((r) => (!measure || r.measure === measure) && (!frequency || r.frequency === frequency)
        && (!from || r.period >= from) && (!to || r.period <= to))
      .sort((a, b) => a.period.localeCompare(b.period));
    return result({
      source: 'PSA Labor Force Survey, Rates Key Employment Indicators',
      url: TABLE_URL['0021B3FKEI2'],
      denominators: {
        'Unemployment rate': 'the labour force',
        'Underemployment rate': 'employed people',
        'Labor force participation rate': 'the household population aged 15 and over',
        'Employment rate': 'the labour force',
      },
      notes: validation().report?.sources.find((s) => s.table === '0021B3FKEI2')?.notes ?? [],
      precision: 'ci_low and ci_high are 95% confidence intervals where PSA published them; most rows have none.',
      ...page(rows),
    });
  });

  server.registerTool('underemployment_by_education', {
    title: 'Underemployment by highest grade completed (derived from PSA LFS)',
    description:
      'Underemployed persons as a share of employed persons, by highest grade completed (2017 PSCED), computed here ' +
      'from PSA counts in thousands; PSA does not publish this rate. Not adjusted for age. "YYYY" selects a complete ' +
      'year, "YYYY-MM" a month; with no period every complete year is returned.',
    inputSchema: { period: period.optional().describe('"YYYY" or "YYYY-MM". Omit for every complete year.') },
    annotations: { readOnlyHint: true },
  }, ({ period }) => {
    const { work, rates } = tables();
    const years = [...new Set(work.filter((r) => r.frequency === 'year').map((r) => r.period))].sort();
    const rows = work
      .filter((r) => (period ? r.period === period : r.frequency === 'year'))
      .map((r) => ({ ...r, rate: rate(r.underemployed, r.employed) }))
      .sort((a, b) => a.period.localeCompare(b.period) || a.level_order - b.level_order);
    const sums = new Map<string, { employed: number; underemployed: number }>();
    for (const r of rows) {
      const s = sums.get(r.period) ?? { employed: 0, underemployed: 0 };
      s.employed += r.employed;
      s.underemployed += r.underemployed;
      sums.set(r.period, s);
    }
    const totals = [...sums].map(([p, s]) => ({ period: p, ...s, rate: rate(s.underemployed, s.employed) }));
    const latest = years[years.length - 1];
    const published = rates.find((r) => r.frequency === 'year' && r.period === latest && r.measure === 'Underemployment rate');
    return result({
      sources: [
        { name: 'PSA LFS: Employed Persons by Highest Grade Completed', url: TABLE_URL['0141B3FEMP7'] },
        { name: 'PSA LFS: Underemployed Persons by Highest Grade Completed', url: TABLE_URL['0151B3FUDR2'] },
      ],
      derived: 'underemployed ÷ employed, computed here; PSA does not publish this rate',
      base: 'all employed people aged 15 and over, not adjusted for age',
      years,
      national: { period: latest, rate: published?.value ?? null },
      rows,
      totals,
    });
  });

  server.registerTool('school_completion', {
    title: 'School completion and cohort survival by region (DepEd via PSA)',
    description:
      'SDG 4.1.2 completion rate or cohort survival rate by school level, region and sex. DepEd administrative ' +
      '(EBEIS) enrolment-based figures as published by PSA; values can exceed 100%. Defaults to the latest school ' +
      'year for the indicator. Includes the national "PH" row.',
    inputSchema: {
      indicator: z.enum(['completion_rate', 'cohort_survival_rate']).default('completion_rate'),
      level: z.enum(['Elementary', 'Junior high', 'Senior high']).optional(),
      region: z.string().optional().describe('PSGC code, "PH", or part of a region name. Omit for all.'),
      sex: z.enum(['Both Sexes', 'Male', 'Female']).default('Both Sexes'),
      school_year: z.string().optional().describe('e.g. "2023". Omit for the latest.'),
    },
    annotations: { readOnlyHint: true },
  }, ({ indicator, level, region, sex, school_year }) => {
    const all = tables().completion.filter((r) => r.indicator === indicator);
    const year = school_year ?? all.map((r) => r.school_year).sort().pop();
    const rows = all.filter((r) => r.school_year === year && r.sex === sex && (!level || r.level === level));
    return result({
      source: 'DepEd (EBEIS) via PSA SDG indicators',
      url: TABLE_URL[indicator === 'completion_rate' ? '0023I3C0412' : '0033I3C41S1'],
      note: 'DepEd administrative (EBEIS), enrolment-based figures as published by PSA; values can exceed 100%',
      indicator,
      school_year: year,
      ...page(pick(rows, region, ['region_code', 'region'])),
    });
  });

  server.registerTool('published_figures', {
    title: 'Published figures on the graduate hiring gap',
    description:
      'Figures quoted from studies (World Bank, PIDS, Melchor 2022) and from news coverage of employer surveys, each ' +
      'with its source, URL and the quoted sentence. Not computed here; figures from different surveys are not comparable.',
    inputSchema: { section: z.enum(['gap', 'employers']).optional() },
    annotations: { readOnlyHint: true },
  }, ({ section }) => result({
    note: 'Quoted from published studies and from news coverage of employer surveys; not computed here. Figures from different surveys are not comparable.',
    rows: tables().published.filter((r) => !section || r.section === section),
  }));

  server.registerTool('data_validation', {
    title: 'Is the data valid? Ground-truth checks',
    description:
      'Results of the ground-truth checks (data/check_education.py): each check, what it was compared against, ' +
      'assertion counts and any failures, and the sources with retrieval dates. "verified" is true only if every ' +
      'check passed AND the files being served are byte-identical to the ones checked. Call this before relying on ' +
      'or publishing any figure.',
    annotations: { readOnlyHint: true },
  }, () => result(validation()));

  server.registerTool('about_the_data', {
    title: 'Sources, checks and caveats',
    description: 'The education data README: every source, the ground-truth checks, and caveats to read before charting.',
    annotations: { readOnlyHint: true },
  }, () => ({ content: [{ type: 'text' as const, text: readme() }] }));

  return server;
}

/**
 * Stateless Streamable HTTP: a fresh server and transport per POST. Mount at /mcp.
 * `parsed` is a body the host has already read (Vercel functions); otherwise the stream is read here.
 */
export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse, parsed?: unknown) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' }).end();
    return;
  }
  let body = parsed;
  if (body === undefined) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400).end('invalid JSON');
      return;
    }
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
