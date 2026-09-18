# cancer

Data visualisation on cancer and Philippine health care.

```
pnpm install
pnpm dev      # design system showcase (apps/web)
pnpm build
```

| Path | What |
| --- | --- |
| `packages/design-system` | Akashi design system: `tokens.css` (CSS variables) and `index.css` (fonts, base, type scale, buttons, cards, dialog). Spec: [DESIGN.md](packages/design-system/DESIGN.md). |
| `apps/web` | Vite app. Currently a showcase of the design system. |
| `data/raw` | Source files as downloaded: PSA 2024 registered deaths. |

Use it in an app with `import '@cancer/design-system'` and add `"@cancer/design-system": "workspace:^"` to that app's dependencies.
