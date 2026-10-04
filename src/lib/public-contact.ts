import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export function publicContact(bill: {
  email: string;
  emailConfirmed: boolean;
  cvReady: boolean;
  cvUrl: string;
}) {
  const email = bill.email.trim();
  if (bill.emailConfirmed && (!/^[^\s@<>]+@[a-z\d.-]+\.[a-z]{2,}$/i.test(email)
    || /@(?:.*\.)?(?:example\.(?:com|net|org)|[^@]+\.(?:invalid|example|test))$/i.test(email))) {
    throw new Error('The Bill needs a valid confirmed public email address.');
  }
  let cv: string | null = null;
  if (bill.cvReady) {
    // Downloads are owned assets, not unchecked redirects to third-party pages.
    if (!/^\/(?!\/)[a-zA-Z0-9_/-]+\.pdf$/.test(bill.cvUrl)) {
      throw new Error('The ready CV must be a local /path/to/file.pdf asset.');
    }
    const publicRoot = resolve('public');
    const path = resolve(publicRoot, bill.cvUrl.slice(1));
    if (!path.startsWith(`${publicRoot}${sep}`)) throw new Error('Invalid CV asset path.');
    let header: Buffer;
    try { header = readFileSync(path).subarray(0, 5); }
    catch { throw new Error(`The ready CV is missing: ${bill.cvUrl}`); }
    if (header.toString() !== '%PDF-') throw new Error('The ready CV asset is not a PDF.');
    cv = bill.cvUrl;
  }
  return { email: bill.emailConfirmed ? email : null, cv };
}
