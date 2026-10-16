import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const nowIso = () => new Date().toISOString();
const sha = value => createHash('sha256').update(value).digest('hex');
const parse = value => JSON.parse(value);
const json = value => JSON.stringify(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const positivePrice = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000_000;
const fail = (status, code, message) => { throw new ApiError(status, code, message); };

export function wordUnits(value) {
  return (value.match(/\p{Script=Han}|[\p{L}\p{N}]+/gu) || []).length;
}

const imageOptions = { failOn: 'error', limitInputPixels: 24_000_000, autoOrient: true };
const editMarkers = /Adobe Photoshop|Photoshop|GIMP|Snapseed|PicsArt|Pixelmator|Affinity Photo|Adobe Firefly/i;

async function normalizedImage(item) {
  const raw = typeof item === 'string' ? item : item?.data_base64;
  if (!isText(raw)) fail(400, 'INVALID_IMAGE', 'Images must contain Base64 data');
  const uri = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/is.exec(raw);
  const mime = uri?.[1]?.toLowerCase() || item?.mime_type?.toLowerCase();
  const base64 = uri ? uri[2] : raw;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    fail(400, 'INVALID_IMAGE', 'Only JPEG, PNG, and WebP images are supported');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 128 || bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== base64) {
    fail(400, 'INVALID_IMAGE', 'Invalid image encoding or image exceeds 5 MB');
  }
  if (editMarkers.test(bytes.toString('latin1'))) fail(422, 114, 'Digitally edited photos are not allowed');
  try {
    const metadata = await sharp(bytes, imageOptions).metadata();
    if (metadata.mediaType !== mime || !metadata.width || !metadata.height ||
        metadata.width * metadata.height > 24_000_000 || (metadata.pages || 1) !== 1) {
      fail(400, 'INVALID_IMAGE', 'Image content does not match its format or exceeds the size limits');
    }
    const pipeline = sharp(bytes, imageOptions);
    const clean = mime === 'image/jpeg' ? await pipeline.jpeg({ quality: 85 }).toBuffer() :
      mime === 'image/png' ? await pipeline.png({ compressionLevel: 9 }).toBuffer() :
      await pipeline.webp({ quality: 85 }).toBuffer();
    if (clean.length > 5 * 1024 * 1024) fail(413, 'IMAGE_TOO_LARGE', 'Processed image exceeds 5 MB');
    return { mime_type: mime, data_base64: clean.toString('base64'), hash: sha(clean) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, 'INVALID_IMAGE', 'Image could not be fully decoded');
  }
}

async function images(items, min, max) {
  if (!Array.isArray(items) || items.length < min || items.length > max) {
    fail(400, 'IMAGE_COUNT', `Provide between ${min} and ${max} images`);
  }
  const normalized = [];
  for (const item of items) normalized.push(await normalizedImage(item));
  if (new Set(normalized.map(item => item.hash)).size !== normalized.length) {
    fail(400, 'DUPLICATE_IMAGE', 'Upload distinct images showing different angles');
  }
  if (normalized.reduce((sum, item) => sum + Buffer.byteLength(item.data_base64, 'base64'), 0) > 40 * 1024 * 1024) {
    fail(413, 'IMAGES_TOO_LARGE', 'Total image size must not exceed 40 MB');
  }
  return normalized;
}

function publicImage(image) { return { mime_type: image.mime_type, data_base64: image.data_base64 }; }

function cleanTags(input, location) {
  const source = input && typeof input === 'object' ? input : {};
  const field = key => isText(source[key]) ? source[key].trim().slice(0, 100) : null;
  return {
    product_type: field('product_type') || 'Uncategorized',
    location: isText(location) ? location.trim().slice(0, 100) : null,
    gender: field('gender'), age_group: field('age_group'), education: field('education'),
    mbti: field('mbti'), income: field('income'), material: field('material'),
    condition: field('condition'), intended_use: field('intended_use'),
    keywords: Array.isArray(source.keywords) ? source.keywords.filter(isText).slice(0, 12).map(x => x.trim().slice(0, 60)) : []
  };
}

function cleanProfile(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const field = key => isText(obj[key]) ? obj[key].trim().slice(0, 100) : null;
  const list = key => Array.isArray(obj[key]) ? obj[key].filter(isText).slice(0, 15).map(x => x.trim().slice(0, 80)) : [];
  const numeric = key => typeof obj[key] === 'number' && Number.isFinite(obj[key]) && obj[key] >= 0 ? obj[key] : null;
  return {
    likes: list('likes'), dislikes: list('dislikes'), gender: field('gender'),
    age: numeric('age'), country: field('country'), location: field('location'),
    ethnicity: field('ethnicity'), education: field('education'), mbti: field('mbti'),
    income_usd_monthly: numeric('income_usd_monthly'), budget_usd: numeric('budget_usd')
  };
}

export function profileDimensionCount(profile) {
  return [profile.likes.length || profile.dislikes.length, profile.gender, profile.age !== null,
    profile.country || profile.location, profile.ethnicity, profile.education, profile.mbti,
    profile.income_usd_monthly !== null || profile.budget_usd !== null].filter(Boolean).length;
}

function similarity(a, b) {
  if (!a || !b) return false;
  const x = String(a).toLocaleLowerCase(), y = String(b).toLocaleLowerCase();
  return x.includes(y) || y.includes(x);
}

export function scoreProduct(product, profile) {
  const tags = parse(product.tags_json);
  let score = 0;
  const searchable = [tags.product_type, tags.material, tags.condition, tags.intended_use, ...tags.keywords, product.description].join(' ').toLocaleLowerCase();
  for (const like of profile.likes) if (searchable.includes(like.toLocaleLowerCase())) score += 5;
  for (const dislike of profile.dislikes) if (searchable.includes(dislike.toLocaleLowerCase())) score -= 8;
  if (profile.budget_usd !== null) score += product.price_usd <= profile.budget_usd ? 4 : -Math.min(8, 2 + (product.price_usd / Math.max(profile.budget_usd, 1)));
  else if (profile.income_usd_monthly !== null && profile.income_usd_monthly > 0) {
    const ratio = product.price_usd / profile.income_usd_monthly;
    score += ratio <= 0.05 ? 1 : ratio > 0.2 ? -2 : 0;
  }
  if (tags.location && (profile.country || profile.location)) score += similarity(tags.location, profile.location || profile.country) ? 2 : -1;
  if (tags.gender && profile.gender && !/all|unisex|\u901a\u7528|\u4e0d\u9650/i.test(tags.gender)) score += similarity(tags.gender, profile.gender) ? 1 : -1;
  if (tags.age_group && profile.age !== null) {
    const numbers = [...tags.age_group.matchAll(/\d{1,3}/g)].map(match => Number(match[0]));
    if (numbers.length >= 2) score += profile.age >= numbers[0] && profile.age <= numbers[1] ? 1 : -1;
  }
  if (tags.mbti && profile.mbti) score += similarity(tags.mbti, profile.mbti) ? 0.25 : 0;
  if (tags.education && profile.education) score += similarity(tags.education, profile.education) ? 0.25 : 0;
  // Ethnicity is retained only for aggregate diagnostics; it is not a basis for product suitability.
  return Number(score.toFixed(3));
}

export function createService(db, ai, dataDir) {
  const imageDir = path.join(dataDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true, mode: 0o700 });
  return {
    async createDraft(body) {
      const exterior = await images(body?.exterior_images, 3, 12);
      const interior = await images(body?.interior_images || [], 0, 4);
      const description = body?.description === undefined || body?.description === null ? null : body.description;
      if (description !== null && (!isText(description) || description.length > 1000)) fail(400, 'INVALID_DESCRIPTION', 'Invalid product description');
      const price = body?.price_usd === undefined || body?.price_usd === null ? null : body.price_usd;
      if (price !== null && !positivePrice(price)) fail(400, 'INVALID_PRICE', 'Price must be a positive amount in USD');
      const location = body?.location;
      if (location !== undefined && location !== null && (!isText(location) || location.length > 100)) fail(400, 'INVALID_LOCATION', 'Invalid location');
      const review = await ai.analyzeProduct(exterior.map(publicImage), interior.map(publicImage), description, location);
      if (typeof review?.edited !== 'boolean') fail(503, 'AI_INVALID_OUTPUT', 'Invalid AI image review; please try again');
      if (review?.edited === true) fail(422, 114, 'Digitally edited photos are not allowed');
      const extra = [...exterior.slice(8), ...interior.slice(2)];
      for (let index = 0; index < extra.length; index += 8) {
        const extraReview = await ai.checkImages(extra.slice(index, index + 8).map(publicImage));
        if (typeof extraReview?.edited !== 'boolean') fail(503, 'AI_INVALID_OUTPUT', 'Invalid AI image review; please try again');
        if (extraReview.edited) fail(422, 114, 'Digitally edited photos are not allowed');
      }
      if (review?.distinct_exterior_views !== true) fail(422, 'INSUFFICIENT_VIEWS', 'Upload at least three distinct exterior photos of the product');
      if (description && review?.description_matches !== true) fail(422, 'DESCRIPTION_MISMATCH', 'The description does not match the images; the product was not saved');
      const proposedDescription = !description && isText(review?.proposed_description) ? review.proposed_description.trim() : null;
      if (!description && (!proposedDescription || wordUnits(proposedDescription) > 100)) {
        fail(503, 'AI_INVALID_OUTPUT', 'AI could not generate a description within 100 word units; retry or provide your own');
      }
      const proposedPrice = !price && positivePrice(review?.proposed_price_usd) ? review.proposed_price_usd : null;
      if (!price && proposedPrice === null) fail(503, 'AI_INVALID_OUTPUT', 'AI could not estimate a price; retry or provide your own');
      const id = randomUUID();
      const created = nowIso();
      const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
      db.prepare(`INSERT INTO drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, created, expires, json(exterior), json(interior), description?.trim() || null, price,
        proposedDescription, proposedPrice, review?.has_cavity === true ? 1 : 0,
        json(cleanTags(review?.tags, location))
      );
      return {
        draft_id: id, expires_at: expires, status: 'awaiting_confirmation',
        proposed_description: proposedDescription, proposed_price_usd: proposedPrice,
        price_note: proposedPrice === null ? null : 'Image-based estimate only; confirm it or provide your own price',
        interior_image_suggested: review?.has_cavity === true && interior.length === 0,
        message: 'Confirm the description and price. Add interior photos if the product has a cavity.'
      };
    },
    async confirmDraft(id, body) {
      const draft = db.prepare('SELECT * FROM drafts WHERE id=?').get(id);
      if (!draft || draft.expires_at < nowIso()) fail(404, 'DRAFT_NOT_FOUND', 'Draft not found or expired');
      const exterior = parse(draft.exterior_json);
      const originalInterior = parse(draft.interior_json);
      const addedInterior = body?.interior_images === undefined ? [] : await images(body.interior_images, 0, 4);
      if (originalInterior.length + addedInterior.length > 4) fail(400, 'IMAGE_COUNT', 'At most four interior photos are allowed');
      if (addedInterior.length) {
        const review = await ai.checkImages(addedInterior.map(publicImage));
        if (typeof review?.edited !== 'boolean') fail(503, 'AI_INVALID_OUTPUT', 'Invalid AI image review; please try again');
        if (review?.edited === true) fail(422, 114, 'Digitally edited photos are not allowed');
      }
      let description = draft.description;
      if (!description) {
        if (body?.accept_description === true) description = draft.proposal_description;
        else if (body?.accept_description === false && isText(body?.description)) description = body.description.trim();
        else fail(400, 'DESCRIPTION_CONFIRMATION_REQUIRED', 'Confirm the suggested description or provide your own');
      }
      if (!isText(description) || description.length > 1000) fail(400, 'INVALID_DESCRIPTION', 'Invalid product description');
      if (description !== draft.description && description !== draft.proposal_description) {
        const result = await ai.matchDescription(exterior.map(publicImage), description);
        if (result?.matches !== true) fail(422, 'DESCRIPTION_MISMATCH', 'The description does not match the images; the product was not saved');
      }
      let price = draft.price_usd;
      if (price === null) {
        if (body?.accept_price === true) price = draft.proposal_price_usd;
        else if (body?.accept_price === false && positivePrice(body?.price_usd)) price = body.price_usd;
        else fail(400, 'PRICE_CONFIRMATION_REQUIRED', 'Confirm the estimated price or provide a price in USD');
      }
      if (!positivePrice(price)) fail(400, 'INVALID_PRICE', 'Price must be a positive amount in USD');
      const allImages = [...exterior, ...originalInterior, ...addedInterior];
      const files = [];
      try {
        for (const image of allImages) {
          const suffix = image.mime_type === 'image/jpeg' ? 'jpg' : image.mime_type.split('/')[1];
          const name = `${randomUUID()}.${suffix}`;
          fs.writeFileSync(path.join(imageDir, name), Buffer.from(image.data_base64, 'base64'), { flag: 'wx', mode: 0o600 });
          files.push({ name, mime_type: image.mime_type, exterior: files.length < exterior.length });
        }
        const productId = randomUUID();
        db.exec('BEGIN IMMEDIATE');
        try {
          const consumed = db.prepare('DELETE FROM drafts WHERE id=? AND expires_at>=?').run(id, nowIso());
          if (consumed.changes !== 1) fail(409, 'DRAFT_ALREADY_CONFIRMED', 'Draft already confirmed or expired');
          db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)').run(productId, nowIso(), description, price, json(files), draft.tags_json);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return { product_id: productId, status: 'created', description, price_usd: price, currency: 'USD' };
      } catch (error) {
        for (const file of files) { try { fs.unlinkSync(path.join(imageDir, file.name)); } catch {} }
        throw error;
      }
    },
    async recommend(userFeatures, mode) {
      if (!isText(userFeatures) || userFeatures.length > 10000) fail(400, 'INVALID_USER_FEATURES', 'Provide valid user feature text');
      const profile = cleanProfile(await ai.extractProfile(userFeatures));
      if (profileDimensionCount(profile) < 3) fail(422, 66, 'Too few user features for an effective recommendation');
      const products = db.prepare('SELECT * FROM products').all();
      if (!products.length) fail(404, 'NO_PRODUCTS', 'No products available for recommendation');
      const ranked = products.map(product => ({ product, score: scoreProduct(product, profile) }))
        .sort((a, b) => mode === 'best' ? b.score - a.score : a.score - b.score);
      const { product, score } = ranked[0];
      const recommendationId = randomUUID();
      const feedbackToken = randomBytes(24).toString('hex');
      db.prepare('INSERT INTO recommendations (id,created_at,product_id,mode,profile_json,score,feedback_token_hash) VALUES (?,?,?,?,?,?,?)')
        .run(recommendationId, nowIso(), product.id, mode,
          json({ has_preferences: profile.likes.length > 0 || profile.dislikes.length > 0,
            budget_exceeded: profile.budget_usd !== null && product.price_usd > profile.budget_usd }),
          score, sha(feedbackToken));
      const imageFiles = parse(product.image_files_json);
      return {
        recommendation_id: recommendationId, feedback_token: feedbackToken,
        product: {
          product_id: product.id, description: product.description, price_usd: product.price_usd,
          currency: 'USD', images: imageFiles.map(file => ({ mime_type: file.mime_type, exterior: file.exterior,
            data_base64: fs.readFileSync(path.join(imageDir, file.name)).toString('base64') }))
        },
        feedback_prompt: 'Rate this recommendation: suitable / unsuitable',
        feedback_endpoint: `/recommendations/${recommendationId}/feedback`
      };
    },
    submitFeedback(id, token, result) {
      // Accept legacy feedback values so existing clients can upgrade gradually.
      const normalizedResult = result === '\u9002\u5408\u6211' ? 'suitable' :
        result === '\u4e0d\u9002\u5408\u6211' ? 'unsuitable' : result;
      if (!['suitable', 'unsuitable'].includes(normalizedResult)) fail(400, 'INVALID_FEEDBACK', 'Feedback must be "suitable" or "unsuitable"');
      const rec = db.prepare('SELECT feedback_token_hash, feedback FROM recommendations WHERE id=?').get(id);
      if (!rec || !isText(token)) fail(404, 'RECOMMENDATION_NOT_FOUND', 'Recommendation not found');
      const a = Buffer.from(rec.feedback_token_hash, 'hex'), b = Buffer.from(sha(token), 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) fail(403, 'INVALID_FEEDBACK_TOKEN', 'Invalid feedback token');
      if (rec.feedback) fail(409, 'FEEDBACK_EXISTS', 'Feedback has already been submitted for this recommendation');
      db.prepare('UPDATE recommendations SET feedback=?, feedback_at=? WHERE id=?').run(normalizedResult, nowIso(), id);
      return { status: 'saved' };
    }
  };
}
