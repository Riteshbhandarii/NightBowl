import { collection, config, fields, singleton } from '@keystatic/core';

const requiredText = (label: string, description?: string) =>
  fields.text({ label, description, validation: { isRequired: true } });

// The admin holds writing: posts, projects and the copy an owner actually rewrites.
// Interface labels (nav, buttons, scene signs, order card, Kitchen Log page labels) are
// JSON in src/content/site/ and are edited in code; see docs/development.md.
export default config({
  // Vite replaces this at compile time in both the browser and server bundles.
  // Runtime NODE_ENV checks can make the two bundles choose different storage.
  storage: import.meta.env.DEV
    ? { kind: 'local' }
    : { kind: 'github', repo: 'Riteshbhandarii/NightBowl' },
  ui: {
    brand: { name: 'NightBowl kitchen' },
    navigation: {
      'Write and publish': ['posts', 'projects'],
      'Site': ['identity', 'home', 'menu'],
      'Pages': ['guide', 'bill', 'specials'],
      'Scene': ['chatter'],
    },
  },
  collections: {
    posts: collection({
      label: 'Kitchen Log',
      slugField: 'title',
      path: 'src/content/posts/*',
      format: { contentField: 'body' },
      entryLayout: 'content',
      previewUrl: '/preview/log/{slug}/',
      columns: ['title', 'status', 'date'],
      schema: {
        title: fields.slug({
          name: { label: 'Title', validation: { isRequired: true } },
        }),
        date: fields.date({
          label: 'Date',
          defaultValue: { kind: 'today' },
          validation: { isRequired: true },
        }),
        status: fields.select({
          label: 'Publishing status',
          description: 'Drafts stay out of the public log. Published entries go live after the deployment finishes.',
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
        excerpt: fields.text({
          label: 'Excerpt',
          multiline: true,
          validation: { isRequired: true, length: { max: 240 } },
        }),
        tags: fields.array(requiredText('Tag'), {
          label: 'Tags',
          itemLabel: ({ value }) => value || 'New tag',
        }),
        order: fields.integer({
          label: 'Display order',
          description: 'Lower numbers appear first.',
          defaultValue: 99,
          validation: { isRequired: true, min: 0 },
        }),
        body: fields.mdx({
          label: 'Post',
          extension: 'md',
          options: {
            heading: true,
            bold: true,
            italic: true,
            link: true,
            blockquote: true,
            orderedList: true,
            unorderedList: true,
            code: true,
            codeBlock: true,
            image: { directory: 'public/images/log', publicPath: '/images/log/' },
          },
        }),
      },
    }),
    projects: collection({
      label: 'Menu projects',
      slugField: 'name',
      path: 'src/content/projects/*',
      format: { contentField: 'body' },
      entryLayout: 'content',
      previewUrl: '/preview/menu/',
      columns: ['name', 'status', 'course', 'order'],
      schema: {
        name: fields.slug({
          name: { label: 'Project name', validation: { isRequired: true } },
        }),
        course: fields.select({
          label: 'Menu section',
          options: [
            { label: 'Mains', value: 'mains' },
            { label: 'Small plates', value: 'small-plates' },
            { label: 'Off the menu', value: 'off-menu' },
          ],
          defaultValue: 'small-plates',
        }),
        tag: requiredText('Technology tag'),
        summary: fields.text({
          label: 'Menu summary',
          description: 'Public short description shown in the menu book and plain HTML menu.',
          multiline: true,
          validation: { isRequired: true, length: { max: 360 } },
        }),
        status: fields.select({
          label: 'Case-study status',
          description: 'Drafts have no public detail route. Publish only after the extended story is approved.',
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
        contribution: fields.text({
          label: 'Contribution',
          description: 'Ritesh\'s specific ownership. Shown only on a published case study.',
          multiline: true,
        }),
        context: fields.text({
          label: 'Context',
          description: 'Short project setting or constraint. Shown only on a published case study.',
          multiline: true,
        }),
        stack: fields.array(requiredText('Technology'), {
          label: 'Technology stack',
          itemLabel: ({ value }) => value || 'New technology',
        }),
        sourceUrl: fields.url({ label: 'Source-code URL' }),
        demoUrl: fields.url({ label: 'Live-demo URL' }),
        featured: fields.checkbox({
          label: "Chef's recommendation",
          description: 'Marks one project as the one to look at first.',
          defaultValue: false,
        }),
        image: fields.image({
          label: 'Menu image',
          description: 'A real screenshot or figure from the project, shown on the plain menu page.',
          directory: 'public/images/projects',
          publicPath: '/images/projects/',
        }),
        imageAlt: fields.text({ label: 'Menu image description' }),
        order: fields.integer({
          label: 'Display order',
          defaultValue: 99,
          validation: { isRequired: true, min: 0 },
        }),
        draftCopy: fields.checkbox({
          label: 'Mark copy as draft',
          defaultValue: true,
        }),
        body: fields.mdx({
          label: 'Extended case study',
          description: 'Draft-only until the case-study status is explicitly set to Published.',
          extension: 'md',
          options: {
            heading: true,
            bold: true,
            italic: true,
            link: true,
            blockquote: true,
            orderedList: true,
            unorderedList: true,
            code: true,
            codeBlock: true,
            image: { directory: 'public/images/projects', publicPath: '/images/projects/' },
          },
        }),
      },
    }),
  },
  singletons: {
    identity: singleton({
      label: 'Site identity',
      path: 'src/content/site/identity',
      format: 'json',
      previewUrl: '/preview/menu/',
      schema: {
        name: requiredText('Site name', 'Shown in the menu book and in search results.'),
        ownerName: requiredText('Portfolio owner name'),
        role: requiredText('Role line', 'Shown under your name on the front of the stall.'),
        availability: requiredText('Availability line', 'Degree, graduation and location, shown on the front of the stall.'),
        positioning: fields.text({ label: 'Positioning line', description: 'One sentence in your own voice, shown on the front of the stall.', multiline: true, validation: { isRequired: true } }),
        github: fields.url({ label: 'GitHub URL', validation: { isRequired: true } }),
        linkedin: fields.url({ label: 'LinkedIn URL', validation: { isRequired: true } }),
        establishedYear: requiredText('Established year', 'Shown on the menu book cover as "est. YEAR".'),
        coverLine: requiredText('Book cover line', 'Large line on the closed menu book.'),
        coverPrompt: fields.text({ label: 'Book cover prompt', description: 'Small tap prompt under the cover line on the closed menu book.', multiline: true, validation: { isRequired: true } }),
        homeDescription: fields.text({ label: 'Search and share description', description: 'Used by search results and link previews for the home page.', multiline: true, validation: { isRequired: true } }),
        draftStamp: requiredText('Draft-copy stamp', 'Stamp on any page that is still marked as draft copy.'),
      },
    }),
    home: singleton({
      label: 'Home page sections',
      path: 'src/content/site/home',
      format: 'json',
      previewUrl: '/preview/menu/',
      schema: {
        scrollCue: requiredText('Scroll cue on the stall', 'Link under the stall front that jumps to the work section.'),
        workTitle: requiredText('Work section title'),
        workIntro: fields.text({ label: 'Work section introduction', multiline: true, validation: { isRequired: true } }),
        allWork: requiredText('Link to every project', 'Link at the end of the work section, to the full menu.'),
        nowTitle: requiredText('Current work section title'),
        aboutTitle: requiredText('About section title'),
        aboutMore: requiredText('Link to the Guide', 'Link at the end of the About section, to the Guide.'),
        logTitle: requiredText('Kitchen Log section title'),
        logMore: requiredText('Link to the Kitchen Log', 'Link at the end of the Kitchen Log section.'),
        contactTitle: requiredText('Contact section title'),
        contactIntro: fields.text({ label: 'Contact section introduction', multiline: true, validation: { isRequired: true } }),
      },
    }),
    menu: singleton({
      label: 'Menu book text',
      path: 'src/content/site/menu',
      format: 'json',
      previewUrl: '/preview/menu/',
      schema: {
        title: requiredText('Title', 'Heading at the top of the menu.'),
        subtitle: fields.text({ label: 'Subtitle', description: 'Under the menu title.', multiline: true, validation: { isRequired: true } }),
        intro: fields.text({ label: 'Introduction', multiline: true, validation: { isRequired: true } }),
        mainsTitle: requiredText('Mains title', 'Heading for the Mains course.'),
        mainsNote: requiredText('Mains note', 'Short line under the Mains heading.'),
        smallPlatesTitle: requiredText('Small plates title', 'Heading for the Small plates course.'),
        smallPlatesNote: requiredText('Small plates note', 'Short line under the Small plates heading.'),
        offMenuTitle: requiredText('Off-menu title', 'Heading for the Off the menu course.'),
        offMenuNote: requiredText('Off-menu note', 'Short line under the Off the menu heading.'),
        closing: fields.text({ label: 'Closing note', description: 'Last line at the bottom of the menu.', multiline: true, validation: { isRequired: true } }),
        featuredLabel: requiredText('Featured project label', 'Tag on the project marked as Chef\'s recommendation.'),
      },
    }),
    guide: singleton({
      label: 'The Guide',
      path: 'src/content/site/guide',
      format: 'json',
      previewUrl: '/preview/menu/',
      schema: {
        eyebrow: requiredText('Eyebrow', 'Small label above the Guide heading.'),
        title: requiredText('Title'),
        intro: fields.text({ label: 'Introduction', multiline: true, validation: { isRequired: true } }),
        body: fields.array(fields.text({ label: 'Paragraph', multiline: true, validation: { isRequired: true } }), {
          label: 'Body paragraphs',
          itemLabel: ({ value }) => value ? value.slice(0, 50) : 'New paragraph',
        }),
        portrait: fields.image({ label: 'Portrait photo', directory: 'public/images/guide', publicPath: '/images/guide/' }),
        portraitAlt: requiredText('Portrait description', 'Read aloud to screen-reader users; say what the photo shows.'),
        githubLabel: requiredText('GitHub link label'),
        draftCopy: fields.checkbox({ label: 'Mark copy as draft', description: 'Keeps the Guide out of search results until the copy is final.', defaultValue: true }),
      },
    }),
    specials: singleton({
      label: "Today's specials",
      path: 'src/content/site/specials',
      format: 'json',
      previewUrl: '/preview/menu/',
      schema: {
        title: requiredText('Section title'),
        items: fields.array(fields.object({
          name: requiredText('Name'),
          note: requiredText('Short status', 'Shown next to the item, for example "on the pass".'),
          line: fields.text({ label: 'Description', multiline: true, validation: { isRequired: true } }),
        }), {
          label: 'Specials',
          itemLabel: ({ fields }) => fields.name.value || 'New special',
        }),
        draftCopy: fields.checkbox({ label: 'Mark copy as draft', defaultValue: true }),
      },
    }),
    bill: singleton({
      label: 'The Bill',
      path: 'src/content/site/bill',
      format: 'json',
      previewUrl: '/preview/menu/',
      schema: {
        eyebrow: requiredText('Eyebrow', 'Small label above the Bill heading.'),
        title: requiredText('Title'),
        intro: fields.text({ label: 'Introduction', multiline: true, validation: { isRequired: true } }),
        rows: fields.array(fields.object({
          label: requiredText('Label'),
          value: requiredText('Value'),
        }), {
          label: 'CV rows',
          itemLabel: ({ fields }) => fields.label.value || 'New row',
        }),
        emptyCvMessage: fields.text({ label: 'Message before CV is ready', multiline: true, validation: { isRequired: true } }),
        cvUrl: requiredText('CV URL', 'Path to the CV PDF in public/, for example /cv.pdf.'),
        email: fields.text({ label: 'Public contact email', description: 'Use only the address Ritesh approves for publication.' }),
        emailConfirmed: fields.checkbox({ label: 'Email approved for public contact', defaultValue: false }),
        cvLinkLabel: requiredText('CV link label'),
        githubLabel: requiredText('GitHub link label'),
        linkedinLabel: requiredText('LinkedIn link label'),
        total: requiredText('Closing total', 'Closing line under the bill, and on the home page.'),
        cvReady: fields.checkbox({ label: 'Show CV download', description: 'Requires an existing PDF in public/ at the CV URL. The build rejects missing or non-PDF assets.', defaultValue: false }),
        draftCopy: fields.checkbox({ label: 'Mark copy as draft', defaultValue: true }),
      },
    }),
    chatter: singleton({
      label: 'Scene chatter',
      path: 'src/content/site/chatter',
      format: 'json',
      previewUrl: '/preview/menu/',
      schema: {
        cook: fields.array(requiredText('Cook line'), { label: 'Cook lines', itemLabel: ({ value }) => value || 'New line' }),
        diner: fields.array(requiredText('Diner line'), { label: 'Diner lines', itemLabel: ({ value }) => value || 'New line' }),
        draftCopy: fields.checkbox({ label: 'Mark copy as draft', defaultValue: true }),
      },
    }),
  },
});
