# viz

My data and visualisation monorepo: datasets, charts, and the design system they share. First topic: cancer and Philippine health care.

```
pnpm install
pnpm dev      # design system showcase (apps/web)
pnpm build
```

| Path | What |
| --- | --- |
| `packages/design-system` | Akashi design system: `tokens.css` (CSS variables) and `index.css` (fonts, base, type scale, buttons, cards, dialog). Spec: [DESIGN.md](packages/design-system/DESIGN.md). |
| `apps/web` | Vite app. Currently a showcase of the design system. |
| `data` | Ground-truth datasets: raw sources, tidy CSVs, and checks against the publisher's figures. See [data/README.md](data/README.md). |

Use it in an app with `import '@viz/design-system'` and add `"@viz/design-system": "workspace:^"` to that app's dependencies.
