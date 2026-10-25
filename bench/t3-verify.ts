// Test 3: can Clef tell from screenshots whether a click worked?
// For each intent: correct click (label 1), click on empty space (0), click on a different control (0).
// Arms: model x {before+after, after only} x {toast visible, toast hidden}.
import type { ClefModel } from '../src/clef.ts';
import { verify } from '../src/steer.ts';
import { screenshot } from './browser.ts';
import { intentsFor, type Target } from './intents.ts';
import { close, jsonl, open, pool, runDir, type ScreenSpec, specKey, specs, transport } from './lib.ts';

const MODELS = (process.env.DO_MODELS ?? 'clef,clef-flash,clef-omni').split(',') as ClefModel[];
const PER_SCREEN = Number(process.env.DO_T3_PER_SCREEN ?? 4);
const LIMIT = Number(process.env.DO_SCREENS ?? 999);
const CONC = Number(process.env.DO_CONC ?? 32);
const out = runDir('t3');
const t = transport();

// actions whose only visible effect is the toast
const TOAST_ONLY =
  /^(mail-refresh|mail-emptytrash|dash-export|more-|settings-tab-|files-side-|editor-|settings-cancel|chat-emoji|chat-attach|mail-compose|files-sort|files-newfolder|files-upload|chat-send|shop-apply|shop-checkout|page-prev|dash-range|global-search)/;
const NO_EFFECT = /^(settings-name|settings-email|mail-search|shop-coupon|chat-input|global-search|dash-range|settings-language)$/;

type Case = { spec: ScreenSpec; intent: string; target: string; kind: 'correct' | 'noop' | 'wrong'; point: { x: number; y: number }; clicked: string };

const cases: Case[] = [];
for (const base of specs().slice(0, LIMIT)) {
  for (const notoast of [false, true]) {
    const spec = { ...base, notoast };
    const page = await open(spec);
    const targets = (await page.evaluate(() => (window as any).__targets())) as Target[];
    const intents = (await intentsFor(page, specKey(spec), 12))
      .filter((i) => !NO_EFFECT.test(i.target) && !(notoast && TOAST_ONLY.test(i.target)) && !i.target.startsWith(`nav-${spec.screen}`))
      .slice(0, PER_SCREEN);
    // an empty spot: a point at least 12px from every control
    const empty = (() => {
      for (let y = 760; y > 60; y -= 20)
        for (let x = 1240; x > 220; x -= 20)
          if (targets.every((b) => x < b.x - 12 || x > b.x + b.w + 12 || y < b.y - 12 || y > b.y + b.h + 12)) return { x, y };
      return { x: 1200, y: 760 };
    })();
    intents.forEach((it, k) => {
      const others = targets.filter(
        (o) => o.t !== it.target && !o.risk && !NO_EFFECT.test(o.t) && !(notoast && TOAST_ONLY.test(o.t)) && !o.t.startsWith(`nav-${spec.screen}`),
      );
      const wrong = others[(k * 7 + 3) % Math.max(1, others.length)];
      cases.push({
        spec,
        intent: it.intent,
        target: it.target,
        kind: 'correct',
        point: { x: it.box.x + it.box.w / 2, y: it.box.y + it.box.h / 2 },
        clicked: it.target,
      });
      cases.push({ spec, intent: it.intent, target: it.target, kind: 'noop', point: empty, clicked: '(nothing)' });
      if (wrong)
        cases.push({
          spec,
          intent: it.intent,
          target: it.target,
          kind: 'wrong',
          point: { x: wrong.x + wrong.w / 2, y: wrong.y + wrong.h / 2 },
          clicked: wrong.t,
        });
    });
    await page.context().close();
  }
}
console.log(`t3: ${cases.length} cases`);

await pool(cases, CONC, async (c) => {
  const page = await open(c.spec);
  const before = await screenshot(page);
  await page.mouse.click(c.point.x, c.point.y);
  await page.waitForTimeout(150);
  const after = await screenshot(page);
  const clicks = (await page.evaluate(() => (window as any).__state.clicks)) as string[];
  await page.context().close();
  const label = c.kind === 'correct' ? 1 : 0;
  for (const model of MODELS) {
    for (const view of ['before_after', 'after_only'] as const) {
      try {
        const r = await verify(t, model, c.intent, after, view === 'before_after' ? before : undefined);
        jsonl(out, {
          model,
          view,
          toast: !c.spec.notoast,
          kind: c.kind,
          label,
          p: r.p,
          screen: specKey(c.spec),
          intent: c.intent,
          target: c.target,
          clicked: c.clicked,
          registered: clicks.at(-1) ?? null,
          inputTokens: r.inputTokens,
          costUsd: r.costUsd,
          ms: r.ms,
        });
      } catch (e) {
        jsonl(out, {
          model,
          view,
          toast: !c.spec.notoast,
          kind: c.kind,
          label,
          p: null,
          error: String((e as Error).message).slice(0, 300),
          screen: specKey(c.spec),
          intent: c.intent,
        });
      }
    }
  }
});
await close();
console.log(`t3 done -> ${out}.jsonl`);
