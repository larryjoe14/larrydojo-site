// netlify/functions/send-render-email.js
//
// Sends one styled confirmation email to the user with their concept image
// embedded inline (CID attachment so it renders in the email body, not just
// as a download).
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
// Env vars required:
//   RESEND      — Resend API key
//   FROM_EMAIL  — defaults to "LarryDoJo <hello@larrydojo.com>"

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
    const imageMime = mime_type || 'image/png';
    const imageFilename = imageMime === 'image/jpeg' ? 'concept.jpg' : 'concept.png';

    // Resend supports inline attachments via the "content_id" field.
    // When you reference cid:<content_id> in an <img src=...> tag, the
    // email client renders the attachment inline. Gmail, Apple Mail,
    // Outlook, and basically every modern client supports this.
    const inlineCid = 'concept-image-1';

    const html = buildEmailHtml({
      firstName,
      originalPrompt: original_prompt,
      cleanedPrompt: cleaned_prompt,
      imageCid: inlineCid,
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
          filename: imageFilename,
          content: image_b64,
          content_type: imageMime,
          content_id: inlineCid,  // Marks this as an inline attachment
        }],
      }),
    });

    if (!sendResponse.ok) {
      const errBody = await sendResponse.text();
      console.error('Resend API error:', sendResponse.status, errBody);
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Could not send email.' }) };
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
// Email builders
// ────────────────────────────────────────────────────────────────

function buildEmailHtml({ firstName, originalPrompt, cleanedPrompt, imageCid }) {
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
    Your concept image is here. Humans review and follow up within 24 hours.
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
          <p style="margin: 0; font-size: 16px; line-height: 1.55; color: #0a0a0a;">
            Here's the AI render of what you described. A human is reviewing your request and will follow up <strong style="background: #ffe000; padding: 0 4px;">within 24 hours</strong> with pricing, tweaks, and next steps.
          </p>
        </td></tr>

        <tr><td style="padding: 0 36px 24px;">
          <div style="font-family: 'Courier New', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7c5cb8; margin-bottom: 8px;">// your concept</div>
          <div style="background: linear-gradient(135deg, #1a0d2e 0%, #2a1a4a 60%, #3d1f5e 100%); border: 2px solid #0a0a0a; padding: 18px; text-align: center;">
            <img src="cid:${imageCid}" alt="Your 3D concept render" style="display: block; width: 100%; max-width: 528px; height: auto; margin: 0 auto;" />
          </div>
          <div style="font-family: 'Courier New', monospace; font-size: 11px; color: #7c5cb8; margin-top: 6px;">
            // ai-generated concept · not the final print
          </div>
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

Your concept is ready. See the attached image.

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

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
