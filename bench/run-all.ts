import { execSync, spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { CLEF_MODELS } from '../src/clef.ts';
import { LLM_MODELS } from '../src/llm.ts';

const id = process.env.DO_RUN ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const mock = process.env.DO_MOCK === '1';
const totalInFlight = Number(process.env.DO_CONCURRENCY ?? 160);
const env: Record<string, string | undefined> = { ...process.env, DO_RUN: id };
const startedAt = performance.now();
const timings: Record<string, number> = {};

const runSync = (file: string) => {
  console.log(`\n=== ${file}`);
  const t0 = performance.now();
  const r = spawnSync('bun', [file], { stdio: 'inherit', env });
  timings[file] = Math.round(performance.now() - t0);
  if (r.status !== 0) {
    console.log(`${file} exited ${r.status}`);
    process.exit(r.status ?? 1);
  }
};

const runPrefixed = (file: string) =>
  new Promise<number>((done) => {
    const label = file.replace(/^evals\/|\.ts$/g, '');
    const t0 = performance.now();
    const child = spawn('bun', [file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const relay = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) if (line) console.log(`[${label}] ${line}`);
    };
    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
    child.on('close', (code) => {
      timings[file] = Math.round(performance.now() - t0);
      console.log(`[${label}] exited ${code} after ${(timings[file] / 1000).toFixed(1)}s`);
      done(code ?? 1);
    });
  });

if (!mock) runSync('evals/probe.ts');
const tests = (process.env.DO_ONLY_TESTS ?? 't1-grounding,t3-verify,t5-safety,t4-e2e').split(',').map((t) => `evals/${t}.ts`);
env.DO_CONCURRENCY = String(Math.max(1, Math.floor(totalInFlight / tests.length)));
const codes = await Promise.all(tests.map(runPrefixed));
if (codes.some((code) => code !== 0)) {
  console.log(`tests failed: ${tests.filter((_, i) => codes[i] !== 0).join(', ')}`);
  process.exit(1);
}
runSync('evals/report.ts');
const dir = `evals/runs/${id}${mock ? '-mock' : ''}`;
const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();
const settings = Object.fromEntries(
  Object.entries(env)
    .filter(([key]) => key.startsWith('DO_') && !['DO_RUN', 'DO_CONCURRENCY', 'DO_RECORD'].includes(key))
    .sort(),
);
const manifest = {
  run: id,
  commit: git('rev-parse HEAD'),
  dirty: git('status --porcelain -- src evals/*.ts evals/fixtures package.json bun.lock') !== '',
  mock,
  settings,
  clefModels: Object.fromEntries(Object.entries(CLEF_MODELS).map(([name, model]) => [name, model.workersAiId])),
  llmModels: Object.fromEntries(Object.entries(LLM_MODELS).map(([name, model]) => [name, model.workersAiId])),
  fixture: 'evals/fixtures/app.html',
};
writeFileSync(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  `${dir}/timing.json`,
  `${JSON.stringify({ run: id, wallMs: Math.round(performance.now() - startedAt), stepsMs: timings, totalInFlight, perTestInFlight: Number(env.DO_CONCURRENCY) }, null, 2)}\n`,
);
console.log(`\nrun ${id} complete: ${dir}/REPORT.md (wall ${((performance.now() - startedAt) / 60000).toFixed(1)} min)`);
