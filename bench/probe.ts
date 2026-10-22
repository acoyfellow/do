// Preflight before the full run: one Clef call per model with a real screenshot, one call per baseline LLM,
// and one tool-calling round trip for the planner. Fails loudly so the big run never starts on a broken route.
import { Effect } from 'effect';
import { ask, CLEF_MODELS, type ClefModel } from '../src/clef.ts';
import { chat, type LlmModel } from '../src/llm.ts';
import { screenshot } from '../src/perceive.ts';
import { close, open, THINKING, transport } from './lib.ts';

const t = transport();
const page = await open({ screen: 'mail', seed: 11, theme: 'light', density: 'comfortable', accent: 0 });
const shot = await screenshot(page);
await page.context().close();
let failed = 0;

const clefProbe = async (model: ClefModel) => {
  const r = await Effect.runPromise(
    Effect.result(
      ask(t, {
        model,
        state: { task: 'Which app section is open?' },
        images: [shot],
        questions: {
          section: {
            type: 'choice',
            instructions: 'The image is the current screen. Which section of the app is showing?',
            criteria: { mail: 'An email inbox', settings: 'A settings form', shop: 'A shop' },
          },
          has_toolbar: { type: 'noul', instructions: 'Is there a row of buttons above the list?' },
        },
      }),
    ),
  );
  if (r._tag === 'Failure') {
    failed++;
    console.log(`FAIL ${model}: ${JSON.stringify(r.failure)}`);
  } else {
    const a = r.success.answers;
    console.log(
      `ok   ${model}: section=${a.section?.type === 'choice' ? `${a.section.choice} (${a.section.probabilities[a.section.choice]?.toFixed(3)})` : '?'} toolbar=${a.has_toolbar?.type === 'noul' ? a.has_toolbar.p.toFixed(3) : '?'} tokens=${r.success.inputTokens} ${Math.round(r.success.ms)}ms`,
    );
    if (a.section?.type === 'choice' && a.section.choice !== 'mail') console.log(`WARN ${model} misread the screen`);
  }
};

const visionProbe = async (model: LlmModel) => {
  const r = await Effect.runPromise(
    Effect.result(
      chat(
        t,
        model,
        [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: shot } },
              { type: 'text', text: 'Reply with only JSON {"x": int, "y": int}: the pixel center of the Compose button in this 1280x800 screenshot.' },
            ],
          },
        ],
        { maxTokens: 1500, thinking: THINKING },
      ),
    ),
  );
  if (r._tag === 'Failure') {
    failed++;
    console.log(`FAIL ${model} vision: ${JSON.stringify(r.failure)}`);
  } else console.log(`ok   ${model} vision: ${r.success.text.slice(0, 120).replace(/\n/g, ' ')} (in=${r.success.inputTokens} out=${r.success.outputTokens})`);
};

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'act',
      description: 'Click a control described in words.',
      parameters: { type: 'object', properties: { intent: { type: 'string' } }, required: ['intent'] },
    },
  },
];
const toolsProbe = async () => {
  const r = await Effect.runPromise(
    Effect.result(
      chat(
        t,
        'kimi-k2.6',
        [
          { role: 'system', content: 'You operate a computer through tools.' },
          { role: 'user', content: 'Open the Spam folder.' },
        ],
        { tools, maxTokens: 1500, thinking: THINKING },
      ),
    ),
  );
  if (r._tag === 'Failure') {
    failed++;
    console.log(`FAIL kimi-k2.6 tools: ${JSON.stringify(r.failure)}`);
  } else
    console.log(
      `${r.success.toolCalls.length ? 'ok  ' : 'WARN'} kimi-k2.6 tools: ${JSON.stringify(r.success.toolCalls).slice(0, 200)} text=${r.success.text.slice(0, 80)}`,
    );
};

await Promise.all([
  ...(Object.keys(CLEF_MODELS) as ClefModel[]).map(clefProbe),
  ...(['kimi-k2.6', 'qwen3.8-27b'] as LlmModel[]).map(visionProbe),
  toolsProbe(),
]);
await close();
if (failed) {
  console.log(`probe: ${failed} failures`);
  process.exit(1);
}
console.log('probe: all routes answer');
