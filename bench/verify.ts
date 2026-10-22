import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.ts';

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });
const sh = (command: string, cwd = ROOT) => execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

const README_SECTIONS = ['## Results', '## Reproduce', '## How it works', '## What this does not show'];
const readme = existsSync(join(ROOT, 'README.md')) ? readFileSync(join(ROOT, 'README.md'), 'utf8') : '';
const missingSections = README_SECTIONS.filter((section) => !readme.includes(section));
record('README has the required sections', readme.length > 0 && missingSections.length === 0, missingSections.join(', ') || 'all present');
record('LICENSE is MIT', existsSync(join(ROOT, 'LICENSE')) && readFileSync(join(ROOT, 'LICENSE'), 'utf8').includes('MIT License'));

const SECRET_PATTERNS: [string, RegExp][] = [
  ['Cloudflare token', /\b(cfut|cfat|cfk)_[A-Za-z0-9]{20,}/],
  ['bearer token', /Bearer [A-Za-z0-9._-]{30,}/],
  ['webhook secret', /whsec_[A-Za-z0-9+/]{20,}/],
  ['32-hex id', /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['home path', new RegExp(['', 'Users', '[a-z]+', ''].join('[/]'))],
  ['personal email', /[A-Za-z0-9._%+-]+@(gmail|cloudflare)\.com/],
];
const ALLOWED_EMAILS = new Set(['jordan@example.com']);
const history = sh('git log HEAD -p --no-color');
const historyHits = SECRET_PATTERNS.flatMap(([label, pattern]) => {
  const global = new RegExp(pattern.source, `${pattern.flags}g`);
  return [...history.matchAll(global)]
    .map((match) => `${label}: ${match[0].slice(0, 12)}…`)
    .filter((hit) => ![...ALLOWED_EMAILS].some((email) => hit.includes(email)));
});
const authors = sh('git log HEAD --format=%ae%n%ce').split('\n').filter(Boolean);
const workEmails = [...new Set(authors.filter((email) => !email.endsWith('@users.noreply.github.com')))];
record('history has no secrets, ids, home paths or personal emails in content', historyHits.length === 0, historyHits.slice(0, 5).join('; ') || 'clean');
record('commit authors use a noreply address', workEmails.length === 0, workEmails.join(', ') || 'noreply only');
const remoteNotes = sh('git ls-remote origin refs/notes/*').trim();
record('no git notes refs on origin', remoteNotes === '', remoteNotes || 'none');
const remoteHead = sh('git ls-remote origin refs/heads/main').split(/\s/)[0];
const localHead = sh('git rev-parse HEAD').trim();
record('origin main is this clean history', remoteHead === localHead, `origin ${remoteHead?.slice(0, 7)} local ${localHead.slice(0, 7)}`);

const REFERENCE = 'reference-mock';
const repro = join(ROOT, '.repro', 'clone');
rmSync(repro, { recursive: true, force: true });
sh(`git clone --quiet --no-local ${ROOT} ${repro}`);
const install = spawnSync('bun', ['install', '--frozen-lockfile'], { cwd: repro, encoding: 'utf8' });
const run = install.status === 0 ? spawnSync('bun', ['run', 'bench:mock'], { cwd: repro, encoding: 'utf8' }) : install;
const compare =
  run.status === 0 ? spawnSync('python3', ['evals/compare-runs.py', REFERENCE, REFERENCE, '--other-root', repro], { cwd: ROOT, encoding: 'utf8' }) : run;
record(
  'fresh clone reproduces the committed mock reference exactly',
  compare.status === 0,
  (compare.stdout || compare.stderr || '').trim().split('\n').slice(-5).join(' | '),
);

const latestName = readme.match(/<!-- bench-run: ([\w.-]+) -->/)?.[1];
const latest = latestName ? join(ROOT, 'evals', 'runs', latestName) : '';
const summary = latest && existsSync(join(latest, 'summary.json')) ? JSON.parse(readFileSync(join(latest, 'summary.json'), 'utf8')) : null;
const manifest = latest && existsSync(join(latest, 'manifest.json')) ? JSON.parse(readFileSync(join(latest, 'manifest.json'), 'utf8')) : null;
record('README names a committed bench run with summary and manifest', Boolean(summary && manifest), latestName ?? 'no <!-- bench-run: … --> marker');
if (summary && manifest) {
  const t4 = summary.t4 as Record<
    string,
    { repeats: number; unusableStepRate: number; successMean: number; n: number; usdPerTask: number; medianSecondsPerTask: number }
  >;
  const arms = Object.entries(t4);
  record(
    'bench run is real, clean and committed code',
    manifest.mock === false && manifest.dirty === false,
    `mock=${manifest.mock} dirty=${manifest.dirty} commit=${manifest.commit}`,
  );
  const manifestCommitInHistory = spawnSync('git', ['merge-base', '--is-ancestor', manifest.commit, 'HEAD'], { cwd: ROOT }).status === 0;
  record('bench manifest commit is in the published history', manifestCommitInHistory, manifest.commit);
  record(
    'every arm has 3 or more repeats',
    arms.length > 0 && arms.every(([, arm]) => arm.repeats >= 3),
    arms.map(([name, arm]) => `${name}:${arm.repeats}`).join(' '),
  );
  const vision = arms.filter(([name]) => name.startsWith('vision:'));
  record(
    'vision arms have under 10% unusable steps',
    vision.length > 0 && vision.every(([, arm]) => arm.unusableStepRate < 0.1),
    vision.map(([name, arm]) => `${name}:${(arm.unusableStepRate * 100).toFixed(1)}%`).join(' '),
  );
  const table = readme.match(/<!-- results:start -->([\s\S]*?)<!-- results:end -->/)?.[1] ?? '';
  const mismatches = arms.filter(([name, arm]) => {
    const row = table.split('\n').find((line) => line.includes(`\`${name}\``));
    if (!row) return true;
    return (
      !row.includes(`${arm.successMean.toFixed(1)}/${arm.n}`) ||
      !row.includes(`$${arm.usdPerTask.toFixed(4)}`) ||
      !row.includes(`${arm.medianSecondsPerTask.toFixed(1)} s`)
    );
  });
  record(
    'README results table matches summary.json',
    table.length > 0 && mismatches.length === 0,
    mismatches.map(([name]) => name).join(', ') || 'all rows match',
  );
}

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
const failed = checks.filter((check) => !check.pass).length;
console.log(failed ? `bench:verify: ${failed} failed` : 'bench:verify: all checks passed');
process.exit(failed ? 1 : 0);
