import sharp from 'sharp';

const MIN_BYTES = 2000;
const TARGET_SIZE = 1024;

export async function prepareImageForFaceApi(buffer, filename = 'face.jpg') {
  if (!buffer || buffer.length < MIN_BYTES) {
    throw new Error('Photo upload failed or image is too small. Please retake the photo.');
  }

  try {
    const processed = await sharp(buffer)
      .rotate()
      .resize(TARGET_SIZE, TARGET_SIZE, {
        fit: 'inside',
        withoutEnlargement: false,
      })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    if (processed.length < MIN_BYTES) {
      throw new Error('Could not process photo. Please retake with better lighting.');
    }

    return { buffer: processed, filename: filename.replace(/\.\w+$/, '.jpg') || 'face.jpg' };
  } catch (err) {
    if (err.message?.includes('Photo upload') || err.message?.includes('Could not process')) {
      throw err;
    }
    throw new Error('Invalid image format. Please retake the photo as a clear face shot.');
  }
}

export function parseFaceApiError(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  if (status === 422 || /no face detected/i.test(text)) {
    return 'No face detected. Face the camera directly, ensure good lighting, and keep your full face inside the frame.';
  }
  if (status === 400) {
    return 'Invalid photo. Please retake a clear front-facing selfie.';
  }
  return `Face verification error (${status}): ${text}`;
}
