import { defineMiddleware } from 'astro:middleware';
import { isOwner } from './lib/admin-auth';
import { ADMIN_GLOW_JS, ADMIN_SUBSCRIBERS_LINK, ADMIN_THEME_CSS } from './lib/admin-theme';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  // Everything that edits or lists is behind the password sign-in at /admin.
  if (/^\/(?:keystatic|api\/keystatic)(?:\/|$)/.test(pathname) && !(await isOwner((name) => context.cookies.get(name)?.value))) {
    return pathname.startsWith('/api/')
      ? new Response('Sign in at /admin', { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
      : context.redirect('/admin');
  }
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
