// netlify/functions/send-render-email.js
//
// Fires when the front-end has a successful image render and wants to email
// the user a draft of their concept. The browser calls this with the Nano
// Banana image payload (base64) and the prompts.
//
// Request body:
//   {
//     name: "Alec",
//     email: "you@example.com",
//     original_prompt: "what the user typed",
//     cleaned_prompt: "what we sent to Nano Banana",
//     image_b64: "<base64 PNG from generate-image>",
//     mime_type: "image/png"
//   }
//
// What it does:
//   1. Sends a confirmation email immediately with the front-view image
//      embedded inline (data URL — works in Gmail, Apple Mail, Outlook).
//   2. Kicks off three additional angle generations in the background
//      (three-quarter, back, side). When each one finishes, sends a
//      follow-up email with that angle attached.
//
// Env vars required:
//   RESEND        — Resend API key
//   GEMINI_API_KEY — for the additional-angle generations
//   FROM_EMAIL    — defaults to "LarryDoJo <hello@larrydojo.com>"
//   URL           — set automatically by Netlify (used to call generate-image
//                   from inside this function)

const RESEND_URL = 'https://api.resend.com/emails';

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { name, email, original_prompt, cleaned_prompt, image_b64, mime_type } = JSON.parse(event.body || '{}');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid email.' }) };
    }
    if (!original_prompt || !cleaned_prompt) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing prompts.' }) };
    }
    if (!image_b64 || typeof image_b64 !== 'string') {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing image data.' }) };
    }

    const resendKey = process.env.RESEND;
    if (!resendKey) {
      console.error('RESEND env var not set');
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Email service not configured.' }) };
    }

    const firstName = (name || '').toString().trim().split(' ')[0] || 'there';
    const fromEmail = process.env.FROM_EMAIL || 'LarryDoJo <hello@larrydojo.com>';

    // Send the primary email with the front-view image attached.
    // We use Resend\'s attachment field rather than embedding base64 in
    // the HTML — attachments are more reliable across clients and don\'t
    // bloat the message body.
    const html = buildEmailHtml({
      firstName,
      originalPrompt: original_prompt,
      cleanedPrompt: cleaned_prompt,
    });
    const text = buildEmailText({
      firstName,
      originalPrompt: original_prompt,
      cleanedPrompt: cleaned_prompt,
    });

    const sendResponse = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        reply_to: 'hello@larrydojo.com',
        subject: 'Your concept is ready — LarryDoJo',
        html,
        text,
        attachments: [{
          filename: 'concept-front.png',
          content: image_b64,
          content_type: mime_type || 'image/png',
        }],
      }),
    });

    if (!sendResponse.ok) {
      const errBody = await sendResponse.text();
      console.error('Resend API error:', sendResponse.status, errBody);
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Could not send email.' }) };
    }

    // Queue the three additional angle generations in the background.
    // We don\'t await this — fire and forget. Each angle generation runs
    // its own generate-image call and sends its own follow-up email.
    //
    // CAUTION: Netlify functions stop running after they return. So we
    // can\'t actually fire-and-forget here — we need to do the work
    // before returning, OR move it to a background function. The cleanest
    // approach: do it inline, accepting that this function takes ~30-45
    // seconds total instead of ~5. The user already sees the front-view
    // image on screen; this function just runs in the background from
    // their perspective.
    //
    // We use Promise.allSettled so one failure doesn\'t kill the others.
    const additionalViews = ['three-quarter', 'back', 'side'];
    const baseUrl = process.env.URL || `https://${event.headers.host || 'larrydojo.com'}`;

    // Don\'t await — let it run as long as the function is allowed to run.
    // Netlify\'s default sync functions cap at 10s. With Pro, 26s. We have
    // up to 26s for all three angles in parallel. That\'s tight but workable
    // since Nano Banana is fast (~3-5s per call).
    const followUpPromise = (async () => {
      try {
        const results = await Promise.allSettled(additionalViews.map(view =>
          generateAndSendView({
            baseUrl,
            view,
            cleanedPrompt: cleaned_prompt,
            originalPrompt: original_prompt,
            firstName,
            email,
            fromEmail,
            resendKey,
          })
        ));
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error(`[follow-up] ${additionalViews[i]} failed:`, r.reason);
          } else {
            console.log(`[follow-up] ${additionalViews[i]} sent`);
          }
        });
      } catch (e) {
        console.error('[follow-up] outer error:', e);
      }
    })();

    // Wait for the follow-ups to finish before returning. We only have
    // ~26s on Pro before timeout, but the front-view email is already sent
    // so even if this times out, the user got their primary email.
    try {
      await Promise.race([
        followUpPromise,
        new Promise(resolve => setTimeout(resolve, 23_000)),  // 23s safety cutoff
      ]);
    } catch (e) {
      console.warn('[follow-up] race ended:', e);
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('send-render-email error:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Email send failed.' }) };
  }
};

// ────────────────────────────────────────────────────────────────
// Helper: generate one additional view and email it
// ────────────────────────────────────────────────────────────────
async function generateAndSendView({ baseUrl, view, cleanedPrompt, originalPrompt, firstName, email, fromEmail, resendKey }) {
  // Call our own generate-image function. We call the live URL rather
  // than importing because Netlify functions are isolated by default
  // and the simplest cross-function pattern is HTTP.
  const genUrl = `${baseUrl}/.netlify/functions/generate-image`;
  const genRes = await fetch(genUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: cleanedPrompt, view: view }),
  });
  if (!genRes.ok) throw new Error(`generate-image returned ${genRes.status}`);

  const genData = await genRes.json();
  if (!genData.ok || !genData.image_b64) {
    throw new Error(genData.error || 'generate-image failed');
  }

  const viewLabels = {
    'three-quarter': 'three-quarter view',
    'back': 'back view',
    'side': 'side view',
  };
  const label = viewLabels[view] || view;

  const html = buildAngleEmailHtml({
    firstName,
    label,
    originalPrompt,
  });
  const text = `Hey ${firstName},\n\nHere's the ${label} of your concept. Attached as a PNG.\n\n— Larry\n`;

  const resendResponse = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      reply_to: 'hello@larrydojo.com',
      subject: `Your concept · ${label} — LarryDoJo`,
      html,
      text,
      attachments: [{
        filename: `concept-${view}.png`,
        content: genData.image_b64,
        content_type: genData.mime_type || 'image/png',
      }],
    }),
  });

  if (!resendResponse.ok) {
    const body = await resendResponse.text();
    throw new Error(`Resend ${resendResponse.status}: ${body.slice(0, 200)}`);
  }
}

// ────────────────────────────────────────────────────────────────
// Email builders
// ────────────────────────────────────────────────────────────────

function buildEmailHtml({ firstName, originalPrompt, cleanedPrompt }) {
  const safeOriginal = escapeHtml(originalPrompt).slice(0, 1000);
  const safeCleaned = escapeHtml(cleanedPrompt).slice(0, 2000);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your concept is ready — LarryDoJo</title>
</head>
<body style="margin: 0; padding: 0; background: #1a0d2e; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">

  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; visibility: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #1a0d2e;">
    Your concept image is here. Three more angles are generating and will arrive in a few minutes. Humans review within 24 hours.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a0d2e; padding: 32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background: #f4eee4; border: 3px solid #0a0a0a;">

        <tr><td style="background: #0a0a0a; padding: 18px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-family: 'Arial Black', 'Helvetica Neue', Arial, sans-serif; font-weight: 900; font-size: 20px; letter-spacing: -0.01em; text-transform: uppercase; color: #f4eee4;">
                LARRY<span style="color: #ffe000;">·</span>DOJO
              </td>
              <td align="right" style="font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #c9b8e8;">
                // print your prompt
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding: 36px 36px 0;">
          <span style="display: inline-block; background: #ffe000; border: 2px solid #0a0a0a; padding: 4px 14px 6px; font-family: 'Brush Script MT', cursive; font-size: 22px; color: #0a0a0a; box-shadow: 4px 4px 0 #0a0a0a;">
            ↓ concept delivered
          </span>
        </td></tr>

        <tr><td style="padding: 20px 36px 8px;">
          <h1 style="margin: 0; font-family: 'Arial Black', 'Helvetica Neue', Arial, sans-serif; font-weight: 900; font-size: 56px; line-height: 0.9; letter-spacing: -0.03em; text-transform: uppercase; color: #0a0a0a;">
            Your<br><span style="color: #ff5b1f; -webkit-text-stroke: 2px #0a0a0a;">concept.</span>
          </h1>
        </td></tr>

        <tr><td style="padding: 24px 36px 20px;">
          <p style="margin: 0 0 16px; font-size: 18px; line-height: 1.5; color: #0a0a0a;">Hey ${escapeHtml(firstName)},</p>
          <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.55; color: #0a0a0a;">
            The front view of your concept is attached as a PNG. <strong style="background: #ffe000; padding: 0 4px;">Three more angles</strong> are generating right now and will land in your inbox in a few minutes (three-quarter, back, and side views).
          </p>
          <p style="margin: 0; font-size: 16px; line-height: 1.55; color: #0a0a0a;">
            A human is reviewing your request and will follow up <strong style="background: #ffe000; padding: 0 4px;">within 24 hours</strong> with pricing, tweaks, and next steps.
          </p>
        </td></tr>

        <tr><td style="padding: 0 36px 16px;">
          <div style="font-family: 'Courier New', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7c5cb8; margin-bottom: 8px;">// what you wrote</div>
          <div style="background: #ffffff; border: 2px solid #0a0a0a; padding: 16px 18px; font-size: 15px; line-height: 1.55; color: #0a0a0a; white-space: pre-wrap;">${safeOriginal}</div>
        </td></tr>

        <tr><td style="padding: 0 36px 24px;">
          <div style="font-family: 'Courier New', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7c5cb8; margin-bottom: 8px;">// our polished version (what the AI saw)</div>
          <div style="background: #ffffff; border: 2px solid #0a0a0a; padding: 16px 18px; font-size: 15px; line-height: 1.55; color: #0a0a0a; white-space: pre-wrap;">${safeCleaned}</div>
        </td></tr>

        <tr><td style="padding: 0 36px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #0a0a0a; border: 2px solid #0a0a0a;">
            <tr><td style="padding: 22px 22px 18px;">
              <div style="font-family: 'Brush Script MT', cursive; font-size: 18px; color: #ffe000; line-height: 1; margin-bottom: 6px;">↓ what happens next</div>
              <h3 style="margin: 0 0 10px; font-family: 'Arial Black', sans-serif; font-weight: 900; font-size: 18px; line-height: 1.05; text-transform: uppercase; color: #f4eee4;">
                A human reviews. <span style="color: #ffe000;">You hear back in 24 hours.</span>
              </h3>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #c9b8e8;">
                We'll send pricing, suggested tweaks, and any printability notes. If you want changes, just reply — first edit is on the house.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding: 0 36px 32px;">
          <p style="margin: 0; font-family: 'Brush Script MT', cursive; font-size: 26px; color: #0a0a0a; line-height: 1;">— Larry</p>
        </td></tr>

        <tr><td style="background: #0a0a0a; padding: 18px 24px; font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.5; color: #c9b8e8;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td>© 2026 <span style="color: #ffe000;">LARRYDOJO</span> · An AI studio.</td></tr>
            <tr><td style="padding-top: 4px;">
              You got this email because you submitted a concept request at <a href="https://larrydojo.com/print-your-prompt/" style="color: #ffe000; text-decoration: none;">larrydojo.com/print-your-prompt</a>.
            </td></tr>
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
}

function buildEmailText({ firstName, originalPrompt, cleanedPrompt }) {
  return `Hey ${firstName},

Your concept is ready. The front view is attached as a PNG. Three more angles are generating right now (three-quarter, back, side) and will land in your inbox in a few minutes.

A human is reviewing your request and will follow up within 24 hours with pricing and next steps.

WHAT YOU WROTE
--------------
${originalPrompt}

OUR POLISHED VERSION (what the AI saw)
--------------------------------------
${cleanedPrompt}

— Larry

—
LarryDoJo · An AI studio
`;
}

function buildAngleEmailHtml({ firstName, label, originalPrompt }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(label)} — LarryDoJo</title></head>
<body style="margin: 0; padding: 0; background: #1a0d2e; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a0d2e; padding: 32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background: #f4eee4; border: 3px solid #0a0a0a;">
        <tr><td style="background: #0a0a0a; padding: 18px 24px; font-family: 'Arial Black', sans-serif; font-weight: 900; font-size: 18px; letter-spacing: -0.01em; text-transform: uppercase; color: #f4eee4;">
          LARRY<span style="color: #ffe000;">·</span>DOJO
        </td></tr>
        <tr><td style="padding: 32px 36px 16px;">
          <p style="margin: 0 0 14px; font-size: 16px; line-height: 1.5; color: #0a0a0a;">Hey ${escapeHtml(firstName)},</p>
          <p style="margin: 0 0 14px; font-size: 15px; line-height: 1.55; color: #0a0a0a;">Here's the <strong style="background: #ffe000; padding: 0 4px;">${escapeHtml(label)}</strong> of your concept, attached as a PNG.</p>
          <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #0a0a0a;">More angles still coming if any are pending. Reply if you'd like changes — first edit is on the house.</p>
        </td></tr>
        <tr><td style="padding: 0 36px 28px;">
          <p style="margin: 0; font-family: 'Brush Script MT', cursive; font-size: 22px; color: #0a0a0a;">— Larry</p>
        </td></tr>
        <tr><td style="background: #0a0a0a; padding: 16px 24px; font-family: 'Courier New', monospace; font-size: 11px; color: #c9b8e8;">
          © 2026 <span style="color: #ffe000;">LARRYDOJO</span> · part of your concept request series
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
