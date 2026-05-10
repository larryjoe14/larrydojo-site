// netlify/functions/render-status.js
//
// Step 3 of the preview pipeline.
//
// The browser polls this endpoint every 4 seconds with the Meshy task_id.
// We proxy the call to Meshy (which keeps the API key server-side) and
// return a normalized response the front-end can act on.
//
// Returns:
//   { status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED",
//     progress: 0-100,
//     thumbnail_url?: "...",     ← present when SUCCEEDED
//     model_url?: "...",         ← present when SUCCEEDED (the .glb file)
//     error?: "..."              ← present when FAILED
//   }
//
// Env vars required:
//   MESHY_API_KEY

const MESHY_API_URL = 'https://api.meshy.ai/openapi/v2/text-to-3d';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const taskId = event.queryStringParameters?.id;
    if (!taskId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing task ID.' }),
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

    const meshyResponse = await fetch(`${MESHY_API_URL}/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!meshyResponse.ok) {
      const errBody = await meshyResponse.text();
      console.error('Meshy status API error:', meshyResponse.status, errBody);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Could not fetch render status.' }),
      };
    }

    const data = await meshyResponse.json();

    // Meshy task object structure:
    //   { id, status, progress, thumbnail_url, model_urls: { glb, fbx, ... },
    //     task_error: { message } }
    const result = {
      status: data.status,
      progress: typeof data.progress === 'number' ? data.progress : 0,
    };

    if (data.status === 'SUCCEEDED') {
      result.thumbnail_url = data.thumbnail_url || null;
      result.model_url = data.model_urls?.glb || null;
    }

    if (data.status === 'FAILED') {
      result.error = data.task_error?.message || 'Render failed.';
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('render-status error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Could not check render status.' }),
    };
  }
};
