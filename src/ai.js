export class AIUnavailableError extends Error {}

function parseJsonContent(content) {
  if (typeof content !== 'string') throw new AIUnavailableError('AI returned no text');
  try { return JSON.parse(content); }
  catch { throw new AIUnavailableError('AI returned invalid JSON'); }
}

export function createAI(config, fetchImpl = fetch) {
  async function complete(model, messages) {
    let response;
    try {
      response = await fetchImpl(`${config.dashscopeBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.dashscopeKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, enable_thinking: false, stream: false }),
        signal: AbortSignal.timeout(90000)
      });
    } catch { throw new AIUnavailableError('AI request failed'); }
    if (!response.ok) throw new AIUnavailableError(`AI service returned HTTP ${response.status}`);
    let body;
    try { body = await response.json(); } catch { throw new AIUnavailableError('AI returned invalid response'); }
    return parseJsonContent(body?.choices?.[0]?.message?.content);
  }
  const vision = (images, prompt) => complete(config.visionModel, [
    { role: 'system', content: 'You are a careful product photo reviewer. Return JSON only. Write generated explanations, including reason fields, in English. Preserve user-supplied text in its original language. Do not infer hidden facts as certain.' },
    { role: 'user', content: [
      { type: 'text', text: prompt },
      ...images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mime_type};base64,${image.data_base64}` } }))
    ] }
  ]);
  const text = (prompt) => complete(config.textModel, [
    { role: 'system', content: 'Return strictly valid JSON. Extract only facts explicitly present in input. Unknown fields must be null or empty arrays.' },
    { role: 'user', content: prompt }
  ]);
  return {
    async analyzeProduct(exterior, interior, suppliedDescription, location) {
      return vision([...exterior.slice(0, 8), ...interior.slice(0, 2)], `Analyze these product photos. First ${Math.min(exterior.length, 8)} images are exterior; remaining images are interior. Return JSON with fields: edited (boolean: true only when there is strong visible evidence of digital alteration or compositing in the uploaded photograph; printed graphics on physical packaging are not photo editing), distinct_exterior_views (boolean: true only if every exterior image shows a genuinely different view; re-encoded, cropped, or slightly edited copies count as duplicates), description_matches (boolean; true if no description supplied), proposed_description (factual, at most 100 words total; write in English; mention only legible package facts and visible physical features; do not speculate about endorsements, ingredients, health effects, origin, or quality), proposed_price_usd (positive number, rough estimate), has_cavity (boolean), tags (object: product_type string, location string or null, gender string or null, age_group string or null, education string or null, mbti string or null, income string or null, material string or null, condition string or null, intended_use string or null, keywords array of strings). Write newly generated descriptions and inferred tag values in English by default. Preserve supplied descriptions, locations, and other user-provided text in their original language. Do not invent a seller location or unseen material/condition. Treat demographic audiences as uncertain marketing hints; use null when unsupported. Supplied description: ${JSON.stringify(suppliedDescription ?? null)}. Supplied location: ${JSON.stringify(location ?? null)}. Price is an estimate only. Output JSON.`);
    },
    async checkImages(images) {
      return vision(images.slice(0, 8), 'Review these product photos for strong visible evidence of Photoshop or other digital alteration/compositing. Return JSON with edited boolean and reason string. Mark true only if evidence is strong. Output JSON.');
    },
    async matchDescription(images, description) {
      return vision(images.slice(0, 8), `Does this product description match the visible product? Return JSON with matches boolean and reason string. Mark false for a material contradiction; do not reject details that cannot be seen. Description: ${JSON.stringify(description)}. Output JSON.`);
    },
    async extractProfile(input) {
      return text(`Extract only user features explicitly stated in the following text, without guessing. Return JSON fields: likes (array of strings), dislikes (array of strings), gender (string or null), age (number or null), country (string or null), location (string or null), ethnicity (string or null), education (string or null), mbti (string or null), income_usd_monthly (number or null), budget_usd (number or null). For income, use a monthly USD amount only when USD and period are explicit; divide a stated annual USD income by 12. For budget, use USD only if explicitly stated. Otherwise return null. Output JSON. User text: ${JSON.stringify(input)}`);
    }
  };
}
