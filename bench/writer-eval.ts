import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Effect } from 'effect';
import { type WriterPrompt, writerFromSpec } from '../src/writer.ts';
import { MOCK, pool, transport } from './lib.ts';
import { WRITER_CASES, type WriterCase } from './writer-cases.ts';

export interface CaseResult {
  writer: string;
  case: string;
  kind: WriterCase['kind'];
  passed: boolean;
  fieldsPassed: Record<string, boolean>;
  values: Record<string, string | null>;
  fellBack?: readonly string[];
  costUsd: number;
  ms: number;
  error?: string;
}

export interface WriterSummary {
  n: number;
  passed: number;
  accuracy: number;
  byKind: Record<string, { n: number; passed: number }>;
  usdPerCase: number;
  medianMs: number;
  errors: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] as number) : 0;
};

export function scoreCase(c: WriterCase, values: Record<string, string | null>): { passed: boolean; fieldsPassed: Record<string, boolean> } {
  const fieldsPassed = Object.fromEntries(Object.entries(c.checks).map(([key, check]) => [key, check(values[key] ?? null)]));
  return { passed: Object.values(fieldsPassed).every(Boolean), fieldsPassed };
}

export function summarize(results: CaseResult[]): Record<string, WriterSummary> {
  const byWriter = new Map<string, CaseResult[]>();
  for (const r of results) byWriter.set(r.writer, [...(byWriter.get(r.writer) ?? []), r]);
  return Object.fromEntries(
    [...byWriter].map(([writer, rs]) => {
      const byKind: Record<string, { n: number; passed: number }> = {};
      for (const r of rs) {
        const k = (byKind[r.kind] ??= { n: 0, passed: 0 });
        k.n++;
        if (r.passed) k.passed++;
      }
      const passed = rs.filter((r) => r.passed).length;
      return [
        writer,
        {
          n: rs.length,
          passed,
          accuracy: passed / rs.length,
          byKind,
          usdPerCase: rs.reduce((a, r) => a + r.costUsd, 0) / rs.length,
          medianMs: median(rs.map((r) => r.ms)),
          errors: rs.filter((r) => r.error).length,
        },
      ];
    }),
  );
}

export function reportTable(summary: Record<string, WriterSummary>): string {
  const kinds = ['normalize', 'combine', 'compose', 'extract', 'abstain'];
  const rows = Object.entries(summary).sort(([, a], [, b]) => b.accuracy - a.accuracy || a.usdPerCase - b.usdPerCase);
  return [
    `| writer | accuracy | ${kinds.join(' | ')} | $/case | median ms | errors |`,
    `|---|---|${kinds.map(() => '---').join('|')}|---|---|---|`,
    ...rows.map(
      ([w, s]) =>
        `| ${w} | **${s.passed}/${s.n}** | ${kinds.map((k) => (s.byKind[k] ? `${s.byKind[k].passed}/${s.byKind[k].n}` : '-')).join(' | ')} | $${s.usdPerCase.toFixed(6)} | ${Math.round(s.medianMs)} | ${s.errors} |`,
    ),
  ].join('\n');
}

if (import.meta.main) {
  const run = process.env.DO_RUN ?? 'writer-dev';
  const writers = (process.env.DO_WRITERS ?? 'kimi-k2.6,glm-5.3-flash').split(',');
  const prompt = (process.env.DO_WRITER_PROMPT ?? 'plain') as WriterPrompt;
  const t = transport();
  const perWriter = Number(process.env.DO_WRITER_CONCURRENCY ?? 4);
  const results: CaseResult[] = [];
  const evaluate = async ({ writer, c }: { writer: string; c: WriterCase }) => {
    const write = writerFromSpec(t, writer, { prompt });
    const outcome = await Effect.runPromise(Effect.result(write({ task: c.task, fields: c.fields })));
    const values = outcome._tag === 'Success' ? { ...outcome.success.values } : {};
    const { passed, fieldsPassed } = scoreCase(c, values);
    results.push({
      writer,
      case: c.id,
      kind: c.kind,
      passed: outcome._tag === 'Success' && passed,
      fieldsPassed,
      values,
      ...(outcome._tag === 'Success' && outcome.success.fellBack.length ? { fellBack: outcome.success.fellBack } : {}),
      costUsd: outcome._tag === 'Success' ? outcome.success.costUsd : 0,
      ms: outcome._tag === 'Success' ? outcome.success.ms : 0,
      ...(outcome._tag === 'Failure' ? { error: String((outcome.failure as { reason?: string }).reason ?? outcome.failure).slice(0, 200) } : {}),
    });
  };
  await Promise.all(writers.map((writer) => pool(WRITER_CASES.map((c) => ({ writer, c })), perWriter, evaluate)));
  for (let pass = 0; pass < 2; pass++) {
    const errored = results.filter((r) => r.error);
    if (!errored.length) break;
    for (const r of errored) results.splice(results.indexOf(r), 1);
    await pool(
      errored.map((r) => ({ writer: r.writer, c: WRITER_CASES.find((c) => c.id === r.case) as WriterCase })),
      1,
      evaluate,
    );
  }
  const dir = `bench/runs/${run}${MOCK ? '-mock' : ''}`;
  mkdirSync(dir, { recursive: true });
  results.sort((a, b) => a.writer.localeCompare(b.writer) || a.case.localeCompare(b.case));
  writeFileSync(`${dir}/writer.jsonl`, `${results.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const summary = summarize(results);
  const spendUsd = results.reduce((a, r) => a + r.costUsd, 0);
  writeFileSync(`${dir}/summary.json`, `${JSON.stringify({ writers: summary, spendUsd }, null, 2)}\n`);
  const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();
  writeFileSync(
    `${dir}/manifest.json`,
    `${JSON.stringify({ run, mock: MOCK, commit: git('rev-parse HEAD'), srcCommit: git('log -1 --format=%H -- src'), dirty: git('status --porcelain -- src bench') !== '', writers, prompt, cases: WRITER_CASES.length }, null, 2)}\n`,
  );
  const table = reportTable(summary);
  writeFileSync(`${dir}/REPORT.md`, `# Writer eval: ${run}\n\n${WRITER_CASES.length} cases, prompt \`${prompt}\`. Spend $${spendUsd.toFixed(4)}.\n\n${table}\n`);
  console.log(table);
  console.log(`spend $${spendUsd.toFixed(4)} -> ${dir}`);
}
