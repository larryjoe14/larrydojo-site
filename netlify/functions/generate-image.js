// netlify/functions/generate-image.js
//
// Calls Google's Gemini 2.5 Flash Image ("Nano Banana") to produce a
// hyperrealistic, photorealistic 3D plastic model concept image. The
// prompt has already been wrapped in the mandatory boilerplate by
// validate-prompt.js.
//
// Request body:
//   {
//     prompt: "<cleaned prompt from validate-prompt>",
//     reference_image?: { mime_type: "image/jpeg", data: "<base64>" }
//   }
//
// Response:
//   { ok: true, image_b64: "<base64-png>", mime_type: "image/png" }
//   { ok: false, error: "..." }
//
// Env vars required:
//   GEMINI_API_KEY — from aistudio.google.com/app/apikey

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

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
    const { prompt, reference_image } = JSON.parse(event.body || '{}');

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ ok: false, error: 'Prompt missing or too short.' }),
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY not set');
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ ok: false, error: 'Image service not configured.' }),
      };
    }

    // Build the Gemini request. parts[] takes text and optionally an
    // inlineData block for the reference image. Reference images give
    // Nano Banana a much stronger signal than text alone.
    const parts = [{ text: prompt.trim() }];

    if (reference_image && reference_image.data && reference_image.mime_type) {
      const validMime = /^image\/(jpe?g|png|webp)$/i.test(reference_image.mime_type);
      if (validMime && typeof reference_image.data === 'string' && reference_image.data.length < 8_000_000) {
        parts.push({
          inlineData: {
            mimeType: reference_image.mime_type,
            data: reference_image.data,
          },
        });
      } else {
        console.warn('Invalid reference image — proceeding without it.');
      }
    }

    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['Image'],
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      console.error('Gemini API error:', geminiResponse.status, errBody.slice(0, 500));
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: 'Image generation service returned an error.',
          details: geminiResponse.status === 429
            ? 'Rate limit or quota hit — wait a moment, or check billing in Google Cloud.'
            : geminiResponse.status === 400
            ? 'The prompt was rejected by safety filters. Try rephrasing.'
            : 'Try again in a moment.',
        }),
      };
    }

    const data = await geminiResponse.json();

    const candidates = data?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      console.error('Gemini returned no candidates:', JSON.stringify(data).slice(0, 500));
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({ ok: false, error: 'No image in response.' }),
      };
    }

    const partsResp = candidates[0]?.content?.parts || [];
    const imagePart = partsResp.find(p => p?.inlineData?.data);

    if (!imagePart) {
      const textPart = partsResp.find(p => p?.text)?.text;
      console.warn('No image in response, text was:', textPart?.slice(0, 200));
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: 'Image generation refused this prompt.',
          details: textPart?.slice(0, 300) || 'No reason given by the model.',
        }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        image_b64: imagePart.inlineData.data,
        mime_type: imagePart.inlineData.mimeType || 'image/png',
      }),
    };
  } catch (err) {
    console.error('generate-image error:', err);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ ok: false, error: 'Image generation failed.' }),
    };
  }
};
