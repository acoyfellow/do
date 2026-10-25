import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { type FieldInvolvement, fallbackWriter, type Writer, type WriterRequest } from '../src/writer.ts';

const fields = [
  { key: 'search', label: 'Search', role: 'searchbox' },
  { key: 'coupon', label: 'Coupon code', role: 'textbox' },
];
const request: WriterRequest = { task: 'use code SAVE plus ten', fields };

const fixedWriter =
  (values: Record<string, string | null>, costUsd: number, calls: WriterRequest[] = []): Writer =>
  (req) => {
    calls.push(req);
    return Effect.succeed({
      values: Object.fromEntries(req.fields.map((f) => [f.key, values[f.key] ?? null])),
      costUsd,
      ms: 1,
      inputTokens: 1,
      outputTokens: 1,
    });
  };
const involves =
  (keys: string[], costUsd = 0.00001): FieldInvolvement =>
  () =>
    Effect.succeed({ keys: new Set(keys), costUsd, ms: 1 });

test('keeps the primary answer when nothing is blank and never asks the backup', async () => {
  const backupCalls: WriterRequest[] = [];
  const res = await Effect.runPromise(
    fallbackWriter(fixedWriter({ search: 'x', coupon: 'SAVE10' }, 1), fixedWriter({}, 9, backupCalls), involves(['coupon']))(request),
  );
  expect(res.values).toEqual({ search: 'x', coupon: 'SAVE10' });
  expect(res.fellBack).toEqual([]);
  expect(backupCalls).toHaveLength(0);
});

test('asks the backup only for blank fields the task involves', async () => {
  const backupCalls: WriterRequest[] = [];
  const res = await Effect.runPromise(
    fallbackWriter(fixedWriter({}, 1), fixedWriter({ search: 'leak', coupon: 'SAVE10' }, 2, backupCalls), involves(['coupon']))(request),
  );
  expect(res.values).toEqual({ search: null, coupon: 'SAVE10' });
  expect(res.fellBack).toEqual(['coupon']);
  expect(backupCalls[0]?.fields.map((f) => f.key)).toEqual(['coupon']);
});

test('a blank field the task does not involve stays blank, and the backup is never called', async () => {
  const backupCalls: WriterRequest[] = [];
  const res = await Effect.runPromise(
    fallbackWriter(fixedWriter({ coupon: 'SAVE10' }, 1), fixedWriter({ search: 'leak' }, 2, backupCalls), involves([]))(request),
  );
  expect(res.values.search).toBeNull();
  expect(backupCalls).toHaveLength(0);
});

test('cost includes the primary, the involvement check and the backup', async () => {
  const res = await Effect.runPromise(fallbackWriter(fixedWriter({}, 1), fixedWriter({ coupon: 'SAVE10' }, 2), involves(['coupon'], 0.5))(request));
  expect(res.costUsd).toBeCloseTo(3.5);
});
