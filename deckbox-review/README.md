# Deck Box · 120mm · Structural Review

A static, single-page review of the 120mm 3D-printed deck box structure. Built for client sign-off on form before sculpted detail is added.

## What's here

```
.
├── index.html                                       single-page review
├── deckbox_120mm_structure_three_views.svg          the source SVG (also inlined in index.html)
└── README.md
```

The page is fully self-contained. Just open `index.html` in a browser — no build step, no dependencies. Web fonts load from Google Fonts.

## Deploying for client review

### Option 1: Netlify drop
Drag the folder onto https://app.netlify.com/drop. You'll get a shareable URL in seconds.

### Option 2: GitHub Pages
1. Push this folder to a new repo.
2. Settings → Pages → deploy from `main` branch, root.
3. Share the `*.github.io` URL.

### Option 3: Netlify (via GitHub)
Push to GitHub, connect the repo in Netlify, no build command, publish directory `/`.

## Notes

- `<meta name="robots" content="noindex, nofollow">` is set so this won't get indexed while it's a draft. Remove if you want it public.
- The page uses Caveat (handwritten), Fraunces (serif display), and Inter (body) from Google Fonts.
- The SVG is inlined into `index.html` so it inherits the page's color palette via CSS variables. The standalone `.svg` file is included for archive/reuse.

## Source

This drawing was prepared by LarryDojo Studio for client review.
