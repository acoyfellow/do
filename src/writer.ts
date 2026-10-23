import { Effect } from 'effect';
import { type ClairicError, extract } from './clairic.ts';
import type { Transport } from './clef.ts';
import { chat, firstJson, type LlmError, type LlmModel } from './llm.ts';

export interface WriterField {
  readonly key: string;
  readonly label: string;
  readonly role: string;
}

export interface WriterRequest {
  readonly task: string;
  readonly fields: readonly WriterField[];
}

export interface WriterResult {
  readonly values: Readonly<Record<string, string | null>>;
  readonly costUsd: number;
  readonly ms: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type Writer = (request: WriterRequest) => Effect.Effect<WriterResult, LlmError>;

export const WRITER_PROMPTS = {
  plain:
    'You write the exact text to type into form fields so a user task gets done. Reply with only a JSON object mapping each field key to the final text, or null when the task does not involve that field.',
  normalize:
    'You write the exact text to type into form fields so a user task gets done. Reply with only a JSON object mapping each field key to the final text, or null when the task does not involve that field. Normalize values to how they should appear: an email address, not a spelled-out description; a composed message, not a description of one.',
} as const;
export type WriterPrompt = keyof typeof WRITER_PROMPTS;

const fieldLines = (fields: readonly WriterField[]) => fields.map((f) => `${f.key}: ${f.role} "${f.label}"`).join('\n');

export function parseWriterValues(text: string, fields: readonly WriterField[]): Record<string, string | null> {
  const answers = (firstJson(text) ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    fields.map((f) => {
      const value = answers[f.key];
      return [f.key, typeof value === 'string' && value.trim() ? value : null];
    }),
  );
}

export function llmWriter(transport: Transport, model: LlmModel, opts: { thinking?: boolean; prompt?: WriterPrompt } = {}): Writer {
  return (request) =>
    chat(
      transport,
      model,
      [
        { role: 'system', content: WRITER_PROMPTS[opts.prompt ?? 'plain'] },
        { role: 'user', content: `Task: ${request.task}\nFields on screen:\n${fieldLines(request.fields)}` },
      ],
      { maxTokens: 400, thinking: opts.thinking ?? false },
    ).pipe(
      Effect.map((res) => ({
        values: parseWriterValues(res.text, request.fields),
        costUsd: res.costUsd,
        ms: res.ms,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      })),
    );
}

export interface Involvement {
  readonly keys: ReadonlySet<string>;
  readonly costUsd: number;
  readonly ms: number;
}
export type FieldInvolvement = (request: WriterRequest) => Effect.Effect<Involvement, LlmError | ClairicError>;

export function clairicInvolvement(transport: Transport, maxPNull = 0.5): FieldInvolvement {
  return (request) =>
    extract(
      transport,
      `Task: ${request.task}`,
      Object.fromEntries(
        request.fields.map((f) => [
          f.key,
          { type: 'text', instructions: `The user's task may require typing into the field labelled "${f.label}". Return the value to type, or null if the task does not involve this field.` },
        ]),
      ),
    ).pipe(
      Effect.map((res) => ({
        keys: new Set(request.fields.filter((f) => (res.answers[f.key]?.pNull ?? 1) < maxPNull).map((f) => f.key)),
        costUsd: res.costUsd,
        ms: res.ms,
      })),
    );
}

export function fallbackWriter(primary: Writer, backup: Writer, involved: FieldInvolvement): (request: WriterRequest) => Effect.Effect<WriterResult & { readonly fellBack: readonly string[] }, LlmError | ClairicError> {
  return (request) =>
    Effect.gen(function* () {
      const first = yield* primary(request);
      const blanks = request.fields.filter((f) => first.values[f.key] === null);
      if (!blanks.length) return { ...first, fellBack: [] };
      const needed = yield* involved({ task: request.task, fields: blanks });
      const checked = { ...first, costUsd: first.costUsd + needed.costUsd, ms: first.ms + needed.ms };
      const missing = blanks.filter((f) => needed.keys.has(f.key));
      if (!missing.length) return { ...checked, fellBack: [] };
      const second = yield* backup({ task: request.task, fields: missing });
      return {
        values: { ...first.values, ...Object.fromEntries(missing.map((f) => [f.key, second.values[f.key] ?? null])) },
        costUsd: checked.costUsd + second.costUsd,
        ms: checked.ms + second.ms,
        inputTokens: first.inputTokens + second.inputTokens,
        outputTokens: first.outputTokens + second.outputTokens,
        fellBack: missing.map((f) => f.key),
      };
    });
}

export function writerFromSpec(transport: Transport, spec: string, opts: { thinking?: boolean; prompt?: WriterPrompt } = {}) {
  const [primary, backup] = spec.split('>') as [LlmModel, LlmModel | undefined];
  const first = llmWriter(transport, primary, opts);
  if (!backup) return (request: WriterRequest) => first(request).pipe(Effect.map((res) => ({ ...res, fellBack: [] as readonly string[] })));
  return fallbackWriter(first, llmWriter(transport, backup, opts), clairicInvolvement(transport));
}
