// netlify/functions/start-render.js
//
// Step 2 of the preview pipeline.
//
// Takes a cleaned prompt, kicks off a Meshy Text-to-3D preview job
// (20 credits with meshy-6 — sharper geometry, better faces/hands, worth the
// cost for the lead-gen preview the user sees on screen and in their email).
// Returns the Meshy task_id so the browser can poll for status.
//
// We intentionally use the PREVIEW stage only (not Refine), because:
//   - Preview is 5 credits, Refine adds 10 more for texture.
//   - The preview returns within ~60-90 seconds, fast enough for live UX.
//   - The preview includes thumbnail URLs we can show as the result.
//   - If they convert to an order, we run the full pipeline (preview + refine)
//     for the actual print.
//
// Env vars required:
//   MESHY_API_KEY

const MESHY_API_URL = 'https://api.meshy.ai/openapi/v2/text-to-3d';

exports.handler = async (event) => {
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

    if (!prompt || typeof prompt !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing prompt.' }),
      };
    }

    const apiKey = process.env.MESHY_API_KEY;
    if (!apiKey) {
      console.error('MESHY_API_KEY not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Render service not configured.' }),
      };
    }

    // Meshy Text-to-3D Preview parameters.
    // - mode: "preview" → just geometry, no texture
    // - art_style: "realistic" → matches a "collectible figurine" aesthetic
    // - ai_model: "meshy-6" → 20 credits (vs 5 for meshy-5). Sharper geometry,
    //   fewer artifacts, much better at faces and hands. Worth the cost on a
    //   product where the preview render is the lead-gen hook.
    // - should_remesh: true → cleaner topology, better for printing
    // - target_polycount: 60000 → roughly 2x the default. Adds detail to the
    //   preview render at no extra cost. Caps below the 100k ceiling so render
    //   time stays in the 60-90s range.
    // - symmetry_mode: "auto" → Meshy decides. Helpful for figurines and
    //   characters which are usually bilaterally symmetric.
    const meshyResponse = await fetch(MESHY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'preview',
        prompt: prompt,
        art_style: 'realistic',
        ai_model: 'meshy-6',
        should_remesh: true,
        target_polycount: 60000,
        symmetry_mode: 'auto',
      }),
    });

    if (!meshyResponse.ok) {
      const errBody = await meshyResponse.text();
      console.error('Meshy API error:', meshyResponse.status, errBody);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Render service returned an error.',
          details: meshyResponse.status === 402
            ? 'Insufficient credits.'
            : 'Try again in a moment.',
        }),
      };
    }

    const meshyData = await meshyResponse.json();
    const taskId = meshyData?.result;

    if (!taskId) {
      console.error('Meshy did not return a task ID:', meshyData);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Render service did not return a job ID.' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ task_id: taskId }),
    };
  } catch (err) {
    console.error('start-render error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Could not start render.' }),
    };
  }
};
