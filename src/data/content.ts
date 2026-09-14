import content from '../content/site.json';

export const SITE = content.site;
export const NAVIGATION = content.navigation;
export const MENU = content.menu;
export const GUIDE = content.guide;
export const SPECIALS = content.specials;
export const BILL = {
  ...content.bill,
  rows: content.bill.rows.map(({ label, value }) => [label, value] as const),
};
export const LOG = content.log;
export const SCENE = content.scene;
export const CHATTER = content.chatter;
