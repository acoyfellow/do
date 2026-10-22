// Test 5 (static half): does Clef spot planted instructions on screen, and destructive controls?
// The end-to-end half (agents on screens with planted instructions) runs inside t4 as the `inj` tasks.
import type { ClefModel } from '../src/clef.ts';
import { describe } from '../src/perceive.ts';
import { axCandidates, cdp, groundTruthId, screenshot } from './browser.ts';
import { injection, risky } from '../src/steer.ts';
import type { Target } from './intents.ts';
import { close, jsonl, open, pool, runDir, specKey, specs, transport } from './lib.ts';

const MODELS = (process.env.DO_MODELS ?? 'clef,clef-flash,clef-omni').split(',') as ClefModel[];
const LIMIT = Number(process.env.DO_SCREENS ?? 999);
const BENIGN_PER_SCREEN = Number(process.env.DO_T5_BENIGN ?? 8);
const CONC = Number(process.env.DO_CONC ?? 32);
const out = runDir('t5');
const t = transport();

type Job =
  | { kind: 'injection'; screen: string; label: number; shot: string }
  | { kind: 'risky'; screen: string; label: number; shot: string; control: string; target: string };
const jobs: Job[] = [];
for (const base of specs().slice(0, LIMIT)) {
  for (const inj of [false, true]) {
    const spec = { ...base, inj };
    const page = await open(spec);
    const shot = await screenshot(page);
    jobs.push({ kind: 'injection', screen: specKey(spec), label: inj ? 1 : 0, shot });
    if (!inj) {
      const session = await cdp(page);
      const cands = await axCandidates(page, session);
      const truth = new Map(((await page.evaluate(() => (window as any).__targets())) as Target[]).map((x) => [x.t, x]));
      const rows: { control: string; target: string; risk: boolean }[] = [];
      for (const c of cands) {
        const id = await groundTruthId(session, c.backendNodeId);
        const tt = id ? truth.get(id) : undefined;
        if (tt) rows.push({ control: describe(c), target: tt.t, risk: tt.risk });
      }
      const risks = rows.filter((r) => r.risk);
      const benign = rows
        .filter((r) => !r.risk)
        .filter((_, i, a) => i % Math.max(1, Math.floor(a.length / BENIGN_PER_SCREEN)) === 0)
        .slice(0, BENIGN_PER_SCREEN);
      for (const r of [...risks, ...benign])
        jobs.push({ kind: 'risky', screen: specKey(spec), label: r.risk ? 1 : 0, shot, control: r.control, target: r.target });
    }
    await page.context().close();
  }
}
console.log(`t5: ${jobs.length} jobs x ${MODELS.length} models`);
await pool(jobs, CONC, async (j) => {
  for (const model of MODELS) {
    try {
      const r = j.kind === 'injection' ? await injection(t, model, j.shot) : await risky(t, model, j.shot, j.control);
      jsonl(out, {
        kind: j.kind,
        model,
        screen: j.screen,
        label: j.label,
        p: r.p,
        ...(j.kind === 'risky' ? { control: j.control, target: j.target } : {}),
        inputTokens: r.inputTokens,
        costUsd: r.costUsd,
        ms: r.ms,
      });
    } catch (e) {
      jsonl(out, { kind: j.kind, model, screen: j.screen, label: j.label, p: null, error: String((e as Error).message).slice(0, 300) });
    }
  }
});
await close();
console.log(`t5 done -> ${out}.jsonl`);
