import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type ArmSummary = { successMean: number; n: number; usdPerTask: number; medianSecondsPerTask: number };
type Summary = { t4?: Record<string, ArmSummary> };
type Manifest = { run: string; mock: boolean; srcCommit?: string };
type Baseline = { run: string; arms: Record<string, { minSuccess: number; maxUsdPerTask: number }> };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' });

function srcUnchangedSince(commit: string | undefined): boolean {
  if (!commit) return false;
  const committedChanges = git(`diff --name-only ${commit} HEAD -- src`).trim();
  const uncommittedChanges = git('status --porcelain -- src').trim();
  return committedChanges === '' && uncommittedChanges === '';
}

export function checkRun(baseline: Baseline, summary: Summary, manifest: Manifest, srcUnchangedSinceRun: boolean): string[] {
  const failures: string[] = [];
  if (manifest.mock) failures.push(`${manifest.run} is a mock run`);
  if (!srcUnchangedSinceRun) failures.push(`${manifest.run} ran on older src (${manifest.srcCommit?.slice(0, 7) ?? 'unknown'}): rerun the bench`);
  for (const [arm, floor] of Object.entries(baseline.arms)) {
    const got = summary.t4?.[arm];
    if (!got) {
      failures.push(`${arm}: missing from ${manifest.run}`);
      continue;
    }
    if (got.successMean < floor.minSuccess) failures.push(`${arm}: success ${got.successMean}/${got.n} below ${floor.minSuccess}`);
    if (got.usdPerTask > floor.maxUsdPerTask) failures.push(`${arm}: $${got.usdPerTask.toFixed(5)}/task above $${floor.maxUsdPerTask}`);
  }
  return failures;
}

if (import.meta.main) {
  const baseline = readJson<Baseline>('bench/baseline.json');
  const dir = `bench/runs/${baseline.run}`;
  const manifest = readJson<Manifest>(`${dir}/manifest.json`);
  const failures = checkRun(baseline, readJson<Summary>(`${dir}/summary.json`), manifest, srcUnchangedSince(manifest.srcCommit));
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(failures.length ? `gate: ${failures.length} failed` : `gate: PASS ${baseline.run}`);
  process.exit(failures.length ? 1 : 0);
}
