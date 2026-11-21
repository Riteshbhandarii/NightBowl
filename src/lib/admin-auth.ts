// The owner pages use the same sign-in as the Keystatic admin: the GitHub token Keystatic
// stores in a cookie. It counts only if GitHub says that token can push to the repository.
// In development Keystatic edits local files with no sign-in, so these pages are open too.
const REPO = 'Riteshbhandarii/NightBowl'; // keep in step with the repo in keystatic.config.ts

export async function isOwner(request: Request, getCookie: (name: string) => string | undefined): Promise<boolean> {
  if (import.meta.env.DEV) return true;
  const token = getCookie('keystatic-gh-access-token');
  if (!token) return false;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'nightbowl-owner-pages' },
    });
    if (!response.ok) return false;
    return (await response.json())?.permissions?.push === true;
  } catch { return false; }
}

/** A form post counts only from this site's own pages. */
export function sameOrigin(request: Request, origin: string): boolean {
  const sent = request.headers.get('origin');
  return sent === origin;
}
