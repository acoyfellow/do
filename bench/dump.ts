// Write example images for eyeballing: plain, marked, grid hop 1 for a few screens.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { axCandidates, cdp, gridShot, marked, screenshot } from '../src/perceive.ts';
import { close, open, ROOT, specKey, specs } from './lib.ts';

const dir = join(ROOT, 'docs', 'examples');
mkdirSync(dir, { recursive: true });
const save = (name: string, url: string) => writeFileSync(join(dir, name), Buffer.from(url.split(',')[1] as string, 'base64'));
const want = (process.env.SCREENS ?? 'mail,dashboard,editor').split(',');
for (const s of specs().filter((x, i, a) => want.includes(x.screen) && a.findIndex((y) => y.screen === x.screen) === i)) {
  const page = await open(s);
  const session = await cdp(page);
  const cands = await axCandidates(page, session);
  const k = specKey(s);
  save(`${k}-plain.jpg`, await screenshot(page));
  save(`${k}-marks.jpg`, await marked(page, cands));
  save(`${k}-grid1.jpg`, (await gridShot(page, { x: 0, y: 0, w: 1280, h: 800 })).img);
  save(`${k}-grid2.jpg`, (await gridShot(page, { x: 160, y: 50, w: 640, h: 400 })).img);
  await page.context().close();
}
await close();
console.log(`wrote examples to ${dir}`);
