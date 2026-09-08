# nightbowl

Ritesh Bhandari's portfolio + kitchen log, served from an interactive late-night
ramen stall. Built with Astro + three.js, static output, deploys anywhere.

`nightbowl` is a working title. Alternatives floated: "the usual", "open late",
"counter seat". Change it in one place: `src/data/content.ts` → `SITE.name`.

## Run it

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # -> dist/  (static)
npm run preview
```

## Where the content lives (all placeholder — Ritesh rewrites it)

| What | File |
|------|------|
| Projects on the menu | `src/content/projects/*.md` — one file each, frontmatter + one-paragraph body |
| Blog posts | `src/content/posts/*.md` — `status: draft` shows a teaser only |
| The Guide / The Bill / Specials / site name | `src/data/content.ts` |
| Colours + type | `src/styles/global.css` (`:root` tokens) |
| The 3D scene | `src/lib/scene.js` |

Adding a project = drop a new `.md` in `src/content/projects/`. That's the whole ritual.

## The cook

The scene loads `public/models/chef.glb` if it exists, otherwise it uses a
hand-built stand-in. See `public/models/PUT-CHEF-GLB-HERE.md` for the Mixamo
steps to get a free rigged one.

## Deploy (static, pick one)

**Cloudflare Pages** (recommended, generous free tier)
1. Push this repo to GitHub.
2. Cloudflare dash → Workers & Pages → Create → Pages → connect the repo.
3. Framework preset: **Astro**. Build command `npm run build`, output `dist`.
4. Add your domain under the project's *Custom domains* tab.

**Vercel**
1. Push to GitHub, import the repo at vercel.com/new.
2. It auto-detects Astro. No settings needed. Deploy.

**Netlify** — same story: connect repo, build `npm run build`, publish `dist`.

After picking a domain, set it in `astro.config.mjs` → `site` (fixes the sitemap
and social-share URLs).

## Stack

- Astro 7 (static), `@astrojs/mdx`, `@astrojs/sitemap`
- three.js 0.185 (scene + GLTFLoader for the cook)
- No CSS framework; tokens + hand-written CSS in `src/styles/global.css`
- Fonts: Zilla Slab / Hanken Grotesk / Space Mono via Google Fonts
