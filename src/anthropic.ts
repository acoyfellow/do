import { readConfig, readToken, redact } from './credentials.ts';
import type { Msg, Part, Tool, ToolCall } from './llm.ts';

export interface AnthropicReply {
  status: number;
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  raw: string;
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

const DATA_URL = /^data:(image\/[a-z]+);base64,(.*)$/s;

function partToBlock(part: Part): Block {
  if (part.type === 'text') return { type: 'text', text: part.text };
  const match = DATA_URL.exec(part.image_url.url);
  if (!match) throw new Error('Anthropic route needs base64 data URL images');
  return { type: 'image', source: { type: 'base64', media_type: match[1] as string, data: match[2] as string } };
}

function contentBlocks(content: Msg['content']): Block[] {
  return typeof content === 'string' ? (content ? [{ type: 'text', text: content }] : []) : content.map(partToBlock);
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export function toAnthropicMessages(messages: Msg[]): { system: string; messages: AnthropicMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')))
    .join('\n\n');
  const out: AnthropicMessage[] = [];
  const push = (role: AnthropicMessage['role'], blocks: Block[]) => {
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      push('user', [
        { type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) },
      ]);
    } else if (m.role === 'assistant') {
      const calls: Block[] = (m.tool_calls ?? []).map((c) => ({
        type: 'tool_use',
        id: c.id,
        name: c.function.name,
        input: parseArguments(c.function.arguments),
      }));
      push('assistant', [...contentBlocks(m.content), ...calls]);
    } else {
      push('user', contentBlocks(m.content));
    }
  }
  return { system, messages: out };
}

export async function anthropicMessages(
  model: string,
  messages: Msg[],
  opts: { tools?: Tool[]; maxTokens: number; effort: 'low' | 'medium' | 'high' },
  signal?: AbortSignal,
): Promise<AnthropicReply> {
  const cfg = readConfig();
  const token = readToken();
  const gateway = process.env.DO_ANTHROPIC_GATEWAY ?? 'my-ax';
  const converted = toAnthropicMessages(messages);
  const body = {
    model,
    max_tokens: opts.maxTokens,
    ...(converted.system ? { system: converted.system } : {}),
    messages: converted.messages,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort },
    ...(opts.tools
      ? { tools: opts.tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) }
      : {}),
  };
  const res = await fetch(`https://gateway.ai.cloudflare.com/v1/${cfg.accountId}/${gateway}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'cf-aig-authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(process.env.DO_SKIP_CACHE === '1' ? { 'cf-aig-skip-cache': 'true' } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  const raw = redact(await res.text(), token);
  let json: {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  } = {};
  try {
    json = JSON.parse(raw);
  } catch {
    json = {};
  }
  const blocks = json.content ?? [];
  return {
    status: res.status,
    text: blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join(''),
    toolCalls: blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id ?? '', type: 'function', function: { name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) } })),
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    raw,
  };
}
