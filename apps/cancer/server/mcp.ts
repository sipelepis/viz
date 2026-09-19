// MCP server over the verified cancer tables. Served two ways from the same tools:
// stdio (server/stdio.ts, for Claude Code via .mcp.json) and stateless HTTP at /mcp
// (mounted into Vite's dev/preview servers; the app's charts fetch through it).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { readme, tables, validation } from './data.ts';

const LIMIT = 1000;
const MAX_BODY = 1_000_000;

const sex = z.enum(['Both Sexes', 'Male', 'Female']).default('Both Sexes');
const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

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
    { name: 'viz-cancer', version: '0.1.0' },
    {
      instructions:
        'Philippine cancer data, verified against the publishers: PSA registered deaths (2023, 2024) by region, ' +
        'cause, age and sex; 2024 census population; IARC GLOBOCAN 2024 estimates; published Metro Manila survival ' +
        'studies (adults 1998-2002, children 2006-2017). Registered deaths and GLOBOCAN ' +
        'estimates measure different things and must not be mixed. Call data_validation to confirm the data ' +
        'passed its ground-truth checks, and about_the_data for caveats.',
    },
  );

  server.registerTool('registered_cancer_deaths', {
    title: 'Registered cancer deaths (PSA)',
    description:
      'Deaths registered with PSA, by region of usual residence, cause (ICD-10 Mortality Tabulation List 1: ' +
      '1-026 Neoplasms and sites 1-027..1-047, plus "total" = all causes), age group and sex. Not adjusted for ' +
      'under-registration. Negros Island Region exists only in 2024.',
    inputSchema: {
      year: z.number().int().min(2023).max(2024).default(2024),
      region: z.string().optional()
        .describe('PSGC code, "PH" (national), "foreign", or part of a name, e.g. "NCR", "Davao". Omit for all.'),
      cause: z.string().optional()
        .describe('Code such as "1-036", "total", or part of a name, e.g. "breast". Omit for all groups.'),
      sex,
      age_group: z.string().default('Total')
        .describe('"Total", "Under 1", "1-4", "5-9", ..., "85 and over", "Not Stated", or "all".'),
    },
    annotations: { readOnlyHint: true },
  }, ({ year, region, cause, sex, age_group }) => {
    let rows = tables().deaths.filter((r) =>
      r.year === year && r.sex === sex && (age_group === 'all' || r.age_group === age_group));
    rows = pick(pick(rows, region, ['region_code', 'region']), cause, ['cause_code', 'cause']);
    return result({ source: `PSA registered deaths ${year}`, ...page(rows) });
  });

  server.registerTool('cancer_death_rates', {
    title: 'Cancer death rate per 100,000 by region (PSA, 2024)',
    description:
      'Crude death rate per 100,000 population for one cause, for the Philippines and each of its 18 regions, ' +
      '2024. Registered deaths / 2024 Census population (total population for both sexes; household population ' +
      'for male or female, the only sex-specific denominator). Crude, not age-standardised: regions with older ' +
      'populations rank higher partly for that reason.',
    inputSchema: {
      cause: z.string().default('1-026').describe('Code such as "1-026" (all neoplasms) or "1-036", or part of a name.'),
      sex,
    },
    annotations: { readOnlyHint: true },
  }, ({ cause, sex }) => {
    const { deaths, population } = tables();
    const d2024 = deaths.filter((r) => r.year === 2024 && r.age_group === 'Total' && r.sex === sex);
    const causes = [...new Map(pick(d2024, cause, ['cause_code', 'cause']).map((r) => [r.cause_code, r.cause]))];
    if (causes.length !== 1) {
      throw new Error(causes.length
        ? `"${cause}" matches ${causes.map(([c, n]) => `${c} ${n}`).join('; ')}; be more specific`
        : `no cause matches "${cause}"`);
    }
    const [[code, name]] = causes;
    const measure = sex === 'Both Sexes' ? 'Total Population' : 'Household Population';
    const rows = population
      .filter((p) => p.measure === measure && p.age_group === 'Total' && p.sex === sex)
      .map((p) => {
        const n = d2024.find((r) => r.region_code === p.region_code && r.cause_code === code)?.deaths ?? 0;
        return { region_code: p.region_code, region: p.region, deaths: n, population: p.value,
                 rate_per_100k: Math.round((n / p.value) * 1e6) / 10 };
      })
      .sort((a, b) => b.rate_per_100k - a.rate_per_100k);
    return result({ year: 2024, cause_code: code, cause: name, sex,
                    denominator: `${measure} (2024 Census of Population)`, rows });
  });

  server.registerTool('cancer_estimates', {
    title: 'Cancer incidence, mortality and prevalence estimates (GLOBOCAN 2024)',
    description:
      'IARC GLOBOCAN 2024 modelled estimates for the Philippines by cancer site and sex: count, ASR (World), crude ' +
      'rate, cumulative risk to 74. Incidence is modelled from the Manila and Rizal registries; mortality is ' +
      'modelled and differs from PSA registered deaths. Code 39 = all cancers; "37+38" = other/unspecified ' +
      '(derived remainder). National only: no regional or age breakdown.',
    inputSchema: {
      measure: z.enum(['incidence', 'mortality', 'prevalence_5y']).optional(),
      sex,
      cancer: z.string().optional().describe('Site code, e.g. "20", or part of a name, e.g. "lung". Omit for all.'),
    },
    annotations: { readOnlyHint: true },
  }, ({ measure, sex, cancer }) => {
    const rows = tables().estimates.filter((r) => r.sex === sex && (!measure || r.measure === measure));
    return result({ source: 'IARC GLOBOCAN 2024', ...page(pick(rows, cancer, ['cancer_code', 'cancer'])) });
  });

  server.registerTool('mortality_incidence_ratio', {
    title: 'Mortality-to-incidence ratio by site (derived from GLOBOCAN 2024)',
    description:
      'Estimated deaths ÷ estimated new cases per cancer site (MIR). A rough outcome proxy, NOT a survival rate: ' +
      '1 − MIR loosely approximates 5-year survival only when incidence and mortality are stable, and here the two ' +
      'come from different models (incidence from the Manila and Rizal registries, mortality from WHO national ' +
      'trends). Colon, rectum and anus are combined as colorectum; code 39 is all cancers. National only. Rows are ' +
      'sorted by new cases; ratios for sites with few cases are unstable.',
    inputSchema: {
      sex,
      cancer: z.string().optional().describe('Site code, e.g. "20", or part of a name, e.g. "liver". Omit for all.'),
    },
    annotations: { readOnlyHint: true },
  }, ({ sex, cancer }) => {
    const sites = new Map<string, { cancer_code: string; cancer: string; new_cases: number; deaths: number }>();
    for (const e of tables().estimates) {
      const code = Number(e.cancer_code); // NaN for the derived "37+38" remainder, which is skipped
      if (e.sex !== sex || !['incidence', 'mortality'].includes(e.measure) || !(code <= 36 || code === 39)) continue;
      const crc = [8, 9, 10].includes(code);
      const key = crc ? 'colorectum' : e.cancer_code;
      const site = sites.get(key)
        ?? { cancer_code: crc ? '8+9+10' : e.cancer_code, cancer: crc ? 'Colorectum' : e.cancer, new_cases: 0, deaths: 0 };
      if (e.measure === 'incidence') site.new_cases += e.count;
      else site.deaths += e.count;
      sites.set(key, site);
    }
    const rows = pick([...sites.values()], cancer, ['cancer_code', 'cancer'])
      .filter((s) => s.new_cases > 0)
      .map((s) => ({ ...s, mir: Math.round((s.deaths / s.new_cases) * 1000) / 1000 }))
      .sort((a, b) => b.new_cases - a.new_cases);
    return result({ source: 'Derived from IARC GLOBOCAN 2024', sex, measure: 'deaths / new cases', rows });
  });

  server.registerTool('cancer_survival', {
    title: 'Cancer survival, Metro Manila registries (published studies)',
    description:
      'The only population-based cancer survival figures for the Philippines (it has none in CONCORD-3 or ' +
      'SURVCAN-3), all from the Manila and Rizal cancer registries, so Metro Manila only. Adults: 5-year ' +
      'relative survival, age-standardised, 1998-2002, with Filipino-American and Caucasian (US SEER) ' +
      'comparisons (Redaniel 2009, Br J Cancer). Children 0-19: 5-year observed survival, 2006-2017 (Rosario ' +
      '2025, Philipp J Oncol); 54-79% of cases were censored, and bound "≤" marks an upper bound. The ' +
      'authors note incomplete follow-up likely overestimates survival. Not available by sex.',
    inputSchema: {
      age: z.enum(['adults', '0-19']).optional().describe('"adults" or "0-19" (children). Omit for both.'),
      site: z.string().optional().describe('Part of a site name, e.g. "breast", "leuk". Omit for all.'),
      population: z.string().optional()
        .describe('"Philippine residents", "Filipino-Americans (US SEER)" or "Caucasians (US SEER)". Omit for all.'),
    },
    annotations: { readOnlyHint: true },
  }, ({ age, site, population }) => {
    let rows = tables().survival.filter((r) => !age || r.age === age);
    rows = pick(pick(rows, site, ['site']), population, ['population']);
    return result({ source: 'Redaniel 2009 (CC BY 4.0); Rosario 2025', ...page(rows) });
  });

  server.registerTool('population_2024', {
    title: 'Population by region, age and sex (PSA 2024 Census)',
    description:
      'Total population, household population, households and average household size by region (1 July 2024). ' +
      'Household population is also split by 5-year age group and sex. The national total includes 1,708 ' +
      'Filipinos in embassies abroad, so regions sum to 1,708 less.',
    inputSchema: {
      region: z.string().optional().describe('PSGC code, "PH", or part of a region name. Omit for all.'),
      measure: z.enum(['Total Population', 'Household Population', 'Number of Households', 'Average Household Size']).optional(),
      sex,
      age_group: z.string().default('Total').describe('"Total", "Under 5", "5-9", ..., "85 and over", or "all".'),
    },
    annotations: { readOnlyHint: true },
  }, ({ region, measure, sex, age_group }) => {
    const rows = tables().population.filter((r) => r.sex === sex && (!measure || r.measure === measure)
      && (age_group === 'all' || r.age_group === age_group));
    return result({ source: 'PSA 2024 Census of Population', ...page(pick(rows, region, ['region_code', 'region'])) });
  });

  server.registerTool('data_validation', {
    title: 'Is the data valid? Ground-truth checks',
    description:
      'Results of the ground-truth checks (data/check.py): each check, what it was compared against (PSA tables, ' +
      'the IARC fact sheet, the survival papers), assertion counts and any failures, when it ran, and the sources ' +
      'with retrieval dates. "verified" is true only if every check passed AND the files being served are ' +
      'byte-identical to the ones checked. Call this before relying on or publishing any figure.',
    annotations: { readOnlyHint: true },
  }, () => result(validation()));

  server.registerTool('about_the_data', {
    title: 'Sources, checks and caveats',
    description: 'The data README: every source, the ground-truth checks it passes, and caveats to read before charting.',
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
