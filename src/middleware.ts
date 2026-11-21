import { defineMiddleware } from 'astro:middleware';
import { ADMIN_GLOW_JS, ADMIN_SUBSCRIBERS_LINK, ADMIN_THEME_CSS } from './lib/admin-theme';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (/^\/keystatic(?:\/|$)/.test(context.url.pathname) && response.headers.get('content-type')?.includes('text/html')) {
    const html = await response.text();
    const themed = new Headers(response.headers);
    themed.delete('content-length'); // the body grew
    return new Response(html.replace(/^<!DOCTYPE html>/i, `<!DOCTYPE html><style id="nb-admin-theme">${ADMIN_THEME_CSS}</style><script>${ADMIN_GLOW_JS}</script><script>${ADMIN_SUBSCRIBERS_LINK}</script>`), {
      status: response.status,
      statusText: response.statusText,
      headers: themed,
    });
  }
  if (!/^\/api\/keystatic(?:\/|$)/.test(context.url.pathname)) return response;

  // Auth redirects, cookies and API errors must never become shared cache entries.
  // Copy the headers so redirects with immutable headers remain safe to handle.
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
