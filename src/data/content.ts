// ── Edit this file to change the non-project copy on the menu. ──
// The projects live in src/content/projects/*.md
// The blog posts live in src/content/posts/*.md
// Everything below is placeholder in the assistant's voice — Ritesh rewrites it.

export const SITE = {
  name: 'nightbowl', // working title. Alternatives floated: "the usual", "open late", "counter seat"
  tagline: 'ritesh bhandari — portfolio & kitchen log',
  github: 'https://github.com/Riteshbhandarii',
  linkedin: 'https://www.linkedin.com/in/ritesh-bhandari-0371b5294/',
};

// "The Guide" tab — the host speaking about Ritesh in the third person.
export const GUIDE = {
  intro: 'Not the cook. The one who tells you what the cook has been up to.',
  body: [
    'Pull up a stool. The cook here is Ritesh, final year Data & AI Engineering at Turku University of Applied Sciences, and a student assistant at a research group called Core Cognitive Tech.',
    'He likes the unglamorous half of machine learning. Not the demo: the part where a model or a data pipeline has to run in production without waking anyone at three in the morning.',
    'Ten years of football, one recent first half marathon, English and Finnish, learning Swedish. Everything on the menu he built himself, so ask about any of it.',
  ],
  draftCopy: true,
};

// "Today's specials" — the pot. What has his attention now.
export const SPECIALS = {
  items: [
    { name: 'Final-year thesis', note: 'simmering', line: 'Machine-learning study of used spare-part pricing. In review and defence.' },
    { name: 'Core Cognitive Tech', note: 'on the pass', line: 'Student assistant: agent internals and developer-experience work.' },
    { name: 'Fundamentals, deep track', note: 'slow braise', line: 'A deliberate ground-up rebuild of the maths and stats under all of it.' },
  ],
  draftCopy: true,
};

// "The Bill" tab — the short CV.
export const BILL = {
  intro: 'The short version. Take it with you.',
  rows: [
    ['Order', 'Data & AI Engineering student, final year — Turku UAS'],
    ['Now', 'Student assistant, Core Cognitive Tech'],
    ['Focus', 'Deep learning, data pipelines, backend / MLOps'],
    ['Kitchen', 'Python, PyTorch, Airflow, FastAPI, Django, PostgreSQL, Redis, Docker, Linux'],
    ['Spoken', 'English, Finnish; learning Swedish'],
  ],
  cvNote: 'Full CV as a PDF arrives once the copy is final. Drop it at /public/cv.pdf and flip cvReady to true.',
  cvReady: false,
  draftCopy: true,
};

// ── Ambient NPC chatter in the 3D scene. Short lines, spoken as speech bubbles.
// Placeholder in the assistant's voice — Ritesh rewrites these like the rest.
export const CHATTER = {
  // the cook, talking across the counter
  cook: [
    'Broth\u2019s been on since four.',
    'Careful, that bowl is hot.',
    'Chess engine? He trained it on his own games.',
    'Ask him about the pipeline one. He likes that one.',
    'Two minutes on the noodles. No more.',
    'Thesis is nearly done. He\u2019ll tell you it isn\u2019t.',
  ],
  // the regulars, to each other
  diner: [
    'This is the good one.',
    'Long day?',
    'Same again next week.',
    'Told you it was worth the walk.',
    'Still open at this hour. Every night.',
  ],
  draftCopy: true,
};
