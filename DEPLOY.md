# Deploy guide

## What's in this bundle

This is the **complete site**. Drop the contents into your repo (overwriting
everything) and push. Netlify rebuilds on push.

```
larrydojo-site/
├── index.html                      ← main site (with Lab section)
├── README.md
├── robots.txt
├── sitemap.xml
├── _redirects
├── DEPLOY.md                       ← this file
├── netlify/
│   └── functions/
│       ├── submission-created.js   ← existing email confirmation
│       ├── validate-prompt.js      ← NEW: Claude validates/cleans prompts
│       ├── start-render.js         ← NEW: kicks off Meshy render job
│       └── render-status.js        ← NEW: polls Meshy job status
└── print-your-prompt/
    ├── index.html                  ← live preview page
    └── img/                        ← all the photo assets
```

## Required env vars in Netlify

Site configuration → Environment variables:

| Variable           | Where to get it                              |
|--------------------|----------------------------------------------|
| `RESEND`           | resend.com (already set, leave it)           |
| `ANTHROPIC_API_KEY`| console.anthropic.com → API Keys             |
| `MESHY_API_KEY`    | app.meshy.ai → Settings → API                |

## Deploy steps

If using a local clone:
```bash
# Wipe everything in your repo (except .git)
cd /path/to/larrydojo-site
git rm -rf .
# Unzip the new bundle into the repo root
unzip ~/Downloads/full-site.zip -d .
mv full-site/* .
mv full-site/.[!.]* . 2>/dev/null  # hidden files if any
rmdir full-site
git add -A
git commit -m "Full site refresh: live preview pipeline"
git push
```

If using GitHub web UI:
1. Open your repo
2. For each top-level item (index.html, robots.txt, etc.), click into it,
   click the pencil/edit icon, paste in the new content, commit
3. For folders (netlify/, print-your-prompt/), drag-and-drop the entire
   folder onto the file list — GitHub will offer to replace
4. Make sure all 4 functions are in `netlify/functions/`

## After deploy

1. Watch app.netlify.com → your site → Deploys for the green checkmark
2. Visit https://larrydojo.com/print-your-prompt/
3. **Hard reload (Cmd+Shift+R / Ctrl+F5)** — browser caching is the #1 reason
   you'd see stale CSS after a deploy
4. You should see:
   - Form on the LEFT
   - Black "// Live Preview" pane on the RIGHT with yellow drop shadow
   - Wireframe cube SVG inside that pane
5. Submit a test prompt and watch the right side render
