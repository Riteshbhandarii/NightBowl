// Owner pages (/keystatic, /api/keystatic, /admin/subscribers) need the password sign-in at
// /admin. In development Keystatic edits local files with no sign-in, so they are open too.
import { ADMIN_SESSION_SECRET } from 'astro:env/server';
import { SESSION_COOKIE, validSession } from './admin-session';

export async function isOwner(getCookie: (name: string) => string | undefined): Promise<boolean> {
  if (import.meta.env.DEV) return true;
  return validSession(ADMIN_SESSION_SECRET, getCookie(SESSION_COOKIE));
}

/** A form post counts only from this site's own pages. */
export function sameOrigin(request: Request, origin: string): boolean {
  const sent = request.headers.get('origin');
  if (!sent) return false;
  return sent === origin || new URL(sent).host === request.headers.get('host');
}
