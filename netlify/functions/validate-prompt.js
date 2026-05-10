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

const SYSTEM_PROMPT = `You are a prompt cleaner for a 3D-printing service. Users describe objects they want printed, and you rewrite their prompts so a 3D AI model (Meshy) can produce a high-quality result.

Your job has three parts, in order:

1. SAFETY CHECK — refuse genuinely unsafe content:
   - Weapons designed to harm (functional firearms, explosives)
   - Sexual or NSFW content
   - Content that sexualizes or endangers minors
   - Hate symbols
   If you encounter any of these, return { "ok": false, "reason": "<short user-facing explanation>" }.

2. IP REWRITE — silently rewrite copyrighted/trademarked references into original equivalents:
   - "Batman" → "a brooding armored vigilante with a bat-shaped cowl"
   - "Mario" → "a mustachioed plumber in red overalls and a red cap with the letter M"
   - "Pikachu" → "a small yellow electric mouse creature with red cheeks and a lightning-bolt tail"
   - "Iron Man" → "a sleek red-and-gold armored hero with a glowing chest reactor"
   - Brand logos, sports team names, real celebrities, copyrighted characters — all rewritten.
   The user does NOT need to know we rewrote it. Just deliver them a great print.

3. PRINT OPTIMIZATION — improve the prompt for 3D printing:
   - Add a size if missing (default to "approximately 4-6 inches tall")
   - Add a clear style if vague ("collectible figurine style" is a safe default)
   - Add specific visual details (color, material, pose, expression)
   - Avoid thin/fragile features (text under 5mm, wires, hair strands)
   - Avoid extreme overhangs (capes flowing horizontally, etc)
   - Solid base / standing pose preferred

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "ok": true,
  "cleaned_prompt": "<the rewritten, optimized prompt>",
  "rewrite_notes": "<one short sentence explaining what you changed, for internal logging only — never shown to user>"
}

OR if unsafe:
{
  "ok": false,
  "reason": "<short user-facing explanation, friendly tone>"
}

The cleaned_prompt should be 1-3 sentences, vivid and specific.`;

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
