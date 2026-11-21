// The owner's site copy, one JSON file per section of the admin. Each file is one
// Keystatic singleton (see keystatic.config.ts). This module joins them back into the
// single shape the rest of the site reads, so no component needs to know about the split.
import identity from '../content/site/identity.json';
import home from '../content/site/home.json';
import navigation from '../content/site/navigation.json';
import menu from '../content/site/menu.json';
import guide from '../content/site/guide.json';
import specials from '../content/site/specials.json';
import bill from '../content/site/bill.json';
import log from '../content/site/log.json';
import sceneSigns from '../content/site/sceneSigns.json';
import visitorOrder from '../content/site/visitorOrder.json';
import chatter from '../content/site/chatter.json';

export const siteCopy = {
  site: identity,
  home,
  navigation,
  menu,
  guide,
  specials,
  bill,
  log,
  scene: { ...sceneSigns, ...visitorOrder },
  chatter,
};
