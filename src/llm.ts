// Baseline: a generative vision model reading screenshots and answering in JSON,
// the way today's computer-use loops work. Same gateway, same token.
import { Data, Effect, Schedule } from 'effect';
import { anthropicMessages } from './anthropic.ts';
import type { Transport } from './clef.ts';

export const LLM_MODELS = {
  'kimi-k2.6': {
    provider: 'workers-ai',
    workersAiId: '@cf/moonshotai/kimi-k2.6',
    usdIn: 0.95,
    usdOut: 4.0,
    thinkingOff: { chat_template_kwargs: { thinking: false } },
    coordinates: 'normalized1000',
    frame: { width: 1280, height: 800 },
    systemRole: true,
  },
  'qwen3.8-27b': {
    provider: 'workers-ai',
    workersAiId: '@cf/qwen/qwen3.8-27b',
    usdIn: 0.45,
    usdOut: 3.2,
    thinkingOff: {},
    coordinates: 'pixels',
    frame: { width: 1280, height: 800 },
    systemRole: false,
  },
  'claude-opus-5-5': {
    provider: 'anthropic',
    workersAiId: 'claude-opus-5-5',
    usdIn: 5,
    usdOut: 25,
    thinkingOff: {},
    coordinates: 'pixels',
    frame: { width: 1280, height: 800 },
    systemRole: true,
  },
} as const;
export const ANTHROPIC_EFFORT = (process.env.DO_EFFORT ?? 'low') as 'low' | 'medium' | 'high';
export type LlmModel = keyof typeof LLM_MODELS;
export type CoordinateSystem = 'pixels' | 'normalized1000';

export interface Viewport {
  width: number;
  height: number;
}

export function withInstructions(model: LlmModel, instructions: string, user: Part[]): Msg[] {
  return LLM_MODELS[model].systemRole
    ? [
        { role: 'system', content: instructions },
        { role: 'user', content: user },
      ]
    : [{ role: 'user', content: [{ type: 'text', text: instructions }, ...user] }];
}

export const screenshotFrame = (model: LlmModel): Viewport => LLM_MODELS[model].frame;

export function coordinateInstruction(model: LlmModel): string {
  const frame = screenshotFrame(model);
  return LLM_MODELS[model].coordinates === 'normalized1000'
    ? 'x and y are normalized to 0-1000 on both axes (0,0 is the top left corner, 1000,1000 the bottom right).'
    : `The screenshot is ${frame.width}x${frame.height} pixels; x and y are pixels in it (0,0 is the top left corner).`;
}

export function toViewportPoint(model: LlmModel, viewport: Viewport, x: unknown, y: unknown): { x: number; y: number } {
  const rawX = Number(x);
  const rawY = Number(y);
  if (LLM_MODELS[model].coordinates === 'normalized1000') {
    const scale = rawX <= 1 && rawY <= 1 ? 1 : 1000;
    return { x: (rawX * viewport.width) / scale, y: (rawY * viewport.height) / scale };
  }
  const frame = screenshotFrame(model);
  return { x: (rawX * viewport.width) / frame.width, y: (rawY * viewport.height) / frame.height };
}

export class LlmError extends Data.TaggedError('LlmError')<{ readonly status: number; readonly reason: string }> {}

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Part[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface Tool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}
export interface LlmResult {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

function pick(json: unknown): { text: string; toolCalls: ToolCall[]; inTok: number; outTok: number } {
  const r = ((json as { result?: unknown })?.result ?? json) as Record<string, any>;
  // Workers AI returns either { response, tool_calls, usage } or an OpenAI-shaped { choices, usage }.
  const choice = r?.choices?.[0]?.message;
  const text: string = choice?.content ?? (typeof r?.response === 'string' ? r.response : r?.response ? JSON.stringify(r.response) : '');
  const rawCalls: any[] = choice?.tool_calls ?? r?.tool_calls ?? [];
  const toolCalls: ToolCall[] = rawCalls.map((c, i) => ({
    id: c.id ?? `call_${i}`,
    type: 'function',
    function: {
      name: c.function?.name ?? c.name,
      arguments:
        typeof (c.function?.arguments ?? c.arguments) === 'string'
          ? (c.function?.arguments ?? c.arguments)
          : JSON.stringify(c.function?.arguments ?? c.arguments ?? {}),
    },
  }));
  const u = r?.usage ?? {};
  return { text: text ?? '', toolCalls, inTok: u.prompt_tokens ?? u.input_tokens ?? 0, outTok: u.completion_tokens ?? u.output_tokens ?? 0 };
}

export function chat(
  transport: Transport,
  model: LlmModel,
  messages: Msg[],
  opts: { tools?: Tool[]; maxTokens?: number; json?: boolean; thinking?: boolean } = {},
): Effect.Effect<LlmResult, LlmError> {
  const m = LLM_MODELS[model];
  const body: Record<string, unknown> = { messages, max_tokens: opts.maxTokens ?? 800, temperature: 0, ...(opts.thinking === false ? m.thinkingOff : {}) };
  if (opts.tools) body.tools = opts.tools;
  if (opts.json) body.response_format = { type: 'json_object' };
  const once = Effect.gen(function* () {
    const t0 = performance.now();
    if (m.provider === 'anthropic') {
      const reply = yield* Effect.tryPromise({
        try: (signal) =>
          anthropicMessages(m.workersAiId, messages, { tools: opts.tools, maxTokens: Math.max(opts.maxTokens ?? 800, 4000), effort: ANTHROPIC_EFFORT }, signal),
        catch: (e) => new LlmError({ status: 0, reason: String(e).slice(0, 300) }),
      });
      if (reply.status !== 200) return yield* Effect.fail(new LlmError({ status: reply.status, reason: reply.raw.slice(0, 500) }));
      return {
        text: reply.text,
        toolCalls: reply.toolCalls,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
        costUsd: (reply.inputTokens * m.usdIn + reply.outputTokens * m.usdOut) / 1e6,
        ms: performance.now() - t0,
      } satisfies LlmResult;
    }
    const res = yield* Effect.tryPromise({
      try: (signal) => transport(m.workersAiId, body, signal),
      catch: (e) => new LlmError({ status: 0, reason: String(e).slice(0, 300) }),
    });
    if (res.status !== 200) return yield* Effect.fail(new LlmError({ status: res.status, reason: res.text.slice(0, 500) }));
    const p = pick(res.json);
    return {
      text: p.text,
      toolCalls: p.toolCalls,
      inputTokens: p.inTok,
      outputTokens: p.outTok,
      costUsd: (p.inTok * m.usdIn + p.outTok * m.usdOut) / 1e6,
      ms: performance.now() - t0,
    } satisfies LlmResult;
  });
  return once.pipe(
    Effect.timeout('120 seconds'),
    Effect.catchTag('TimeoutError', () => Effect.fail(new LlmError({ status: 0, reason: 'timeout' }))),
    Effect.retry({
      schedule: Schedule.exponential('1 second'),
      times: 3,
      while: (e) => e.status === 429 || e.status === 529 || e.status >= 500 || e.status === 0,
    }),
  );
}

/** Pull the first JSON object out of model text (models wrap JSON in prose or fences). */
export function firstJson(text: string): any {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
