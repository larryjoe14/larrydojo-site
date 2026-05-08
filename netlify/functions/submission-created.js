// netlify/functions/submission-created.js
//
// Fires automatically whenever a Netlify Form is submitted on this site.
// Any function named exactly "submission-created" is wired to the
// `submission-created` event by Netlify — no extra config needed.
//
// What it does:
//   1. Pulls the submitted name + email out of the event payload
//   2. Calls Resend to send a branded HTML confirmation back to the user
//   3. Returns 200 so Netlify knows the hook succeeded
//
// It does NOT replace the existing Netlify Forms behavior. Submissions
// still land in the Netlify dashboard and still trigger any other
// notifications you've configured. This is purely an additional outbound
// confirmation to the person who filled out the form.
//
// Required env vars (set in Netlify → Site configuration → Environment variables):
//   RESEND       — from resend.com/api-keys
//   FROM_EMAIL   — defaults to "LarryDoJo <hello@larrydojo.com>" if unset

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body).payload;

    // Only handle the contact form. If you add more forms later, this guard
    // keeps them from accidentally triggering this confirmation.
    if (payload.form_name !== 'contact') {
      return { statusCode: 200, body: 'Skipped: not the contact form.' };
    }

    const data = payload.data || {};
    const name = (data.name || '').trim();
    const email = (data.email || '').trim();
    const message = (data.message || '').trim();

    // Bail quietly if there's no email to send to. Netlify still keeps
    // the submission in the dashboard either way.
    if (!email) {
      return { statusCode: 200, body: 'Skipped: no email on submission.' };
    }

    const firstName = name.split(' ')[0] || 'there';
    const fromEmail = process.env.FROM_EMAIL || 'LarryDoJo <hello@larrydojo.com>';
    // Reads from `RESEND` env var (Netlify locked us out of renaming the key
    // once it was created as a secret, so the function adapts to the existing
    // var name rather than fighting the UI).
    const apiKey = process.env.RESEND;

    if (!apiKey) {
      console.error('RESEND env var is not set. Confirmation email skipped.');
      return { statusCode: 200, body: 'Skipped: API key missing.' };
    }

    const html = buildEmailHtml({ firstName, message });
    const text = buildEmailText({ firstName });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        reply_to: 'hello@larrydojo.com',
        subject: 'Got it. — LarryDoJo',
        html,
        text,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('Resend API error:', res.status, errBody);
      // Return 200 anyway so Netlify doesn't retry. The submission is
      // already saved; we don't want a stuck retry loop on email failures.
      return { statusCode: 200, body: 'Email send failed but submission stored.' };
    }

    return { statusCode: 200, body: 'Confirmation email sent.' };
  } catch (err) {
    console.error('submission-created function error:', err);
    return { statusCode: 200, body: 'Handled with errors. See logs.' };
  }
};

// ─────────────────────────────────────────────────────────────────
// Email body builders
// ─────────────────────────────────────────────────────────────────

function buildEmailHtml({ firstName, message }) {
  // Inline styles only. Most email clients strip <style> blocks or
  // sandbox them aggressively. Web fonts won't load in Outlook/Gmail
  // either, so we use a font stack that approximates Archivo Black /
  // Space Grotesk on systems that have them, and falls back gracefully.
  //
  // Palette is pulled from the site's CSS custom properties:
  //   --paper:     #f4eee4
  //   --ink:       #0a0a0a
  //   --acid:      #ffe000
  //   --tangerine: #ff5b1f
  //   --orchid:    #c9b8e8

  const safeMessage = (message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 600); // truncate just in case someone pasted a novel

  const messageBlock = safeMessage
    ? `
      <tr>
        <td style="padding: 0 36px 28px;">
          <div style="font-family: 'Courier New', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7c5cb8; margin-bottom: 8px;">
            // what you sent us
          </div>
          <div style="background: #ffffff; border: 2px solid #0a0a0a; padding: 16px 18px; font-size: 15px; line-height: 1.55; color: #0a0a0a; white-space: pre-wrap;">
            ${safeMessage}
          </div>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Got it. — LarryDoJo</title>
</head>
<body style="margin: 0; padding: 0; background: #1a0d2e; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">

  <!-- Preheader: shows in inbox preview, hidden in body -->
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; visibility: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #1a0d2e;">
    Got your message. I'll be in touch within a day or two.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a0d2e; padding: 32px 16px;">
    <tr>
      <td align="center">

        <!-- Outer card -->
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
                    // an AI studio
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Yellow sticker eyebrow -->
          <tr>
            <td style="padding: 36px 36px 0;">
              <span style="display: inline-block; background: #ffe000; border: 2px solid #0a0a0a; padding: 4px 14px 6px; font-family: 'Brush Script MT', cursive; font-size: 22px; color: #0a0a0a; box-shadow: 4px 4px 0 #0a0a0a;">
                ↓ message received
              </span>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding: 20px 36px 8px;">
              <h1 style="margin: 0; font-family: 'Arial Black', 'Helvetica Neue', Arial, sans-serif; font-weight: 900; font-size: 56px; line-height: 0.9; letter-spacing: -0.03em; text-transform: uppercase; color: #0a0a0a;">
                Got<br>
                <span style="color: #ff5b1f; -webkit-text-stroke: 2px #0a0a0a;">it.</span>
              </h1>
            </td>
          </tr>

          <!-- Greeting + body copy -->
          <tr>
            <td style="padding: 24px 36px 8px;">
              <p style="margin: 0 0 16px; font-size: 18px; line-height: 1.5; color: #0a0a0a;">
                Hey ${escapeHtml(firstName)},
              </p>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.55; color: #0a0a0a;">
                Thanks for reaching out. Your message landed and I'll be in touch <strong style="background: #ffe000; padding: 0 4px;">within a day or two</strong>.
              </p>
              <p style="margin: 0; font-size: 16px; line-height: 1.55; color: #0a0a0a;">
                In the meantime, here's what's on the workbench.
              </p>
            </td>
          </tr>

          ${messageBlock}

          <!-- Three-up project links -->
          <tr>
            <td style="padding: 12px 36px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="33%" valign="top" style="padding-right: 6px;">
                    <a href="https://www.youtube.com/@larrydojo" style="display: block; background: #0a0a0a; color: #ffe000; text-decoration: none; padding: 14px 12px; border: 2px solid #0a0a0a; font-family: 'Arial Black', sans-serif; font-weight: 900; font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; text-align: center;">
                      YouTube ↗
                    </a>
                  </td>
                  <td width="33%" valign="top" style="padding: 0 3px;">
                    <a href="https://www.tiktok.com/@larrydojo_noir" style="display: block; background: #0a0a0a; color: #ffe000; text-decoration: none; padding: 14px 12px; border: 2px solid #0a0a0a; font-family: 'Arial Black', sans-serif; font-weight: 900; font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; text-align: center;">
                      TikTok ↗
                    </a>
                  </td>
                  <td width="33%" valign="top" style="padding-left: 6px;">
                    <a href="https://www.instagram.com/larrydojo/" style="display: block; background: #0a0a0a; color: #ffe000; text-decoration: none; padding: 14px 12px; border: 2px solid #0a0a0a; font-family: 'Arial Black', sans-serif; font-weight: 900; font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; text-align: center;">
                      Instagram ↗
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Case study callout -->
          <tr>
            <td style="padding: 0 36px 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #0a0a0a; border: 2px solid #0a0a0a;">
                <tr>
                  <td style="padding: 22px 22px 18px;">
                    <div style="font-family: 'Brush Script MT', cursive; font-size: 18px; color: #ffe000; line-height: 1; margin-bottom: 6px;">
                      ↓ new case study
                    </div>
                    <h3 style="margin: 0 0 8px; font-family: 'Arial Black', sans-serif; font-weight: 900; font-size: 20px; line-height: 1.05; text-transform: uppercase; color: #f4eee4;">
                      Dick Tracy <span style="color: #ffe000;">Origins.</span>
                    </h3>
                    <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.5; color: #c9b8e8;">
                      Character-consistent AI video from a public-domain source. Four frames, one Character Pack, under nine dollars in API spend.
                    </p>
                    <a href="https://larrydojo.com/case-studies/dick-tracy-origins/" style="display: inline-block; background: #ffe000; color: #0a0a0a; text-decoration: none; padding: 10px 16px; border: 2px solid #f4eee4; font-family: 'Arial Black', sans-serif; font-weight: 900; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;">
                      Read the Case Study →
                    </a>
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
                    You got this email because you submitted the contact form at <a href="https://larrydojo.com" style="color: #ffe000; text-decoration: none;">larrydojo.com</a>.
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

function buildEmailText({ firstName }) {
  // Plain-text fallback for email clients that block HTML or for
  // accessibility tools. Keep it short and human.
  return `Hey ${firstName},

Got it. Your message landed and I'll be in touch within a day or two.

In the meantime, here's what's on the workbench:

  YouTube:   https://www.youtube.com/@larrydojo
  TikTok:    https://www.tiktok.com/@larrydojo_noir
  Instagram: https://www.instagram.com/larrydojo/

New case study — Dick Tracy Origins:
https://larrydojo.com/case-studies/dick-tracy-origins/

— Larry

—
LarryDoJo · An AI studio
You got this email because you submitted the contact form at larrydojo.com.
`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
