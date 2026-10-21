import { Effect, Schedule } from 'effect';
import type { Transport } from './clef.ts';

export const CLAIRIC = { workersAiId: '@cf/cloudflare/clairic', usdPerMillionIn: 0.1 } as const;

export type ClairicFieldType = 'text' | 'number' | 'date' | 'time' | 'datetime' | 'duration' | 'list';
export interface ClairicField {
  type: ClairicFieldType;
  instructions: string;
  items?: 'text' | 'number' | 'date';
}
export interface ClairicAnswer {
  value: unknown;
  confidence: number;
  pNull: number;
}
export interface ClairicResult {
  answers: Record<string, ClairicAnswer>;
  inputTokens: number;
  costUsd: number;
  ms: number;
}

export class ClairicError extends Error {
  constructor(
    readonly status: number,
    reason: string,
  ) {
    super(`clairic ${status}: ${reason}`);
  }
}

export function extract(transport: Transport, state: string, fields: Record<string, ClairicField>): Effect.Effect<ClairicResult, ClairicError> {
  const once = Effect.tryPromise({
    try: async (signal) => {
      const t0 = performance.now();
      const res = await transport(CLAIRIC.workersAiId, { model: 'clairic', state, fields }, signal);
      if (res.status !== 200) throw new ClairicError(res.status, res.text.slice(0, 300));
      const body = ((res.json as { result?: unknown })?.result ?? res.json) as {
        answers?: Record<string, { value?: unknown; confidence?: number; p_null?: number }>;
        usage?: { input_tokens?: number };
      };
      const answers = Object.fromEntries(
        Object.entries(body.answers ?? {}).map(([name, a]) => [name, { value: a.value ?? null, confidence: a.confidence ?? 0, pNull: a.p_null ?? 1 }]),
      );
      const inputTokens = body.usage?.input_tokens ?? 0;
      return { answers, inputTokens, costUsd: (inputTokens * CLAIRIC.usdPerMillionIn) / 1e6, ms: performance.now() - t0 };
    },
    catch: (e) => (e instanceof ClairicError ? e : new ClairicError(0, String(e).slice(0, 300))),
  });
  return once.pipe(
    Effect.retry({ schedule: Schedule.exponential('500 millis'), times: 3, while: (e) => e.status === 0 || e.status === 429 || e.status >= 500 }),
  );
}
