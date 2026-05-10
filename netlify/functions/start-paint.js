// netlify/functions/start-paint.js
//
// Step 4 of the preview pipeline (optional).
//
// After a successful Preview render, the user can describe a paint job.
// We run Meshy's Refine pass on the same preview task — same geometry,
// adds texture from the paint prompt.
//
// Costs: 10 credits (vs 5 for the preview alone, so total per opt-in
// user is 15 credits / ~$0.30 of plan budget).
//
// Takes:
//   { preview_task_id: "...", paint_prompt: "..." }
//
// Returns:
//   { task_id: "<the-refine-task-id>" }
//
// The browser then polls /render-status?id=<refine-task-id> the same
// way it polls the preview task.
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
    const { preview_task_id, paint_prompt } = JSON.parse(event.body || '{}');

    if (!preview_task_id || typeof preview_task_id !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing preview task ID.' }),
      };
    }
    if (!paint_prompt || typeof paint_prompt !== 'string' || paint_prompt.trim().length < 3) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Paint description too short.' }),
      };
    }
    if (paint_prompt.length > 500) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Paint description too long — keep it under 500 characters.' }),
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

    // Meshy Refine call: same endpoint, mode "refine", reference the
    // preview task by ID. The texture_prompt field carries the paint job.
    const meshyResponse = await fetch(MESHY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'refine',
        preview_task_id: preview_task_id,
        texture_prompt: paint_prompt.trim(),
        enable_pbr: true,  // Physically-based rendering — better-looking textures
      }),
    });

    if (!meshyResponse.ok) {
      const errBody = await meshyResponse.text();
      console.error('Meshy refine error:', meshyResponse.status, errBody);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Could not start paint step.',
          details: meshyResponse.status === 402
            ? 'Insufficient credits.'
            : meshyResponse.status === 404
            ? 'Could not find your preview render — try generating a new one.'
            : 'Try again in a moment.',
        }),
      };
    }

    const data = await meshyResponse.json();
    const taskId = data?.result;

    if (!taskId) {
      console.error('Meshy refine did not return task ID:', data);
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
    console.error('start-paint error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Could not start paint step.' }),
    };
  }
};
