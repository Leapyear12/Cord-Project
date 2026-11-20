import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LEN = 64;

export async function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, KEY_LEN)).toString('hex');
  return { salt, hash };
}

export async function verifyPassword(password, salt, expectedHash) {
  const actual = await scrypt(password, salt, KEY_LEN);
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newToken() {
  return randomBytes(32).toString('hex');
}
