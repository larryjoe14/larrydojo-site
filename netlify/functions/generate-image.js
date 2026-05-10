// netlify/functions/generate-image.js
//
// Step 2 of the new image-first pipeline.
//
// Takes a cleaned prompt (and optionally a reference image) and calls
// Google's Gemini 2.5 Flash Image (a.k.a. "Nano Banana") to produce a
// hyperrealistic plastic figurine concept image. Returns the image as
// a base64 data URL the browser drops directly into an <img> tag.
//
// The prompt is already cleaned by validate-prompt.js — Claude has
// added the hyperrealistic-plastic-no-background-no-base-plate language
// before the call lands here.
//
// Request body:
//   {
//     prompt: "<cleaned prompt from validate-prompt>",
//     reference_image?: { mime_type: "image/jpeg", data: "<base64>" },
//     view?: "front" | "three-quarter" | "back" | "side"  // default "front"
//   }
//
// Response:
//   { ok: true, image_b64: "<base64-png>", mime_type: "image/png" }
//   { ok: false, error: "..." }
//
// Env vars required:
//   GEMINI_API_KEY — from aistudio.google.com/app/apikey

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

// Per-view camera direction. The base hyperrealistic-plastic-no-background
// language is in the cleaned prompt already. Each view appends a camera
// direction so the same subject can be shot from four angles.
const VIEW_INSTRUCTIONS = {
  'front':         ' Camera facing the subject straight-on, front view, eye level.',
  'three-quarter': ' Camera at a 45-degree three-quarter angle, slightly above eye level, classic product-photo angle.',
  'back':          ' Camera facing the back of the subject, eye level, no logo or text visible from this angle.',
  'side':          ' Camera positioned directly to the subject\'s right, full profile silhouette, eye level.',
};

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
    const { prompt, reference_image, view } = JSON.parse(event.body || '{}');

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

    // Build the prompt with the optional view instruction appended.
    const viewKey = (view && VIEW_INSTRUCTIONS[view]) ? view : 'front';
    const finalPrompt = prompt.trim() + VIEW_INSTRUCTIONS[viewKey];

    // Build the Gemini request. parts[] takes text and optionally an
    // inlineData block for the reference image. Reference images give
    // Nano Banana a much stronger signal than text alone.
    const parts = [{ text: finalPrompt }];

    if (reference_image && reference_image.data && reference_image.mime_type) {
      // Validate the reference image: must be JPEG or PNG, base64 string,
      // not absurdly large (we trust the client to have compressed it).
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
            ? 'Rate limit hit — try again in a moment.'
            : geminiResponse.status === 400
            ? 'The prompt was rejected by safety filters. Try rephrasing.'
            : 'Try again in a moment.',
        }),
      };
    }

    const data = await geminiResponse.json();

    // Gemini returns image data inside candidates[0].content.parts[].inlineData.
    // There can be multiple parts (text + image). We pick the first inlineData.
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
      // Sometimes Gemini returns text-only when its safety filter blocks an image.
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
        view: viewKey,
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
