# nightbowl

Ritesh Bhandari's portfolio + kitchen log, served from an interactive late-night
ramen stall. Built with Astro + three.js, with a GitHub-backed Keystatic admin.

`nightbowl` is a working title. Alternatives floated: "the usual", "open late",
"counter seat". Change it through **Site copy and links** in `/admin/`.

## Run it

```bash
npm install
npm run dev        # http://localhost:4321
npm run check
npm run build      # -> dist/ (standalone Node server + static assets)
npm run check:build
npm run preview
npm run smoke      # run against the production server on port 4321
```

## Write through the admin

Open `http://localhost:4321/admin/`. In development, Keystatic edits the files
in this checkout directly. The admin contains:

- **Kitchen Log** — create and edit posts, set `Draft` or `Published`, add tags,
  write rich Markdown, and open the post preview.
- **Menu projects** — edit every project shown in the menu book.
- **Site copy and links** — edit the Guide, specials, Bill, social links, and
  ambient character dialogue without touching source code.

The intended production workflow is strict:

1. Set a post to **Draft** and save it. It stays out of `/log/` and the sitemap.
2. Open **Preview**. Draft previews live at `/preview/log/<slug>/`, carry a
   `noindex` directive, and are never included in the sitemap.
3. Set it to **Published** and save to the repository's default branch. The
   connected host rebuilds and the public post route goes live.

Project and site-copy saves work the same way. Their Preview action opens the
menu book in preview mode. Local changes are visible immediately; production
changes become visible when the connected deployment finishes.

## Production sign-in

Production uses Keystatic's GitHub mode. Only GitHub users with write access to
`Riteshbhandarii/NightBowl` can edit. Create the GitHub App from the local
`/admin/` setup flow, then copy these values into the deployment environment
(the names are also in `.env.example`):

```text
KEYSTATIC_GITHUB_CLIENT_ID
KEYSTATIC_GITHUB_CLIENT_SECRET
KEYSTATIC_SECRET
PUBLIC_KEYSTATIC_GITHUB_APP_SLUG
```

Add the deployed `/api/keystatic/github/oauth/callback` URL to the GitHub App's
callback URLs. Never commit `.env`; it is ignored.

## Where the content lives (currently draft copy)

| What | File |
|------|------|
| Projects on the menu | `src/content/projects/*.md` — one file each, frontmatter + one-paragraph body |
| Blog posts | `src/content/posts/*.md` — `status: draft` shows a teaser only |
| The Guide / The Bill / Specials / site name | `src/content/site.json` |
| Colours + type | `src/styles/global.css` (`:root` tokens) |
| The 3D scene | `src/lib/scene.js` |

Use `/admin/` for normal editing. The files remain plain Markdown and JSON, so
the content is portable and reviewable in Git.

## The cook

The scene loads `public/models/chef.glb` if it exists, otherwise it uses a
hand-built stand-in. See `public/models/PUT-CHEF-GLB-HERE.md` for the Mixamo
steps to get a free rigged one.

## Deploy

The admin needs server-side Node APIs, so this is deliberately a standalone
Node build instead of a static-only Cloudflare Pages build. Deploy it to any
Node or container host (Railway, Render, Fly.io, a VPS, or a Docker platform):

- Build: `npm ci && npm run build`
- Start: `npm run preview`
- Health route: `/`
- Required environment: the four Keystatic variables above

Changing hosts later does not move or transform the content; it stays in GitHub.
Moving specifically to Vercel later requires swapping `@astrojs/node` for
`@astrojs/vercel`, copying the four environment variables, and adding the new
OAuth callback URL to the GitHub App. The posts, projects, and site copy do not
need conversion.

After picking a domain, set it in `astro.config.mjs` → `site` (fixes the sitemap
and social-share URLs).

## Stack

- Astro 7 with standalone Node output, `@astrojs/mdx`, `@astrojs/sitemap`
- Keystatic admin with GitHub authentication and file-backed content
- three.js 0.185 (scene + GLTFLoader for the cook)
- No CSS framework; tokens + hand-written CSS in `src/styles/global.css`
- Fonts: Zilla Slab / Hanken Grotesk / Space Mono via Google Fonts
