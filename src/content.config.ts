import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// The Menu — one file per project. Ritesh edits these in his own voice.
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    name: z.string(),
    // which course it sits under on the menu
    course: z.enum(['mains', 'small-plates', 'off-menu']),
    tag: z.string(),
    url: z.string().url().optional(),
    order: z.number().default(99),
    draftCopy: z.boolean().default(true),
  }),
});

// Kitchen Log — the blog. status "draft" shows a teaser only.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    status: z.enum(['draft', 'published']).default('draft'),
    excerpt: z.string(),
    order: z.number().default(99),
  }),
});

export const collections = { projects, posts };
