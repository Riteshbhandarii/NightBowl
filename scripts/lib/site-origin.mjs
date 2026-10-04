export function siteOrigin(value = process.env.NIGHTBOWL_SITE_URL) {
  if (!value?.trim()) return undefined;
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('NIGHTBOWL_SITE_URL must be an absolute HTTPS origin.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || url.port
    || host === 'localhost' || host.includes(':') || /^[\d.]+$/.test(host)
    || !host.includes('.') || /\.(example|invalid|test|localhost)$/.test(host)
    || /(^|\.)example\.(com|net|org)$/.test(host)) {
    throw new Error('NIGHTBOWL_SITE_URL must be a production HTTPS origin, without credentials, path, query, hash, or placeholder host.');
  }
  return url.origin;
}
