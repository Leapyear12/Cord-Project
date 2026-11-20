import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.join(here, '..', '..');
export const SERVERLESS = Boolean(process.env.VERCEL);
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(PROJECT_ROOT, process.env.DATA_DIR)
  : SERVERLESS
    ? path.join(os.tmpdir(), 'chatterbox')
    : path.join(PROJECT_ROOT, 'data');
export const UPLOADS = path.join(DATA_DIR, 'uploads');
