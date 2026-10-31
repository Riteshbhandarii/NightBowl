import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { LOG, SITE } from '../../data/content';

// The Kitchen Log as an RSS feed: readers can follow it directly, and the
// newsletter (Buttondown RSS-to-email) sends a heads-up for each new entry.
// Only published entries are listed; drafts stay teasers on the site.
export const prerender = true;

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site }) => {
  const posts = (await getCollection('posts', ({ data }) => data.status === 'published'))
    .sort((a, b) => +b.data.date - +a.data.date);
  // An unconfigured build has no origin; links stay relative rather than invent one.
  const url = (path: string) => (site ? new URL(path, site).href : path);
  const items = posts.map((post) => {
    const link = url(`/log/${post.id.replace(/\.(md|mdx)$/, '')}/`);
    return `    <item>
      <title>${escape(post.data.title)}</title>
      <link>${escape(link)}</link>
      <guid>${escape(link)}</guid>
      <pubDate>${post.data.date.toUTCString()}</pubDate>
      <description>${escape(post.data.excerpt)}</description>
    </item>`;
  }).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escape(`${LOG.title} · ${SITE.name}`)}</title>
    <link>${escape(url('/log/'))}</link>
    <description>${escape(LOG.indexDescription)}</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
