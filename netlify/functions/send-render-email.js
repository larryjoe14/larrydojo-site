// netlify/functions/send-render-email.js
//
// Fires when the front-end has a successful render and wants to email the
// user a draft of their model. The browser calls this with:
//
//   {
//     name: "Alec",
//     email: "you@example.com",
//     original_prompt: "what the user typed",
//     cleaned_prompt: "what we sent to Meshy",
//     task_id: "the Meshy task ID"
//   }
//
// We verify the task_id by re-fetching it from Meshy server-side. That way
// even though the request comes from the browser, we don't trust whatever
// image URL it might claim — we only trust what Meshy says about a task
// our own API key created. A bot trying to spoof an email can't do it
// without burning 5 Meshy credits to create a real task in your account.
//
// We then build the same brand-styled HTML email pattern submission-created.js
// uses, embed the render image, and send via Resend.
//
// Env vars required:
//   RESEND        — Resend API key
//   MESHY_API_KEY — Meshy API key
//   FROM_EMAIL    — defaults to "LarryDoJo <hello@larrydojo.com>"

const RESEND_URL = 'https://api.resend.com/emails';
const MESHY_API_URL = 'https://api.meshy.ai/openapi/v2/text-to-3d';

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { name, email, original_prompt, cleaned_prompt, task_id } = JSON.parse(event.body || '{}');

    // Basic input validation. We keep this strict because this endpoint
    // does send mail to user-supplied addresses.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid email.' }) };
    }
    if (!original_prompt || !cleaned_prompt || !task_id) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }
    if (original_prompt.length > 2000 || cleaned_prompt.length > 2000) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Prompt too long.' }) };
    }

    const meshyKey = process.env.MESHY_API_KEY;
    const resendKey = process.env.RESEND;

    if (!meshyKey) {
      console.error('MESHY_API_KEY not set');
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Render service not configured.' }) };
    }
    if (!resendKey) {
      console.error('RESEND env var not set');
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Email service not configured.' }) };
    }

    // Verify the Meshy task exists, belongs to us, and succeeded. We don't
    // trust any image URL the browser sends — we look it up ourselves.
    const meshyResponse = await fetch(`${MESHY_API_URL}/${encodeURIComponent(task_id)}`, {
      headers: { 'Authorization': `Bearer ${meshyKey}` },
    });

    if (!meshyResponse.ok) {
      console.error('Meshy verification failed:', meshyResponse.status);
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: 'Could not verify render task.' }),
      };
    }

    const taskData = await meshyResponse.json();
    if (taskData.status !== 'SUCCEEDED') {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: 'Render is not complete yet.' }),
      };
    }

    const verifiedThumbnail = taskData.thumbnail_url || null;
    if (!verifiedThumbnail) {
      console.warn('No thumbnail on succeeded task:', task_id);
      // Still send the email, just without the image.
    }

    const firstName = (name || '').toString().trim().split(' ')[0] || 'there';
    const fromEmail = process.env.FROM_EMAIL || 'LarryDoJo <hello@larrydojo.com>';

    const html = buildEmailHtml({
      firstName,
      originalPrompt: original_prompt,
      cleanedPrompt: cleaned_prompt,
      thumbnailUrl: verifiedThumbnail,
    });
    const text = buildEmailText({
      firstName,
      originalPrompt: original_prompt,
      cleanedPrompt: cleaned_prompt,
      thumbnailUrl: verifiedThumbnail,
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
        subject: 'Your draft is ready — LarryDoJo',
        html,
        text,
      }),
    });

    if (!sendResponse.ok) {
      const errBody = await sendResponse.text();
      console.error('Resend API error:', sendResponse.status, errBody);
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({ error: 'Could not send email.' }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('send-render-email error:', err);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Email send failed.' }),
    };
  }
};

// ─────────────────────────────────────────────────────────────────
// Email body builders — same style as submission-created.js
// ─────────────────────────────────────────────────────────────────

function buildEmailHtml({ firstName, originalPrompt, cleanedPrompt, thumbnailUrl }) {
  const safeOriginal = escapeHtml(originalPrompt).slice(0, 1000);
  const safeCleaned = escapeHtml(cleanedPrompt).slice(0, 2000);

  // Render image block — only included if Meshy actually returned a URL.
  const imageBlock = thumbnailUrl
    ? `
      <tr>
        <td style="padding: 0 36px 24px;">
          <div style="font-family: 'Courier New', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7c5cb8; margin-bottom: 8px;">
            // your draft render
          </div>
          <div style="background: #1a0d2e; border: 2px solid #0a0a0a; padding: 0; text-align: center;">
            <img src="${escapeAttr(thumbnailUrl)}" alt="Your 3D render draft" style="display: block; width: 100%; max-width: 528px; height: auto; margin: 0 auto;" />
          </div>
          <div style="font-family: 'Courier New', monospace; font-size: 11px; color: #7c5cb8; margin-top: 6px; text-align: center;">
            // ai-generated preview · not the final print
          </div>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your draft is ready — LarryDoJo</title>
</head>
<body style="margin: 0; padding: 0; background: #1a0d2e; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">

  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; visibility: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #1a0d2e;">
    Your AI render draft is here. Humans are taking a look — we'll follow up within 24 hours.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a0d2e; padding: 32px 16px;">
    <tr>
      <td align="center">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background: #f4eee4; border: 3px solid #0a0a0a;">

          <!-- Header bar -->
          <tr>
            <td style="background: #0a0a0a; padding: 18px 24px;">
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
            </td>
          </tr>

          <!-- Sticker eyebrow -->
          <tr>
            <td style="padding: 36px 36px 0;">
              <span style="display: inline-block; background: #ffe000; border: 2px solid #0a0a0a; padding: 4px 14px 6px; font-family: 'Brush Script MT', cursive; font-size: 22px; color: #0a0a0a; box-shadow: 4px 4px 0 #0a0a0a;">
                ↓ draft delivered
              </span>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding: 20px 36px 8px;">
              <h1 style="margin: 0; font-family: 'Arial Black', 'Helvetica Neue', Arial, sans-serif; font-weight: 900; font-size: 56px; line-height: 0.9; letter-spacing: -0.03em; text-transform: uppercase; color: #0a0a0a;">
                Your<br>
                <span style="color: #ff5b1f; -webkit-text-stroke: 2px #0a0a0a;">draft.</span>
              </h1>
            </td>
          </tr>

          <!-- Body intro -->
          <tr>
            <td style="padding: 24px 36px 20px;">
              <p style="margin: 0 0 16px; font-size: 18px; line-height: 1.5; color: #0a0a0a;">
                Hey ${escapeHtml(firstName)},
              </p>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.55; color: #0a0a0a;">
                Here's the AI render of what you described. <strong style="background: #ffe000; padding: 0 4px;">A human is now reviewing it</strong> — checking print feasibility, sizing, and any tweaks we'd recommend before we melt plastic.
              </p>
              <p style="margin: 0; font-size: 16px; line-height: 1.55; color: #0a0a0a;">
                We'll follow up <strong style="background: #ffe000; padding: 0 4px;">within 24 hours</strong> with next steps and pricing.
              </p>
            </td>
          </tr>

          ${imageBlock}

          <!-- What you wrote -->
          <tr>
            <td style="padding: 0 36px 16px;">
              <div style="font-family: 'Courier New', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7c5cb8; margin-bottom: 8px;">
                // what you wrote
              </div>
              <div style="background: #ffffff; border: 2px solid #0a0a0a; padding: 16px 18px; font-size: 15px; line-height: 1.55; color: #0a0a0a; white-space: pre-wrap;">
                ${safeOriginal}
              </div>
            </td>
          </tr>

          <!-- What we sent to the AI -->
          <tr>
            <td style="padding: 0 36px 24px;">
              <div style="font-family: 'Courier New', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7c5cb8; margin-bottom: 8px;">
                // our polished version (what the AI saw)
              </div>
              <div style="background: #ffffff; border: 2px solid #0a0a0a; padding: 16px 18px; font-size: 15px; line-height: 1.55; color: #0a0a0a; white-space: pre-wrap;">
                ${safeCleaned}
              </div>
              <div style="font-family: 'Courier New', monospace; font-size: 11px; color: #7c5cb8; margin-top: 6px;">
                // we tighten prompts before rendering — better geometry, no copyrighted refs
              </div>
            </td>
          </tr>

          <!-- What's next -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #0a0a0a; border: 2px solid #0a0a0a;">
                <tr>
                  <td style="padding: 22px 22px 18px;">
                    <div style="font-family: 'Brush Script MT', cursive; font-size: 18px; color: #ffe000; line-height: 1; margin-bottom: 6px;">
                      ↓ what happens next
                    </div>
                    <h3 style="margin: 0 0 10px; font-family: 'Arial Black', sans-serif; font-weight: 900; font-size: 18px; line-height: 1.05; text-transform: uppercase; color: #f4eee4;">
                      A human reviews. <span style="color: #ffe000;">You hear back in 24 hours.</span>
                    </h3>
                    <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #c9b8e8;">
                      We'll send pricing, suggested tweaks, and any printability notes. If you want changes, just reply — first edit is on the house.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding: 0 36px 32px;">
              <p style="margin: 0; font-family: 'Brush Script MT', cursive; font-size: 26px; color: #0a0a0a; line-height: 1;">
                — Larry
              </p>
            </td>
          </tr>

          <!-- Footer bar -->
          <tr>
            <td style="background: #0a0a0a; padding: 18px 24px; font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.5; color: #c9b8e8;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    © 2026 <span style="color: #ffe000;">LARRYDOJO</span> · An AI studio.
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 4px;">
                    You got this email because you submitted a render request at <a href="https://larrydojo.com/print-your-prompt/" style="color: #ffe000; text-decoration: none;">larrydojo.com/print-your-prompt</a>.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

function buildEmailText({ firstName, originalPrompt, cleanedPrompt, thumbnailUrl }) {
  return `Hey ${firstName},

Your AI render draft is ready. A human is now reviewing it — we'll follow up within 24 hours with pricing and next steps.

WHAT YOU WROTE
--------------
${originalPrompt}

OUR POLISHED VERSION (what the AI saw)
--------------------------------------
${cleanedPrompt}

${thumbnailUrl ? `View your render:\n${thumbnailUrl}\n\n` : ''}WHAT'S NEXT

A human reviews your draft for print feasibility and sizing. You'll hear back from us within 24 hours with pricing, suggested tweaks, and any printability notes. First edit is on the house.

— Larry

—
LarryDoJo · An AI studio
You got this email because you submitted a render request at larrydojo.com/print-your-prompt.
`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
