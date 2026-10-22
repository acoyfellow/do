// Test 1: grounding. Given an intent, does the method put the click on the right control?
// Arms: Clef x {ax_text, ax_image, marks, hybrid, grid} x {clef, clef-flash, clef-omni}
//       baselines: kimi-k2.6 and qwen3.8-27b answer pixel coordinates; kimi also picks a mark.
import { Effect } from 'effect';
import type { ClefModel } from '../src/clef.ts';
import { chat, coordinateInstruction, firstJson, type LlmModel, screenshotFrame, toViewportPoint } from '../src/llm.ts';
import { axCandidates, type Candidate, cdp, groundTruthId, inside, marked, playwrightScreen, screenshot, screenshotAt } from '../src/perceive.ts';
import { type Method, pickTarget } from '../src/steer.ts';
import { type Intent, intentsFor } from './intents.ts';
import { close, jsonl, MOCK, open, pool, runDir, specKey, specs, THINKING, transport } from './lib.ts';

const MODELS = (process.env.DO_MODELS ?? 'clef,clef-flash,clef-omni').split(',') as ClefModel[];
const METHODS = (process.env.DO_METHODS ?? 'ax_text,ax_image,marks,hybrid,grid').split(',') as Method[];
const BASELINES = (process.env.DO_BASELINES ?? 'kimi-k2.6:xy,qwen3.8-27b:xy,kimi-k2.6:marks').split(',').filter(Boolean);
const PER_SCREEN = Number(process.env.DO_PER_SCREEN ?? 7);
const LIMIT = Number(process.env.DO_SCREENS ?? 999);
const CONC = Number(process.env.DO_CONC ?? 32);
const SCREEN_CONC = Number(process.env.DO_SCREEN_CONC ?? 8);

const out = runDir('t1');
const t = transport();

export interface T1Record {
  arm: string;
  model: string;
  method: string;
  screen: string;
  intent: string;
  target: string;
  tags: string[];
  correct: boolean;
  chosenTarget: string | null;
  p: number | null;
  pTrue: number | null;
  margin: number | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  error?: string;
}

const PAD = 3; // px of slack around a target for point-based arms

await pool(specs().slice(0, LIMIT), SCREEN_CONC, async (spec) => {
  const key = specKey(spec);
  const page = await open(spec);
  const session = await cdp(page);
  const cands = await axCandidates(page, session);
  const truthOf = new Map<string, string | null>();
  for (const c of cands) truthOf.set(c.id, await groundTruthId(session, c.backendNodeId));
  const shot = await screenshot(page);
  const marks = await marked(page, cands);
  const intents = await intentsFor(page, key, PER_SCREEN);

  type Job = { kind: 'clef'; model: ClefModel; method: Method; it: Intent } | { kind: 'llm'; model: LlmModel; mode: 'xy' | 'marks'; it: Intent };
  const jobs: Job[] = [];
  for (const it of intents) {
    for (const model of MODELS) for (const method of METHODS) jobs.push({ kind: 'clef', model, method, it });
    for (const b of BASELINES) {
      const [model, mode] = b.split(':') as [LlmModel, 'xy' | 'marks'];
      jobs.push({ kind: 'llm', model, mode, it });
    }
  }

  const serial = jobs.filter((j) => j.kind === 'clef' && j.method === 'grid');
  const parallel = jobs.filter((j) => !serial.includes(j));
  const record = (j: Job, r: Partial<T1Record>) => {
    const rec: T1Record = {
      arm: j.kind === 'clef' ? `${j.model}/${j.method}` : `${j.model}/${j.mode}`,
      model: j.model,
      method: j.kind === 'clef' ? j.method : j.mode,
      screen: key,
      intent: j.it.intent,
      target: j.it.target,
      tags: j.it.tags,
      correct: false,
      chosenTarget: null,
      p: null,
      pTrue: null,
      margin: null,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      ms: 0,
      ...r,
    };
    jsonl(out, rec);
    return rec;
  };
  const optionTruth = (method: string, opt: string, list: Candidate[]) =>
    method === 'ax_text' || method === 'ax_image' ? truthOf.get(opt) : truthOf.get(list[Number(opt) - 1]?.id ?? '');

  const doJob = async (j: Job) => {
    try {
      if (j.kind === 'clef') {
        // ax/marks arms reuse the precomputed shot; marks/hybrid re-draw marks (cheap) inside pickTarget
        const gridPage = j.method === 'grid' ? await open(spec) : undefined;
        const pick = await pickTarget(t, j.model, j.method, playwrightScreen(gridPage ?? page), j.it.intent, cands, shot, marks).finally(() =>
          gridPage?.context().close(),
        );
        let correct: boolean;
        let chosenTarget: string | null = null;
        let pTrue: number | null = null;
        let margin: number | null = null;
        if (j.method === 'grid') {
          correct = inside(pick.point, j.it.box, PAD);
        } else {
          const c = cands.find((x) => x.id === pick.choice);
          chosenTarget = c ? (truthOf.get(c.id) ?? null) : null;
          correct = chosenTarget === j.it.target;
          if (pick.probabilities) {
            pTrue = Object.entries(pick.probabilities)
              .filter(([opt]) => optionTruth(j.method, opt, cands) === j.it.target)
              .reduce((a, [, v]) => a + v, 0);
            const sorted = Object.values(pick.probabilities).sort((a, b) => b - a);
            margin = (sorted[0] ?? 0) - (sorted[1] ?? 0);
          }
        }
        return record(j, {
          correct,
          chosenTarget,
          p: pick.p,
          pTrue,
          margin,
          calls: pick.calls,
          inputTokens: pick.inputTokens,
          costUsd: pick.costUsd,
          ms: pick.ms,
        });
      }
      const frame = screenshotFrame(j.model);
      const image = j.mode === 'xy' ? await screenshotAt(page, frame.width, frame.height) : marks;
      const prompt =
        j.mode === 'xy'
          ? `You are operating a computer. Task: "${j.it.intent}". Reply with only JSON {"x": <int>, "y": <int>} giving the point to click. ${coordinateInstruction(j.model)}`
          : `You are operating a computer. Clickable controls in the screenshot have pink outlines with numbers. Task: "${j.it.intent}". Reply with only JSON {"mark": <int>} for the box to click.`;
      const r = await Effect.runPromise(
        chat(
          t,
          j.model,
          [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: image } },
                { type: 'text', text: prompt },
              ],
            },
          ],
          { maxTokens: 1500, thinking: THINKING },
        ),
      );
      const js = firstJson(r.text) ?? {};
      let correct = false;
      let chosenTarget: string | null = null;
      if (j.mode === 'xy') {
        const pt = toViewportPoint(j.model, { width: 1280, height: 800 }, js.x, js.y);
        correct = Number.isFinite(pt.x) && inside(pt, j.it.box, PAD);
        if (MOCK) correct = false;
      } else {
        const c = cands[Number(js.mark) - 1];
        chosenTarget = c ? (truthOf.get(c.id) ?? null) : null;
        correct = chosenTarget === j.it.target;
      }
      return record(j, {
        correct,
        chosenTarget,
        calls: 1,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        ms: r.ms,
        ...(Object.keys(js).length ? {} : { error: `unparsed: ${r.text.slice(0, 120)}` }),
      });
    } catch (e) {
      return record(j, { error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  };

  // grid draws overlays on a page, so each grid job gets its own copy of the screen
  await pool([...parallel, ...serial], CONC, doJob);
  console.log(`t1 ${key}: ${intents.length} intents x ${jobs.length / Math.max(1, intents.length)} arms`);
  await page.context().close();
});
await close();
console.log(`t1 done -> ${out}.jsonl`);
