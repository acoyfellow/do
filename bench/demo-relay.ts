import { mkdirSync } from 'node:fs';
import { durationSeconds, escapeHtml, readLog, renderCard, renderSegment, run } from './demo-video.ts';

const [source, out] = process.argv.slice(2);
if (!source || !out) throw new Error('usage: demo-relay.ts <record dir> <out.mp4>');
const dir = `${source}/compose`;
mkdirSync(dir, { recursive: true });

const RELAY = 'relay_kimi-k2.6';
const recording = (task: string, arm: string) => ({ video: `${source}/${task}-${arm}-r0.webm`, log: readLog(`${source}/${task}-${arm}-r0.hud.json`) });
const taskText = (task: string) => readLog(`${source}/${task}-duet-r0.hud.json`).captions[0]?.status.replace(/^Task: /, '') ?? task;

const parts = [
  await renderCard(
    dir,
    'intro',
    5,
    `<h1>When the task doesn't quote the text</h1><p style="margin-top:28px">"${escapeHtml(taskText('h-email-change'))}"</p><p class="muted" style="font-size:26px;margin-top:28px">Real recording · Clef, Clairic and kimi-k2.6 on Workers AI · not staged</p>`,
  ),
  await renderSegment(dir, 'duet', {
    ...recording('h-email-change', 'duet'),
    speed: 1,
    heading: 'Clef + Clairic: Clairic can only copy text from the task',
    sub: 'It types the address as spelled out, so the task fails · real time',
    accent: '#f87171',
  }),
  await renderSegment(dir, 'relay-email', {
    ...recording('h-email-change', RELAY),
    speed: 1,
    heading: 'Relay: Clef sees the task needs new text and asks a writer once',
    sub: 'kimi-k2.6 writes the field value · Clef still picks every click · real time',
    accent: '#4ade80',
  }),
  await renderSegment(dir, 'relay-chat', {
    ...recording('h-chat-late', RELAY),
    speed: 1,
    heading: `Relay: "${taskText('h-chat-late')}"`,
    sub: 'The writer composes the message · Clef opens the chat and sends it · real time',
    accent: '#4ade80',
  }),
  await renderCard(
    dir,
    'outro',
    7,
    `<h1>30 tasks · 3 repeats each</h1><table>
      <tr><th>arm</th><th>finished</th><th>false "done"</th><th>cost / task</th></tr>
      <tr class="win"><td>Relay (Clef + Clairic + writer)</td><td>30 / 30</td><td>0</td><td>$0.0016</td></tr>
      <tr><td>Clef + Clairic</td><td>25 / 30</td><td>12</td><td>$0.0015</td></tr>
      <tr><td>vision · claude-opus-5-5</td><td>22.7 / 30</td><td>4</td><td>$0.029</td></tr>
      <tr><td>Opus plans + Clef clicks</td><td>22.0 / 30</td><td>0</td><td>$0.029</td></tr>
    </table><p class="muted" style="margin-top:36px">github.com/acoyfellow/do · bench-2 and bench-3 in bench/runs</p>`,
  ),
];
const list = `${dir}/list.txt`;
await Bun.write(list, parts.map((part) => `file '${part}'`).join('\n'));
run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', out]);
console.log(`${out} ${durationSeconds(out).toFixed(1)}s`);
