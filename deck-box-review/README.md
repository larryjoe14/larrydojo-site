# Deck Box Review Page

Single-page preview for the custom Magic deck box commission. Drop the
folder into the root of `larrydojo-site` and Netlify serves it at
`https://larrydojo.com/deck-box-review/`.

## File layout

```
deck-box-review/
├── index.html          ← the page
├── deck-box.glb        ← interactive 3D model (web-optimized)
├── deck-box.mp4        ← optional: spinning fallback video
└── deck-box.webm       ← optional: alternate fallback format
```

## CRITICAL: shrink the GLB before deploying

The GLB Meshy exports is sized for printing, not for the web. A 160 MB
file will not deploy (Netlify caps single files at 100 MB on the free
tier) and would never load on cellular.

**Target: under 10 MB. Ideally under 5 MB.**

Pick whichever of these is easiest:

**Option 1 — Re-export from Meshy at lower settings.** In Meshy's
export dialog, look for polycount and texture-size options. Drop
polycount to ~30k–50k and textures to 1024×1024 before clicking
Download.

**Option 2 — gltf-transform CLI.** One command, zero install:
```bash
npx @gltf-transform/cli optimize deck-box.glb deck-box-web.glb \
  --texture-compress webp --texture-size 1024
```
Output is typically 5–10 MB, visually identical at viewer sizes.

**Option 3 — gltf.report (browser).** Open https://gltf.report, drag
your GLB in, click "Optimize," download. Same gltf-transform pipeline,
no install.

Once shrunk, rename to `deck-box.glb` and drop it in this folder.

## Optional spinning-video fallback

The viewer has a three-state cascade:

1. **GLB loads** → interactive 3D model.
2. **GLB missing/fails** → looping `deck-box.mp4` plays in the well.
3. **No fallback either** → stylized "loading the model" placeholder.

If you want a fallback video, export a 4–6 second loop of the model
spinning. Save as `deck-box.mp4`. The page picks it up automatically.

## How the form works

One Netlify form registers at build time:

- **`deck-box-message`** — single textarea, no name or email. Lands in
  the same Netlify Forms dashboard as your existing `contact` form.

Submissions fire confirmation in-page (no full reload). The honeypot
catches dumb bots; Netlify's filter handles the rest.

## Updating the Stripe link

The CTA in the hero has `id="stripe-cta"` and `href="#"` as a
placeholder. Find that line in `index.html` and replace `href="#"`
with your Stripe payment-link URL. That's the only swap needed before
deploying.

## Sharing

The footer band has a "Copy link" button (works everywhere via the
Clipboard API) and a "Share..." button that only appears on browsers
that support the Web Share API (most mobile, some desktops). Both
share the current page URL, so no extra config — whatever URL the
page is served from is what gets copied or shared.

## Local preview

Open `index.html` in any browser. Forms won't submit (Netlify needs the
live site) but the 3D viewer, share buttons, and visual layout all work.
Drop a `deck-box.glb` next to `index.html` to test the viewer locally.
