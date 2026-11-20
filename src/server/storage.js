import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { UPLOADS } from './config.js';

const BLOB_PREFIX = 'blob:';
const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export async function saveUpload(buffer, storedName, mime) {
  if (blobEnabled()) {
    const { put } = await import('@vercel/blob');
    const pathname = `uploads/${storedName}`;
    await put(pathname, buffer, { access: 'private', contentType: mime, addRandomSuffix: false });
    return BLOB_PREFIX + pathname;
  }
  mkdirSync(UPLOADS, { recursive: true });
  writeFileSync(path.join(UPLOADS, storedName), buffer);
  return storedName;
}

export async function streamUpload(ref, res) {
  if (ref.startsWith(BLOB_PREFIX)) {
    const { get } = await import('@vercel/blob');
    const { stream } = await get(ref.slice(BLOB_PREFIX.length), { access: 'private' });
    Readable.fromWeb(stream).pipe(res);
    return;
  }
  await new Promise((resolve, reject) => {
    res.sendFile(path.join(UPLOADS, ref), (err) => (err && !res.headersSent ? reject(err) : resolve()));
  });
}

export async function readUploadText(ref) {
  if (ref.startsWith(BLOB_PREFIX)) {
    const { get } = await import('@vercel/blob');
    const { stream } = await get(ref.slice(BLOB_PREFIX.length), { access: 'private' });
    return new Response(stream).text();
  }
  return readFileSync(path.join(UPLOADS, ref), 'utf8');
}
