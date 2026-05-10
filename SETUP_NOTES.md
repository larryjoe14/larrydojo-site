# Live Preview — Setup Notes

The print-your-prompt page now talks to Meshy.ai through a 3-function pipeline.
Before this works in production, you need to:

## 1. Set environment variables in Netlify

Go to **Site configuration → Environment variables** and add:

| Variable name        | Value                                       | Notes                        |
|----------------------|---------------------------------------------|------------------------------|
| `MESHY_API_KEY`      | (from app.meshy.ai/settings/api)            | Pro plan key works fine      |
| `ANTHROPIC_API_KEY`  | (from console.anthropic.com/settings/keys)  | Free tier covers this easily |

You already have `RESEND` set; leave it alone.

## 2. Deploy

Just push to git. Netlify auto-deploys functions in `/netlify/functions/`.

## 3. Test

After deploy, visit `larrydojo.com/print-your-prompt/`, fill out the form, and submit.

The preview pane on the right should:
1. Switch to "Rendering..." status (acid yellow pulse)
2. Show a progress bar climbing from 0 to ~95% over ~60-90 seconds
3. Show a live log of milestones in JetBrains Mono
4. Land on the result image with a green "Complete" status
5. Show "Preview delivered. Looking good? Our team will follow up by email."

## 4. Verify in Netlify dashboard

- Function logs: **Functions** tab → click each function → see invocations
- Form submissions: **Forms** tab → "print-prompt" form should have entries
- Each successful preview burns ~5 Meshy credits + a few cents of Claude

## What each function does

- **validate-prompt.js**: Claude Haiku silently rewrites copyrighted refs
  ("Batman" → "armored bat-themed vigilante"), tightens vague prompts,
  rejects only genuinely unsafe content. ~$0.005 per call.
- **start-render.js**: Calls Meshy text-to-3d preview (5 credits, no texture).
  Returns a task ID for polling.
- **render-status.js**: The browser polls this every 4 seconds. We proxy
  to Meshy so the API key stays server-side.

## Cost per submission

- Claude validation: ~$0.005
- Meshy preview: 5 credits ≈ $0.10 (at Pro plan economics)
- **Total: ~$0.10 per render**

With 1,000 monthly Pro credits, you get 200 free previews. After that,
the rate limit kicks in (3 per browser session) which keeps casual
abuse manageable. If you hit the credit ceiling regularly, upgrade to
Max plan (4,000 credits/$60).

## What happens if a preview fails

The form submission ALREADY went to Netlify Forms before the preview
started, so you have the lead regardless. The user sees an error
message and a "Try again" button, and is told you'll follow up.

## Optional next: hook submission-created.js to handle print-prompt forms

Right now `submission-created.js` only sends a confirmation email for
the `contact` form. To also email people who submit the print-prompt
form, add a second branch:

```javascript
if (payload.form_name === 'print-prompt') {
  // Send a "we got your prompt" confirmation email
  // Include the cleaned prompt + render URL if you stored them
  return { statusCode: 200, body: 'Print-prompt confirmation sent.' };
}
```
