import fetch from 'node-fetch';
import FormData from 'form-data';
import { parseFaceApiError } from './imagePrep.js';

const FACE_API_URL = process.env.FACE_API_URL || 'https://face-api-429418881379.asia-south1.run.app';
const MATCH_THRESHOLD = parseFloat(process.env.FACE_MATCH_THRESHOLD || '0.4');

export async function getEmbedding(imageBuffer, filename = 'face.jpg') {
  const form = new FormData();
  form.append('file', imageBuffer, { filename, contentType: 'image/jpeg' });

  const res = await fetch(`${FACE_API_URL}/embedding`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseFaceApiError(res.status, text));
  }

  const data = await res.json();
  const embedding = data.embedding || data;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Face API returned an invalid embedding. Please retake the photo.');
  }
  return embedding;
}

export async function compareFace(imageBuffer, userId, embedding, filename = 'face.jpg') {
  const form = new FormData();
  form.append('file', imageBuffer, { filename, contentType: 'image/jpeg' });
  form.append('embeddings_json', JSON.stringify([[userId, embedding]]));

  const res = await fetch(`${FACE_API_URL}/compare`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseFaceApiError(res.status, text));
  }

  const data = await res.json();
  const rawScore = data.similarity ?? data.score ?? 0;
  // API may return 0-1 (cosine) or 0-100 (percentage)
  const similarity = rawScore > 1 ? rawScore / 100 : rawScore;

  // We compare against a single enrolled face — similarity is the match criterion
  const matched = similarity >= MATCH_THRESHOLD;

  return { matched, similarity, raw: data };
}

export { MATCH_THRESHOLD };
