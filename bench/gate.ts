import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type ArmSummary = { successMean: number; n: number; usdPerTask: number; medianSecondsPerTask: number };
type Summary = { t4?: Record<string, ArmSummary> };
type Manifest = { run: string; mock: boolean; srcCommit?: string };
type WriterSummary = { n: number; passed: number; accuracy: number; usdPerCase: number };
type WriterRunSummary = { writers: Record<string, WriterSummary> };
type WriterBaseline = { run: string; minCases: number; writers: Record<string, { minAccuracy: number; maxUsdPerCase: number }> };
type Baseline = { run: string; arms: Record<string, { minSuccess: number; maxUsdPerTask: number }>; writer?: WriterBaseline };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' });

function srcUnchangedSince(commit: string | undefined): boolean {
  if (!commit) return false;
  const committedChanges = git(`diff --name-only ${commit} HEAD -- src`).trim();
  const uncommittedChanges = git('status --porcelain -- src').trim();
  return committedChanges === '' && uncommittedChanges === '';
}

const staleOrMock = (manifest: Manifest, srcUnchangedSinceRun: boolean): string[] => [
  ...(manifest.mock ? [`${manifest.run} is a mock run`] : []),
  ...(srcUnchangedSinceRun ? [] : [`${manifest.run} ran on older src (${manifest.srcCommit?.slice(0, 7) ?? 'unknown'}): rerun the bench`]),
];

export function checkRun(baseline: Baseline, summary: Summary, manifest: Manifest, srcUnchangedSinceRun: boolean): string[] {
  const failures = staleOrMock(manifest, srcUnchangedSinceRun);
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

export function checkWriterRun(baseline: WriterBaseline, summary: WriterRunSummary, manifest: Manifest, srcUnchangedSinceRun: boolean): string[] {
  const failures = staleOrMock(manifest, srcUnchangedSinceRun);
  for (const [writer, floor] of Object.entries(baseline.writers)) {
    const got = summary.writers[writer];
    if (!got) {
      failures.push(`writer ${writer}: missing from ${manifest.run}`);
      continue;
    }
    if (got.n < baseline.minCases) failures.push(`writer ${writer}: ${got.n} cases, need ${baseline.minCases}`);
    if (got.accuracy < floor.minAccuracy) failures.push(`writer ${writer}: accuracy ${got.passed}/${got.n} below ${floor.minAccuracy}`);
    if (got.usdPerCase > floor.maxUsdPerCase) failures.push(`writer ${writer}: $${got.usdPerCase.toFixed(6)}/case above $${floor.maxUsdPerCase}`);
  }
  return failures;
}

if (import.meta.main) {
  const baseline = readJson<Baseline>('bench/baseline.json');
  const dir = `bench/runs/${baseline.run}`;
  const manifest = readJson<Manifest>(`${dir}/manifest.json`);
  const failures = checkRun(baseline, readJson<Summary>(`${dir}/summary.json`), manifest, srcUnchangedSince(manifest.srcCommit));
  if (baseline.writer) {
    const writerDir = `bench/runs/${baseline.writer.run}`;
    const writerManifest = readJson<Manifest>(`${writerDir}/manifest.json`);
    failures.push(
      ...checkWriterRun(baseline.writer, readJson<WriterRunSummary>(`${writerDir}/summary.json`), writerManifest, srcUnchangedSince(writerManifest.srcCommit)),
    );
  }
  for (const failure of failures) console.log(`FAIL ${failure}`);
  const runs = [baseline.run, baseline.writer?.run].filter(Boolean).join(' + ');
  console.log(failures.length ? `gate: ${failures.length} failed` : `gate: PASS ${runs}`);
  process.exit(failures.length ? 1 : 0);
}
