# viz

My data and visualisation monorepo (Nx + pnpm workspaces): datasets, charts, and the design system they share. First topic: cancer and Philippine health care.

```
pnpm install
pnpm dev                        # nx dev cancer: app + MCP endpoint at http://localhost:4200
pnpm build                      # nx run-many -t build (rebuilds data/clean first)
pnpm nx run @viz/data:check     # ground-truth checks (Python 3 with openpyxl, pypdf)
pnpm nx test cancer             # MCP tool tests (node --test)
```

| Path | What |
| --- | --- |
| `packages/design-system` | Akashi design system: `tokens.css` (CSS variables) and `index.css` (fonts, base, type scale, buttons, cards, dialog). Spec: [DESIGN.md](packages/design-system/DESIGN.md). |
| `apps/cancer` | Vite + React + TypeScript dashboard for the cancer topic, plus the data MCP server in `server/`. |
| `data` (`@viz/data`) | Ground-truth datasets: raw sources, tidy CSVs, and checks against the publisher's figures. See [data/README.md](data/README.md). |

Use it in an app with `import '@viz/design-system'` and add `"@viz/design-system": "workspace:^"` to that app's dependencies.

## 3D body map

The dashboard's body map shows complete female and male anatomy: skin, a full skeleton and the organs, genitalia included. Sources and licences are in [`apps/cancer/public/models/ATTRIBUTION.md`](apps/cancer/public/models/ATTRIBUTION.md).

| Source | What it provides | Licence |
| --- | --- | --- |
| HuBMAP Human Reference Atlas, 3D Reference Organ Sets v1.10 | The bodies, skin and most organs | CC BY 4.0 |
| BodyParts3D (© DBCLS) | The rest of the skeleton (skull, ribs, shoulder girdle, arms, hands, feet), stomach, oesophagus, testes and penis | CC BY-SA 2.1 JP |
| Z-Anatomy | Thyroid | CC BY-SA 4.0 |

- The added parts come from one male body and are scaled to fit each figure. For the female body that is an approximation.
- The combined models are shared under CC BY-SA. Keep that in mind if the repo goes public.

The build script `pnpm nx models cancer` (`apps/cancer/scripts/build-body-models.mjs`) does the following:
1. Downloads the sources once into the gitignored `apps/cancer/.cache/` (about 1.2 GB).
2. Fits the added parts into each body piece by piece, and prints "fit check" lines showing how much of each part lies outside the skin.
3. Simplifies the meshes and writes meshopt-compressed `public/models/body-{female,male}.glb` (about 2.4 MB each).

The viewer has:
- **Layers:** skin, skeleton and organs switch on and off independently.
- **Two colour modes:**
  - data colours, a warm single-hue heat scale validated with the dataviz skill;
  - anatomy colours, natural tones for orientation that carry no data.

It also has reveal controls:
- a cut-away that slices off the front of the skin and skeleton to show the organs (**X**);
- an exploded view (**E**);
- a skin-opacity slider.

Other viewer features:
- auto-rotate (**R**);
- a dark stage (**D**);
- full screen (**W**);
- a label with the figure on the selected organ;
- a heat legend inside the viewer.

Rendering pauses while the viewer is off-screen.

For accessibility:
- the options live in a sidebar inside the viewer, closed by default (**P** toggles it);
- hotkeys work while focus is in the body map, as WCAG 2.1.4 requires, and each action is announced:
  - **1/2/3** show both, women or men;
  - **S/K/O** toggle skin, skeleton or organs;
  - **C** switches colours and **M** cycles the measure;
  - **F/V/B** set front, side or back view;
  - arrow keys rotate (3D view focused), **+/−** zoom, **Home** or **0** resets;
  - **]/[** step through organs and **}/{** through sections;
  - **?** lists all the shortcuts;
- on-screen buttons rotate, zoom and reset, for anyone who can't drag;
- a live text summary describes what's shown and the highest figures per sex;
- the section and organ buttons offer everything the scene does.

Two organs are represented indirectly:
- Blood cancers are shown on the pelvis, a main bone-marrow site.
- Lymphoma is shown on one lymph node, drawn at 2.5× life size.

## Data MCP server

`apps/cancer/server/mcp.ts` exposes the verified tables as read-only MCP tools:

| Tool | Returns |
| --- | --- |
| `registered_cancer_deaths` | PSA registered deaths for 2023 and 2024, by region, cause, age and sex |
| `cancer_death_rates` | Crude deaths per 100,000 by region, for 2024 |
| `cancer_estimates` | GLOBOCAN 2024 incidence, mortality and 5-year prevalence |
| `mortality_incidence_ratio` | GLOBOCAN deaths ÷ new cases by site. A labelled outcome proxy, not a survival rate |
| `cancer_survival` | Published 5-year survival, Metro Manila: adults 1998–2002 (with US comparisons) and children 2006–2017 |
| `population_2024` | Census population by region, age and sex |
| `data_validation` | Whether the data is valid: each ground-truth check, its sources, and whether the files being served still match the checked ones |
| `about_the_data` | The sources and caveats |

The same server runs over two transports:

- **stdio, for Claude Code.** `.mcp.json` registers it as `viz-cancer` (`node apps/cancer/server/stdio.ts`). Run `pnpm nx run @viz/data:build` once so `data/clean` exists.
- **Streamable HTTP at `/mcp`.** It's mounted inside `vite dev` and `vite preview`, and the dashboard reads all of its data through it.
  - The HTTP transport is stateless and serves POST requests only.
  - A static `dist/` build has no `/mcp`. Hosting the app needs a small Node server around `handleMcpHttp`.

## Deployment

Live at **https://viz-cancer.vercel.app**. The public MCP endpoint is `https://viz-cancer.vercel.app/mcp`; the "MCP server" button in the app shows how to connect a client and lets you run each tool.

```
apps/cancer/deploy/stage.sh                  # data checks + build, then stage .deploy/web and .deploy/mcp
cd apps/cancer/.deploy/web && npx vercel deploy --prod
```

Hosting today:
- **Vercel** (`viz-cancer` project on the personal account) hosts the site and runs the MCP server as a serverless function (`api/mcp.mjs`, bundled by `deploy/bundle-mcp.mjs`).
- The verified CSVs ship with the function.
- `/mcp` is rewritten to that function, so the browser stays same-origin.

To move the MCP server to **GCP Cloud Run**:
1. Get a free project slot on the personal Google account; it's at its project quota.
2. Deploy the staged container:
   ```
   gcloud run deploy viz-cancer-mcp --source apps/cancer/.deploy/mcp --region asia-southeast1 \
     --allow-unauthenticated --max-instances 2 --account moran.phillipjan@gmail.com --project <project>
   ```
3. Re-stage with its URL (`deploy/stage.sh https://viz-cancer-mcp-….run.app`) and redeploy Vercel. `/mcp` then forwards to Cloud Run.

Only data that passes `@viz/data:check` is staged.
