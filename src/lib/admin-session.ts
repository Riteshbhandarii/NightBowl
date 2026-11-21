// The owner signs in with one password. A correct password gives a signed, httpOnly cookie
// (nb-admin). Only the signature is checked on later requests; nothing is stored server-side.
export const SESSION_COOKIE = 'nb-admin';
export const SESSION_SECONDS = 60 * 60 * 12;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Compare two strings in time that does not depend on where they differ. */
export async function sameSecret(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ax = new Uint8Array(x), by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ by[i];
  return diff === 0;
}

export async function makeSession(secret: string, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + SESSION_SECONDS);
  return `${expires}.${await hmac(secret, expires)}`;
}

export async function validSession(secret: string | undefined, value: string | undefined, now = Date.now()) {
  if (!secret || !value) return false;
  const [expires, signature] = value.split('.');
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < now / 1000) return false;
  return sameSecret(signature, await hmac(secret, expires));
}
