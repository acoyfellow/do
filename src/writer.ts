import { Effect } from 'effect';
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
