import { readFileSync } from 'node:fs';

const WRITER = 'glm-5.3-flash>kimi-k2.6';
const ARM = 'relay:kimi-k2.6';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
type WriterRun = { writers: Record<string, { n: number; passed: number; usdPerCase: number }> };
type T4Run = { t4: Record<string, { successes: number[]; n: number }> };
type Manifest = { mock: boolean; settings?: Record<string, string>; writers?: string[] };

const failures: string[] = [];

const writerManifest = readJson<Manifest>('bench/runs/writer-2/manifest.json');
const writer = readJson<WriterRun>('bench/runs/writer-2/summary.json').writers[WRITER];
if (writerManifest.mock) failures.push('writer-2 is a mock run');
if (!writer) failures.push(`writer-2 has no ${WRITER}`);
else {
  if (writer.n < 44) failures.push(`writer-2 ${WRITER}: ${writer.n} cases, need 44`);
  if (writer.passed < 43) failures.push(`writer-2 ${WRITER}: ${writer.passed}/${writer.n}, need 43`);
  if (writer.usdPerCase > 0.0001) failures.push(`writer-2 ${WRITER}: $${writer.usdPerCase.toFixed(6)}/case, limit $0.0001`);
}

const benchManifest = readJson<Manifest>('bench/runs/bench-5/manifest.json');
const arm = readJson<T4Run>('bench/runs/bench-5/summary.json').t4[ARM];
if (benchManifest.mock) failures.push('bench-5 is a mock run');
if (benchManifest.settings?.DO_WRITER !== WRITER) failures.push(`bench-5 ran with DO_WRITER=${benchManifest.settings?.DO_WRITER}, need ${WRITER}`);
if (!arm) failures.push(`bench-5 has no ${ARM}`);
else if (arm.successes.length < 3 || arm.successes.some((s) => s < arm.n)) failures.push(`bench-5 ${ARM}: ${arm.successes.join(', ')} of ${arm.n}, need ${arm.n} in all 3 repeats`);

for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `check-fallback: ${failures.length} failed` : `check-fallback: PASS ${WRITER} (${writer?.passed}/${writer?.n}, $${writer?.usdPerCase.toFixed(6)}/case; bench-5 ${arm?.successes.join(', ')})`);
process.exit(failures.length ? 1 : 0);
