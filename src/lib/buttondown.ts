// A thin Buttondown client for the owner's subscriber page. Plain fetch, no imports, so a
// script can load it directly. Every call is made server-side with the owner's API key; the
// key never reaches the browser.
//
// Endpoints and headers follow Buttondown's API docs:
//   Authorization: Token <key>, X-API-Version: 2026-04-01
//   GET   /v1/subscribers          list (paginated: results, next)
//   POST  /v1/emails               create; status "draft" is the safe default
//   PATCH /v1/emails/{id}          move the draft to "about_to_send" to send it
export const BUTTONDOWN_BASE = 'https://api.buttondown.com/v1';
const API_VERSION = '2026-04-01';

export interface Subscriber { email: string; type: string; created: string }
export interface ButtondownConfig { apiKey: string; base?: string }

async function call(cfg: ButtondownConfig, path: string, init: RequestInit = {}) {
  const response = await fetch(`${cfg.base || BUTTONDOWN_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${cfg.apiKey}`,
      'X-API-Version': API_VERSION,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!response.ok) {
    const detail = body?.detail ?? body?.message ?? text.slice(0, 200);
    throw new Error(`Buttondown ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return body;
}

/** Up to `limit` subscribers, newest first as returned by Buttondown, following `next` links. */
export async function listSubscribers(cfg: ButtondownConfig, limit = 500): Promise<{ subscribers: Subscriber[]; truncated: boolean }> {
  const subscribers: Subscriber[] = [];
  let path: string | null = '/subscribers?ordering=-creation_date';
  let truncated = false;
  while (path) {
    const page: any = await call(cfg, path);
    for (const row of page?.results ?? []) {
      subscribers.push({
        email: String(row.email_address ?? row.email ?? ''),
        type: String(row.type ?? row.subscriber_type ?? ''),
        created: String(row.creation_date ?? ''),
      });
    }
    if (subscribers.length >= limit) { truncated = Boolean(page?.next); break; }
    const next: string | null = page?.next ?? null;
    // `next` is an absolute URL on Buttondown's host; keep only its path and query.
    path = next ? next.replace(/^https?:\/\/[^/]+\/v1/, '') : null;
  }
  return { subscribers: subscribers.slice(0, limit), truncated };
}

/** Creates the email as a draft first, then sends it. Two calls, so a failure never half-sends. */
export async function sendEmail(cfg: ButtondownConfig, email: { subject: string; body: string }) {
  const draft = await call(cfg, '/emails', {
    method: 'POST',
    body: JSON.stringify({ subject: email.subject, body: email.body, status: 'draft' }),
  });
  if (!draft?.id) throw new Error('Buttondown did not return an email id; nothing was sent.');
  await call(cfg, `/emails/${encodeURIComponent(draft.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'about_to_send' }),
  });
  return { id: String(draft.id) };
}

/** Subscribers who will actually receive an email. */
export const receivesEmail = (s: Subscriber) => s.type === 'regular' || s.type === 'premium' || s.type === 'trialed' || s.type === 'gifted';
