// Natural-language intents with known answers. Phrasing deliberately avoids copying the
// accessibility label, so the text-only arm cannot win by string matching alone.
import type { Page } from 'playwright';

export interface Target {
  t: string;
  tag: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  risk: boolean;
  icon: boolean;
}
export interface Intent {
  id: string;
  intent: string;
  target: string;
  box: { x: number; y: number; w: number; h: number };
  tags: string[];
  risk: boolean;
}

const first = (n: string) => n.split(' ')[0];
const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'];

function phrase(t: string, s: any): string | null {
  let m: RegExpMatchArray | null;
  const who = (slug: string) => s.mail.rows.find((r: any) => slugify(r.who) === slug);
  if ((m = t.match(/^nav-(.+)$/))) return `Go to the ${m[1]} section of the app`;
  if ((m = t.match(/^archive-(.+)$/))) return `Archive ${first(who(m[1]).who)}'s message`;
  if ((m = t.match(/^delete-(.+)$/))) return `Throw away the message from ${who(m[1]).who}`;
  if ((m = t.match(/^star-(.+)$/))) return `Flag the email about "${who(m[1]).subj}" as important`;
  if ((m = t.match(/^open-(.+)$/))) return `Read the message about "${who(m[1]).subj}"`;
  if ((m = t.match(/^folder-(.+)$/)))
    return (
      (
        {
          inbox: 'Back to the inbox',
          starred: 'Show my flagged mail',
          sent: 'See what I have sent',
          drafts: 'Find my unfinished emails',
          spam: 'Look at the junk mail',
          trash: 'Look in the bin',
        } as any
      )[m[1]] ?? null
    );
  if (t === 'mail-compose') return 'Write a new email';
  if (t === 'mail-refresh') return 'Check for new mail';
  if (t === 'mail-markall') return 'Clear all the unread markers';
  if (t === 'mail-search') return 'Click into the box for searching emails';
  if (t === 'settings-notifications') return 'Turn email alerts on or off';
  if (t === 'settings-dark') return 'Switch the app to a dark theme';
  if (t === 'settings-autoupdate') return 'Stop the app from updating itself';
  if (t === 'settings-save') return 'Keep these settings';
  if (t === 'settings-cancel') return 'Throw away my edits to the settings';
  if (t === 'settings-name') return 'Edit the name other people see';
  if (t === 'settings-email') return 'Change my email address';
  if (t === 'settings-language') return 'Pick a different language';
  if ((m = t.match(/^settings-tab-(.+)$/)))
    return ({ security: 'Open the password and security page', billing: 'Open the payment settings page' } as any)[m[1]] ?? null;
  if ((m = t.match(/^file-(.+)$/))) {
    const f = s.files.items.find(([n]: [string]) => slugify(n) === m![1]);
    const base = f[0].replace(/\.[a-z]+$/, '');
    return f[1] === '📁' ? `Go into the ${base} folder` : `Open the ${base} file`;
  }
  if (t === 'files-upload') return 'Add a file from my computer';
  if (t === 'files-newfolder') return 'Make a new folder';
  if (t === 'files-sort') return 'Change the order of the files';
  if (t === 'files-list') return 'Show the files as rows instead of tiles';
  if (t === 'files-grid') return 'Show the files as big tiles';
  if ((m = t.match(/^add-(.+)$/))) return `Put the ${s.shop.products.find(([n]: [string]) => slugify(n) === m![1])[0].toLowerCase()} in my basket`;
  if (t === 'shop-coupon') return 'Click where the discount code goes';
  if (t === 'shop-apply') return 'Use the discount code';
  if (t === 'shop-checkout') return 'Buy everything in the cart';
  if ((m = t.match(/^tab-(.+)$/)))
    return (
      (
        {
          overview: 'Show the summary view',
          usage: 'Show how much we are using',
          billing: 'Show what we are paying',
          logs: 'Show the raw logs',
          alerts: 'Show the alerts',
        } as any
      )[m[1]] ?? null
    );
  if ((m = t.match(/^refresh-(.+)$/))) return `Reload the ${cardName(s, m[1]).toLowerCase()} numbers`;
  if ((m = t.match(/^expand-(.+)$/))) return `Make the ${cardName(s, m[1]).toLowerCase()} card full size`;
  if ((m = t.match(/^more-(.+)$/))) return `Open the menu for the ${cardName(s, m[1]).toLowerCase()} card`;
  if (t === 'dash-export') return 'Download the data as a spreadsheet';
  if (t === 'dash-range') return 'Change the time window';
  if ((m = t.match(/^chat-(?!attach|emoji|send|input)(.+)$/))) return `Talk to ${first(s.chat.convos.find((c: any) => slugify(c.who) === m![1]).who)}`;
  if (t === 'chat-attach') return 'Add a file to my message';
  if (t === 'chat-emoji') return 'Add a smiley';
  if (t === 'chat-send') return 'Send what I typed';
  if (t === 'chat-input') return 'Click where I type my message';
  if ((m = t.match(/^sort-(.+)$/))) return `Order the table by ${m[1]}`;
  if ((m = t.match(/^edit-(.+)$/))) return `Change ${personName(s, m[1])}'s details`;
  if ((m = t.match(/^remove-person-(.+)$/))) return `Take ${personName(s, m[1])} off the list`;
  if ((m = t.match(/^page-(\d)$/))) return `Show the ${ordinal[Number(m[1]) - 1]} page of people`;
  if (t === 'page-next') return 'Show more people';
  if (t === 'dialog-keep') return 'Go back to my draft without losing it';
  if (t === 'dialog-close') return 'Dismiss this popup with the X';
  if (t === 'dialog-discard') return 'Throw my edits away';
  return null;
}
const cardName = (s: any, slug: string) => s.dash.cards.find((c: any) => slugify(c.n) === slug).n;
const personName = (s: any, slug: string) => s.people.rows.find((r: any) => slugify(r.n) === slug).n;
export const slugify = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Seeded pick of up to `n` intents per screen, favouring hard cases (icons, repeated labels, small targets). */
export async function intentsFor(page: Page, key: string, n = 7): Promise<Intent[]> {
  const targets = (await page.evaluate(() => (window as any).__targets())) as Target[];
  const state = await page.evaluate(() => (window as any).__state);
  const labelCount = new Map<string, number>();
  for (const t of targets) labelCount.set(t.name.replace(/ .*/, ''), (labelCount.get(t.name.replace(/ .*/, '')) ?? 0) + 1);
  const all: Intent[] = [];
  for (const t of targets) {
    const intent = phrase(t.t, state);
    if (!intent) continue;
    const tags: string[] = [t.icon ? 'icon' : 'text'];
    if (t.w * t.h < 1000) tags.push('small');
    if (['add', 'archive', 'star', 'delete', 'refresh', 'expand', 'more', 'edit', 'remove-person'].some((p) => t.t.startsWith(`${p}-`))) tags.push('repeated');
    if (t.tag === 'input' || t.tag === 'select') tags.push('field');
    all.push({ id: `${key}:${t.t}`, intent, target: t.t, box: { x: t.x, y: t.y, w: t.w, h: t.h }, tags, risk: t.risk });
  }
  // deterministic order: hash of id
  const h = (s: string) => [...s].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
  const sorted = all.sort((a, b) => h(a.id) - h(b.id));
  const hard = sorted.filter((i) => i.tags.includes('icon') || i.tags.includes('repeated'));
  const easy = sorted.filter((i) => !hard.includes(i));
  const pick = [...hard.slice(0, Math.ceil(n * 0.6)), ...easy].slice(0, n);
  if (pick.length < n) pick.push(...hard.filter((i) => !pick.includes(i)).slice(0, n - pick.length));
  return pick;
}
