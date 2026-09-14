import { collection, config, fields, singleton } from '@keystatic/core';

const requiredText = (label: string, description?: string) =>
  fields.text({ label, description, validation: { isRequired: true } });

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
      'Site copy': ['siteCopy'],
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
      previewUrl: '/?preview=menu',
      columns: ['name', 'course', 'order'],
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
        url: fields.url({ label: 'Project URL' }),
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
          label: 'Project description',
          extension: 'md',
          options: { bold: true, italic: true, link: true },
        }),
      },
    }),
  },
  singletons: {
    siteCopy: singleton({
      label: 'Site copy and links',
      path: 'src/content/site',
      format: 'json',
      previewUrl: '/?preview=menu',
      schema: {
        site: fields.object({
          name: requiredText('Site name'),
          tagline: requiredText('Tagline'),
          github: fields.url({ label: 'GitHub URL', validation: { isRequired: true } }),
          linkedin: fields.url({ label: 'LinkedIn URL', validation: { isRequired: true } }),
          establishedYear: requiredText('Established year'),
          coverLine: requiredText('Book cover line'),
          coverPrompt: requiredText('Book cover prompt'),
          homeDescription: fields.text({ label: 'Search and share description', multiline: true, validation: { isRequired: true } }),
          draftStamp: requiredText('Draft-copy stamp'),
        }, { label: 'Site identity' }),
        navigation: fields.object({
          menu: requiredText('Menu label'),
          guide: requiredText('Guide label'),
          log: requiredText('Kitchen Log label'),
          bill: requiredText('Bill label'),
          openMenu: requiredText('Mobile menu button'),
          theme: requiredText('Theme button label'),
        }, { label: 'Navigation labels' }),
        menu: fields.object({
          title: requiredText('Title'),
          subtitle: fields.text({ label: 'Subtitle', multiline: true, validation: { isRequired: true } }),
          intro: fields.text({ label: 'Introduction', multiline: true, validation: { isRequired: true } }),
          mainsTitle: requiredText('Mains title'),
          mainsNote: requiredText('Mains note'),
          smallPlatesTitle: requiredText('Small plates title'),
          smallPlatesNote: requiredText('Small plates note'),
          offMenuTitle: requiredText('Off-menu title'),
          offMenuNote: requiredText('Off-menu note'),
          closing: fields.text({ label: 'Closing note', multiline: true, validation: { isRequired: true } }),
          projectLinkLabel: requiredText('Project link label'),
        }, { label: 'Menu text and course notes' }),
        guide: fields.object({
          eyebrow: requiredText('Eyebrow'),
          title: requiredText('Title'),
          intro: requiredText('Introduction'),
          body: fields.array(fields.text({ label: 'Paragraph', multiline: true, validation: { isRequired: true } }), {
            label: 'Body paragraphs',
            itemLabel: ({ value }) => value ? value.slice(0, 50) : 'New paragraph',
          }),
          portraitPlaceholder: requiredText('Portrait placeholder'),
          githubLabel: requiredText('GitHub link label'),
          draftCopy: fields.checkbox({ label: 'Mark copy as draft', defaultValue: true }),
        }, { label: 'The Guide' }),
        specials: fields.object({
          title: requiredText('Section title'),
          items: fields.array(fields.object({
            name: requiredText('Name'),
            note: requiredText('Short status'),
            line: fields.text({ label: 'Description', multiline: true, validation: { isRequired: true } }),
          }), {
            label: "Today's specials",
            itemLabel: ({ fields }) => fields.name.value || 'New special',
          }),
          draftCopy: fields.checkbox({ label: 'Mark copy as draft', defaultValue: true }),
        }, { label: "Today's specials" }),
        bill: fields.object({
          eyebrow: requiredText('Eyebrow'),
          title: requiredText('Title'),
          intro: requiredText('Introduction'),
          rows: fields.array(fields.object({
            label: requiredText('Label'),
            value: requiredText('Value'),
          }), {
            label: 'CV rows',
            itemLabel: ({ fields }) => fields.label.value || 'New row',
          }),
          cvNote: fields.text({ label: 'CV note', multiline: true }),
          emptyCvMessage: fields.text({ label: 'Message before CV is ready', multiline: true, validation: { isRequired: true } }),
          cvUrl: requiredText('CV URL'),
          cvLinkLabel: requiredText('CV link label'),
          githubLabel: requiredText('GitHub link label'),
          linkedinLabel: requiredText('LinkedIn link label'),
          total: requiredText('Closing total'),
          cvReady: fields.checkbox({ label: 'Show CV download', defaultValue: false }),
          draftCopy: fields.checkbox({ label: 'Mark copy as draft', defaultValue: true }),
        }, { label: 'The Bill' }),
        log: fields.object({
          eyebrow: requiredText('Menu eyebrow'),
          title: requiredText('Title'),
          menuSubtitle: fields.text({ label: 'Menu subtitle', multiline: true, validation: { isRequired: true } }),
          menuIntro: fields.text({ label: 'Menu introduction', multiline: true, validation: { isRequired: true } }),
          indexLinkLabel: requiredText('Complete-log link'),
          indexKicker: requiredText('Index kicker'),
          indexDeck: fields.text({ label: 'Index introduction', multiline: true, validation: { isRequired: true } }),
          indexDescription: fields.text({ label: 'Search and share description', multiline: true, validation: { isRequired: true } }),
          backToStall: requiredText('Back-to-stall link'),
          allEntries: requiredText('All-entries link'),
          draftDateLabel: requiredText('Draft date label'),
          readingSuffix: requiredText('Reading-time suffix'),
        }, { label: 'Kitchen Log labels and introductions' }),
        scene: fields.object({
          canvasLabel: fields.text({ label: 'Accessible scene description', multiline: true, validation: { isRequired: true } }),
          loading: requiredText('Loading message'),
          hint: requiredText('Interaction hint'),
          credit: requiredText('Scene credit'),
          error: requiredText('Scene error message'),
          mainSignLine: requiredText('Main stall sign line'),
          menuSignTitle: requiredText('Menu board title'),
          menuSignFooter: requiredText('Menu board footer'),
          logSignTitle: requiredText('Kitchen Log poster title'),
          logSignItems: fields.array(requiredText('Poster line'), { label: 'Kitchen Log poster lines', itemLabel: ({ value }) => value || 'New line' }),
          logSignFooter: requiredText('Kitchen Log poster footer'),
          specialsHotspot: requiredText('Specials hotspot label'),
          seatHotspot: requiredText('Seat hotspot label'),
          seatPrompt: requiredText('Seat prompt'),
          seatAria: requiredText('Accessible seat label'),
          youLabel: requiredText('Seated visitor label'),
        }, { label: '3D scene signs and prompts' }),
        chatter: fields.object({
          cook: fields.array(requiredText('Cook line'), { label: 'Cook lines', itemLabel: ({ value }) => value || 'New line' }),
          diner: fields.array(requiredText('Diner line'), { label: 'Diner lines', itemLabel: ({ value }) => value || 'New line' }),
          draftCopy: fields.checkbox({ label: 'Mark copy as draft', defaultValue: true }),
        }, { label: 'Scene chatter' }),
      },
    }),
  },
});
