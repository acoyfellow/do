// Sanity: every screen renders, AX candidates map 1:1 onto ground-truth targets.
import { axCandidates, cdp, groundTruthId } from '../src/perceive.ts';
import { close, open, specKey, specs } from './lib.ts';

let bad = 0;
for (const s of specs()) {
  const page = await open(s);
  const session = await cdp(page);
  const cands = await axCandidates(page, session);
  const truth = (await page.evaluate(() => (window as any).__targets())) as { t: string }[];
  const mapped = new Set<string>();
  for (const c of cands) {
    const t = await groundTruthId(session, c.backendNodeId);
    if (t) mapped.add(t);
  }
  const missing = truth.filter((t) => !mapped.has(t.t)).map((t) => t.t);
  if (missing.length) bad++;
  console.log(`${specKey(s).padEnd(26)} ax=${String(cands.length).padStart(3)} truth=${String(truth.length).padStart(3)} missing=${missing.join(',') || '-'}`);
  await page.context().close();
}
await close();
console.log(bad ? `FAIL ${bad} screens have targets the AX tree misses` : 'ok all targets reachable through AX');
