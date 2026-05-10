// netlify/functions/validate-prompt.js
//
// Step 1 of the preview pipeline.
//
// Takes the raw user prompt, runs it through Claude to:
//   1. Detect and silently rewrite anything that references copyrighted IP
//      (Batman → "armored bat-themed vigilante", Mario → "mustachioed plumber
//      in red overalls", etc).
//   2. Detect and refuse anything genuinely unsafe (weapons, NSFW, etc).
//   3. Tighten vague prompts — add dimensions, style, color, materials.
//   4. Add 3D-print-friendly constraints (no thin parts, no extreme overhangs).
//
// Returns JSON:
//   { ok: true, cleaned_prompt: "...", rewrite_notes?: "..." }
//   { ok: false, reason: "..." }   ← only for genuinely unsafe content
//
// Env vars required:
//   ANTHROPIC_API_KEY

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are a prompt rewriter for a custom 3D-printing service. Users describe an object they want made, and you rewrite their description into a tight prompt for an image generation model (Google Gemini 2.5 Flash Image, a.k.a. Nano Banana). The image will be a concept render the user sees and approves before we hand-make the physical object.

Your job has two parts:

1. SAFETY CHECK — refuse genuinely unsafe content:
   - Weapons designed to harm (functional firearms, explosives, bombs)
   - Sexual or NSFW content
   - Content that sexualizes or endangers minors
   - Hate symbols (swastikas, KKK regalia, Confederate battle flag, etc.)
   - Real living people in compromising or defamatory situations
   If any of these, return { "ok": false, "reason": "<short user-facing explanation>" }.

   IP and copyrighted characters are NOT your problem. Pass them through. The
   business handles licensing review during human approval after the user
   submits. Note in rewrite_notes if you noticed a recognizable IP reference,
   so it can be flagged downstream — but don't refuse, don't rewrite the
   character.

2. PROMPT REWRITE — restructure the user's description into a Nano Banana
   prompt that produces a hyperrealistic plastic figurine concept image.

   Every cleaned_prompt MUST follow this template:

     "Hyperrealistic studio product photograph of [SUBJECT DESCRIPTION], rendered as a glossy injection-molded plastic figurine, sharp detail, soft studio lighting, pure white background, no shadow, no base, no platform, no pedestal, the figurine is centered in frame, isolated, no other objects."

   Substitute [SUBJECT DESCRIPTION] with a concise but vivid description of
   what the user asked for. Keep their language where it's good; tighten
   what's vague. Add color, material, and pose details if missing.

   IMPORTANT — base/platform/background suppression:
   - The boilerplate above is mandatory. It explicitly disallows base plates,
     pedestals, platforms, and backgrounds. Don't omit it.
   - The ONLY exception: if the user's prompt explicitly asks for a base or a
     specific setting ("on a wooden pedestal", "in a dungeon"), preserve
     that intent — but still keep the white background unless they asked
     for a specific scene.

   Length target: the cleaned_prompt should fit on a single line — concise,
   no rambling. The boilerplate above is most of it; the SUBJECT DESCRIPTION
   is the only part you're really writing.

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "ok": true,
  "cleaned_prompt": "<the rewritten prompt following the template above>",
  "rewrite_notes": "<short note for internal logging — flag named IP, real-person rewrites, anything notable>"
}

OR if unsafe:
{
  "ok": false,
  "reason": "<short user-facing explanation, friendly tone>"
}`;

exports.handler = async (event) => {
  // CORS for browser fetch.
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { prompt } = JSON.parse(event.body || '{}');

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ ok: false, reason: 'Prompt too short. Tell us a bit more about what to make.' }),
      };
    }

    if (prompt.length > 1000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ ok: false, reason: 'Prompt too long — keep it under 1000 characters.' }),
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, reason: 'Validation service not configured.' }),
      };
    }

    const claudeResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',  // Haiku — fast and cheap for this task
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `User's prompt:\n\n${prompt.trim()}` },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error('Claude API error:', claudeResponse.status, errBody);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, reason: 'Could not validate prompt. Try again in a moment.' }),
      };
    }

    const claudeData = await claudeResponse.json();
    const claudeText = claudeData?.content?.[0]?.text?.trim();

    if (!claudeText) {
      console.error('Empty Claude response:', claudeData);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, reason: 'Validation service returned an empty response.' }),
      };
    }

    // Claude should return clean JSON, but sometimes wraps it. Strip fences just in case.
    const cleanText = claudeText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

    let result;
    try {
      result = JSON.parse(cleanText);
    } catch (parseErr) {
      console.error('Could not parse Claude JSON:', cleanText);
      // Fallback: pass through the original prompt rather than blocking the user.
      result = { ok: true, cleaned_prompt: prompt.trim(), rewrite_notes: 'fallback (parse failed)' };
    }

    // Audit log: useful for tracking when named IP gets through.
    // Logs land in Netlify function logs; not user-visible.
    if (result.ok && result.rewrite_notes) {
      console.log('[validate-prompt audit]', JSON.stringify({
        original: prompt.trim().slice(0, 200),
        cleaned: (result.cleaned_prompt || '').slice(0, 200),
        notes: result.rewrite_notes,
      }));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('validate-prompt error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, reason: 'Validation failed.' }),
    };
  }
};
