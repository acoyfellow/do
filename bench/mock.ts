// Offline stand-in for the gateway so the whole harness can be exercised without a token.
// Choice: word overlap between the question+state and each option. Noul: 0.5 +/- a hash wobble.
// It proves plumbing only. Numbers from a mock run mean nothing.
import type { Transport } from '../src/clef.ts';

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

export function mockTransport(): Transport {
  return async (_id, body: any) => {
    await new Promise((r) => setTimeout(r, 5));
    if (body.questions) {
      const ctx = words(JSON.stringify(body.state));
      const answers: Record<string, unknown> = {};
      for (const [id, q] of Object.entries<any>(body.questions)) {
        const qw = new Set([...words(q.instructions), ...ctx]);
        if (q.type === 'noul') answers[id] = { type: 'noul', noul: Math.min(0.99, Math.max(0.01, 0.5 + (hash(id + JSON.stringify(body.state)) % 40) / 100)) };
        else {
          const keys = Array.isArray(q.criteria) ? q.criteria.map((_: unknown, i: number) => String(i)) : Object.keys(q.criteria);
          const scores = keys.map((k: string, i: number) => {
            const text = Array.isArray(q.criteria) ? q.criteria[i] : `${k} ${q.criteria[k] ?? ''}`;
            let s = 0.1;
            for (const w of words(String(text))) if (qw.has(w)) s += 1;
            return Math.exp(s);
          });
          const z = scores.reduce((a: number, b: number) => a + b, 0);
          const probabilities = Object.fromEntries(keys.map((k: string, i: number) => [k, scores[i] / z]));
          const best = keys[scores.indexOf(Math.max(...scores))];
          answers[id] =
            q.type === 'choice'
              ? { type: 'choice', choice: best, probabilities, confidence: Math.max(...scores) / z }
              : { type: 'score', score: Number(best), probabilities, confidence: Math.max(...scores) / z };
        }
      }
      const json = { result: { answers, usage: { input_tokens: 900 + (body.images?.length ?? 0) * 1024, output_tokens: 0 } } };
      return { status: 200, json, text: JSON.stringify(json) };
    }
    // LLM: point at the middle of the screen, or finish.
    const last = JSON.stringify(body.messages.at(-1)).slice(0, 2000);
    const tools = body.tools as any[] | undefined;
    let json: unknown;
    if (tools?.length) {
      const n = body.messages.filter((m: any) => m.role === 'tool').length;
      const call =
        n === 0
          ? { id: 'c1', type: 'function', function: { name: 'outline', arguments: '{}' } }
          : n < 3
            ? { id: `c${n + 1}`, type: 'function', function: { name: 'act', arguments: JSON.stringify({ intent: 'the first button' }) } }
            : { id: 'cz', type: 'function', function: { name: 'done', arguments: JSON.stringify({ summary: 'mock' }) } };
      json = { result: { response: null, tool_calls: [call], usage: { prompt_tokens: 800, completion_tokens: 40 } } };
    } else {
      const done = last.includes('step 3');
      json = { result: { response: done ? '{"action":"done"}' : '{"action":"click","x":640,"y":400}', usage: { prompt_tokens: 1500, completion_tokens: 30 } } };
    }
    return { status: 200, json, text: JSON.stringify(json) };
  };
}
