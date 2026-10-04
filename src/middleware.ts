import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
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
