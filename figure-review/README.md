# Figure · Pre-Ship Preview

A single-page pre-ship preview for a custom 3D-printed figure, styled to match larrydojo.com.

## What's here

```
.
├── index.html      single-page preview
├── hero.jpg        1800px hero photo (~500KB)
├── preview.jpg     1200px OG/social image
└── README.md
```

Self-contained. No build step.

## Deploying

- **Netlify Drop** — drag this folder onto https://app.netlify.com/drop.
- **GitHub Pages** — Settings → Pages → main / root.
- **Per-client pattern** — keep a `previews/` folder in a single repo, drop each client into its own subfolder (e.g. `previews/firstname-lastname/`), swap `hero.jpg` and `preview.jpg` for each.

## Notes

- `noindex, nofollow` is set so the page won't be crawled while a draft.
- OG image is wired up so the link previews nicely in iMessage, Slack, DMs.

© 2026 LarryDoJo
