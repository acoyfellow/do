import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { llmWriter, parseWriterValues } from '../src/writer.ts';
import { WRITER_CASES } from './writer-cases.ts';
import { type CaseResult, scoreCase, summarize } from './writer-eval.ts';

const fields = [
  { key: 'f0', label: 'Email', role: 'textbox' },
  { key: 'f1', label: 'Search', role: 'searchbox' },
];

test('parses fenced JSON and maps blanks to null', () => {
  expect(parseWriterValues('```json\n{"f0": "a@b.co", "f1": "  "}\n```', fields)).toEqual({ f0: 'a@b.co', f1: null });
});

test('missing JSON means every field is null', () => {
  expect(parseWriterValues('sorry, I cannot help', fields)).toEqual({ f0: null, f1: null });
});

test('llmWriter sends the task and field keys and prices the reply', async () => {
  let sent = '';
  const transport = async (_id: string, body: unknown) => {
    sent = JSON.stringify(body);
    return { status: 200, json: { result: { response: '{"f0":"jordan@cloudflare.com","f1":null}', usage: { prompt_tokens: 100, completion_tokens: 10 } } }, text: '' };
  };
  const res = await Effect.runPromise(llmWriter(transport, 'glm-5.3-flash')({ task: 'jordan at cloudflare dot com', fields }));
  expect(sent).toContain('f0: textbox');
  expect(res.values).toEqual({ f0: 'jordan@cloudflare.com', f1: null });
  expect(res.costUsd).toBeCloseTo((100 * 0.15 + 10 * 0.5) / 1e6);
});

test('there are at least 40 cases with unique ids, and every check targets a listed field', () => {
  expect(WRITER_CASES.length).toBeGreaterThanOrEqual(40);
  expect(new Set(WRITER_CASES.map((c) => c.id)).size).toBe(WRITER_CASES.length);
  for (const c of WRITER_CASES) for (const key of Object.keys(c.checks)) expect(c.fields.map((f) => f.key)).toContain(key);
});

test('an all-null writer only passes abstain-style checks', () => {
  const passing = WRITER_CASES.filter((c) => scoreCase(c, {}).passed).map((c) => c.kind);
  expect(passing.every((k) => k === 'abstain')).toBe(true);
});

test('the reference answers pass their own checks', () => {
  const reference: Record<string, Record<string, string | null>> = {
    'email-at-dot': { f0: 'jordan@cloudflare.com', f1: null },
    'name-initial': { f0: 'Jordan C.', f1: null },
    'thanks-one-word': { f0: 'Thanks!' },
    'coupon-spelled': { f0: 'SAVE10' },
    'abstain-injection': { f1: null },
  };
  for (const [id, values] of Object.entries(reference)) {
    const c = WRITER_CASES.find((x) => x.id === id);
    expect(c && scoreCase(c, values).passed).toBe(true);
  }
});

test('summarize computes accuracy and per-kind counts', () => {
  const row = (writer: string, passed: boolean, kind: CaseResult['kind']): CaseResult => ({ writer, case: 'x', kind, passed, fieldsPassed: {}, values: {}, costUsd: 0.001, ms: 10 });
  const s = summarize([row('a', true, 'compose'), row('a', false, 'compose'), row('b', true, 'normalize')]);
  expect(s.a).toMatchObject({ n: 2, passed: 1, accuracy: 0.5, byKind: { compose: { n: 2, passed: 1 } } });
  expect(s.b?.accuracy).toBe(1);
});
