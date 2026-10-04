import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const projectsDir = join(root, 'src/content/projects');
const routeSource = readFileSync(join(root, 'src/pages/menu/[slug].astro'), 'utf8');
const menuBookSource = readFileSync(join(root, 'src/components/MenuBook.astro'), 'utf8');
const editorSource = readFileSync(join(root, 'keystatic.config.ts'), 'utf8');
const failures = [];

const check = (name, ok) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
  if (!ok) failures.push(name);
};

const projectFiles = readdirSync(projectsDir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => join(projectsDir, name));

const field = (source, name) => {
  const value = source.match(new RegExp(`^${name}:\\s*["']?([^"'\\n]+)`, 'm'))?.[1];
  return value?.trim();
};

const frontmatterEnd = (source) => source.indexOf('\n---', 4);
const body = (source) => source.slice(frontmatterEnd(source) + 4).trim();
const outputRoot = () => {
  const dist = join(root, 'dist');
  return existsSync(join(dist, 'client')) ? join(dist, 'client') : dist;
};
const build = () => execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });

console.log('\nproject source contract');
for (const file of projectFiles) {
  const source = readFileSync(file, 'utf8');
  check(`${basename(file)} has an explicit public summary`, Boolean(field(source, 'summary')));
  check(`${basename(file)} has an explicit publication status`, ['draft', 'published'].includes(field(source, 'status')));
}
check('detail route filters the collection to published projects', routeSource.includes("data.status === 'published'"));
check('menu-book project markup reads summary instead of project body', menuBookSource.includes('p.data.summary') && !menuBookSource.includes('p.body'));

console.log('\nproject editor contract');
for (const editorCapability of [
  'summary:',
  'status:',
  'contribution:',
  'context:',
  'stack:',
  'sourceUrl:',
  'demoUrl:',
  'heading: true',
  'unorderedList: true',
  'codeBlock: true',
  "public/images/projects",
]) {
  check(`editor exposes ${editorCapability}`, editorSource.includes(editorCapability));
}

const draftFile = projectFiles.find((file) => field(readFileSync(file, 'utf8'), 'status') === 'draft');
if (!draftFile) {
  throw new Error('A draft project is required for the temporary publication fixture.');
}

const original = readFileSync(draftFile, 'utf8');
const slug = basename(draftFile, '.md');
const fixtureBody = `
## PROJECT_ROUTE_FIXTURE_HEADING

- PROJECT_ROUTE_FIXTURE_LIST

\`PROJECT_ROUTE_FIXTURE_INLINE_CODE\`

\`\`\`text
PROJECT_ROUTE_FIXTURE_CODE_BLOCK
\`\`\`

![PROJECT_ROUTE_FIXTURE_IMAGE](/favicon.svg)
`;
const draftFixture = original
  .replace(
    /^order:/m,
    'contribution: "PROJECT_ROUTE_FIXTURE_CONTRIBUTION"\ncontext: "PROJECT_ROUTE_FIXTURE_CONTEXT"\nstack:\n  - "PROJECT_ROUTE_FIXTURE_STACK"\norder:',
  )
  .replace(/\s*$/, fixtureBody);

try {
  writeFileSync(draftFile, draftFixture);
  build();
  const draftDist = outputRoot();
  check('extended draft has no public detail route', !existsSync(join(draftDist, 'menu', slug, 'index.html')));
  for (const route of ['index.html', 'menu/index.html']) {
    const html = readFileSync(join(draftDist, route), 'utf8');
    check(`${route} excludes draft body and private fields`,
      !html.includes('PROJECT_ROUTE_FIXTURE_HEADING')
      && !html.includes('PROJECT_ROUTE_FIXTURE_CONTRIBUTION')
      && !html.includes('PROJECT_ROUTE_FIXTURE_CONTEXT')
      && !html.includes('PROJECT_ROUTE_FIXTURE_STACK'));
  }
  writeFileSync(draftFile, draftFixture.replace(/^status:\s*["']?draft["']?$/m, 'status: "published"'));
  build();

  const dist = outputRoot();
  const menuHtml = readFileSync(join(dist, 'menu/index.html'), 'utf8');
  const detailPath = join(dist, 'menu', slug, 'index.html');
  check('published fixture creates its existing-slug detail route', existsSync(detailPath));

  if (existsSync(detailPath)) {
    const detailHtml = readFileSync(detailPath, 'utf8');
    check('detail renders a heading', detailHtml.includes('PROJECT_ROUTE_FIXTURE_HEADING'));
    check('detail renders a list', detailHtml.includes('PROJECT_ROUTE_FIXTURE_LIST'));
    check('detail renders inline code', detailHtml.includes('PROJECT_ROUTE_FIXTURE_INLINE_CODE'));
    check('detail renders a code block', detailHtml.includes('PROJECT_ROUTE_FIXTURE_CODE_BLOCK'));
    check('detail renders an image', detailHtml.includes('PROJECT_ROUTE_FIXTURE_IMAGE'));
    check('detail renders approved-only structured fields',
      detailHtml.includes('PROJECT_ROUTE_FIXTURE_CONTRIBUTION')
        && detailHtml.includes('PROJECT_ROUTE_FIXTURE_CONTEXT')
        && detailHtml.includes('PROJECT_ROUTE_FIXTURE_STACK'));
    check('detail has a normal return link to the Menu', detailHtml.includes('href="/menu/"'));
    for (const href of ['/guide/', '/log/', '/bill/', '/']) {
      check(`reading navigation includes ${href}`, detailHtml.includes(`href="${href}"`));
    }
  }

  check('summary index links to a published case study', menuHtml.includes(`href="/menu/${slug}/"`));
  check('summary index does not leak extended Markdown',
    !menuHtml.includes('PROJECT_ROUTE_FIXTURE_HEADING')
      && !menuHtml.includes('PROJECT_ROUTE_FIXTURE_CODE_BLOCK'));
  check('summary index does not leak private structured fields',
    !menuHtml.includes('PROJECT_ROUTE_FIXTURE_CONTRIBUTION')
      && !menuHtml.includes('PROJECT_ROUTE_FIXTURE_CONTEXT')
      && !menuHtml.includes('PROJECT_ROUTE_FIXTURE_STACK'));
} finally {
  writeFileSync(draftFile, original);
  build();
}

console.log('\ndraft publication boundary');
const finalDist = outputRoot();
const finalMenu = readFileSync(join(finalDist, 'menu/index.html'), 'utf8');
const restoredSource = readFileSync(draftFile, 'utf8');
check('temporary project fixture is restored to draft', field(restoredSource, 'status') === 'draft');
check('restored draft has no public detail route', !existsSync(join(finalDist, 'menu', slug, 'index.html')));
check('restored draft summary remains public', finalMenu.includes(field(restoredSource, 'summary')));
if (body(restoredSource)) {
  check('restored draft body is absent from the public summary index', !finalMenu.includes(body(restoredSource)));
}

if (failures.length) {
  console.error(`\n${failures.length} project route check(s) failed`);
  process.exit(1);
}

console.log('all project route checks passed\n');
