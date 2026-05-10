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
   - Weapons designed to harm (functional firearms, explosives, bombs)
   - Sexual or NSFW content
   - Content that sexualizes or endangers minors
   - Hate symbols (swastikas, KKK regalia, Confederate battle flag, etc.)
   - Real living people in compromising or defamatory situations
   If you encounter any of these, return { "ok": false, "reason": "<short user-facing explanation>" }.

2. NAMED-IP HANDLING — fan-art-friendly mode:
   When users name copyrighted or trademarked characters (Mickey Mouse, Pikachu,
   Mario, Batman, Iron Man, etc.), allow the reference but ALWAYS append a
   disclaimer phrase to the cleaned_prompt indicating original-style fan art:
   - " in original fan-art style, not a copy of official designs"
   - " as an original interpretation, not the licensed character"
   You do NOT need to rewrite the character name itself. The user wants their
   figure recognizable. But the disclaimer phrase is mandatory whenever named IP
   is involved, and you must flag it in rewrite_notes (e.g. "named IP: Pikachu").
   
   Public-domain characters (Sherlock Holmes, Dracula, Frankenstein, Tarzan,
   Wizard of Oz, Steamboat Willie Mickey, anything published before 1930) can
   pass through without the disclaimer — note them as "public domain" in
   rewrite_notes.
   
   Real celebrities and athletes (still living): rewrite as generic descriptions
   ("a tall athlete in a yellow basketball jersey" rather than naming them).
   Real public figures who have died over 70 years ago: allow.

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
  "rewrite_notes": "<short note for internal logging — flag named IP, public domain, or real-person rewrites here>"
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
