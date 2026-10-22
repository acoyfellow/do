import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

type Caption = { atMs: number; title: string; status: string; detail?: string; tone?: 'run' | 'pass' | 'fail' };
type Click = { atMs: number; x: number; y: number };
type Log = { captions: Caption[]; clicks: Click[] };
type Segment = { video: string; log: Log; speed: number; heading: string; sub: string; accent: string };

const CANVAS = { width: 1920, height: 1080 };
const PAGE = { x: 0, y: 140, width: 1280, height: 800 };
const PANEL = { x: 1280, y: 140, width: 640, height: 800 };
const FPS = 30;

const css = `
  body { margin: 0; font-family: -apple-system, Inter, Arial, sans-serif; color: #fafafa; }
  .full { box-sizing: border-box; width: 100vw; height: 100vh; background: #09090b; }
  .center { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 60px; }
  .top { display: flex; flex-direction: column; justify-content: center; padding: 0 40px; }
  .panel { padding: 40px 36px; display: flex; flex-direction: column; gap: 18px; border-left: 1px solid #27272a; }
  h1 { margin: 0; font-size: 80px; letter-spacing: -1px; }
  h2 { margin: 0; font-size: 44px; }
  p { margin: 8px 0; font-size: 32px; color: #d4d4d8; }
  .muted { color: #a1a1aa; }
  .step { font-size: 30px; font-weight: 700; }
  .status { font-size: 38px; line-height: 1.3; }
  .detail { font-size: 24px; color: #a1a1aa; line-height: 1.4; }
  .ring { width: 100vw; height: 100vh; box-sizing: border-box; border-radius: 50%; border: 6px solid #f6821f; background: rgba(246,130,31,.28); }
  table { border-collapse: collapse; margin-top: 30px; font-size: 34px; }
  td, th { padding: 12px 28px; text-align: left; }
  th { color: #a1a1aa; font-weight: 500; font-size: 24px; }
  tr.win td { color: #4ade80; font-weight: 700; }
`;

export const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
const toneColor = (tone: Caption['tone'], accent: string) => (tone === 'pass' ? '#4ade80' : tone === 'fail' ? '#f87171' : accent);

export function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`${cmd} failed`);
}

export function durationSeconds(file: string): number {
  const out = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(out.stdout.trim());
}

async function renderImages(images: { file: string; width: number; height: number; html: string; transparent?: boolean }[]) {
  const browser = await chromium.launch();
  for (const image of images) {
    const page = await browser.newPage({ viewport: { width: image.width, height: image.height } });
    await page.setContent(`<style>${css}</style>${image.html}`);
    await page.screenshot({ path: image.file, omitBackground: image.transparent ?? false });
    await page.close();
  }
  await browser.close();
}

function visibleCaptions(log: Log): Caption[] {
  let clickIndex = 0;
  let repeats = 0;
  return log.captions
    .filter((caption, index, all) => all[index + 1]?.atMs !== caption.atMs)
    .filter((caption) => !caption.status.startsWith('Sends a screenshot'))
    .map((caption) => {
      if (!caption.status.startsWith('Looks at the screenshot, clicks')) return caption;
      const click = log.clicks[clickIndex];
      const previous = log.clicks[clickIndex - 1];
      clickIndex++;
      if (!click) return caption;
      const same = previous && Math.abs(previous.x - click.x) < 4 && Math.abs(previous.y - click.y) < 4;
      repeats = same ? repeats + 1 : 0;
      const where = `Clicks the screen at (${Math.round(click.x)}, ${Math.round(click.y)})`;
      return { ...caption, status: same ? `${where}: the same spot again (${repeats + 1} times in a row). Nothing changes.` : where };
    });
}

export async function renderSegment(dir: string, name: string, segment: Segment): Promise<string> {
  const captions = visibleCaptions(segment.log);
  const length = durationSeconds(segment.video);
  await renderImages([
    {
      file: `${dir}/${name}-top.png`,
      width: CANVAS.width,
      height: PAGE.y,
      html: `<div class="full top"><h2 style="color:${segment.accent}">${escapeHtml(segment.heading)}</h2><p class="muted" style="font-size:26px">${escapeHtml(segment.sub)}</p></div>`,
    },
    ...captions.map((caption, index) => ({
      file: `${dir}/${name}-cap${index}.png`,
      width: PANEL.width,
      height: PANEL.height,
      html: `<div class="full panel"><div class="step" style="color:${toneColor(caption.tone, segment.accent)}">${escapeHtml(caption.title)}</div><div class="status">${escapeHtml(caption.status)}</div>${caption.detail ? `<div class="detail">${escapeHtml(caption.detail)}</div>` : ''}${segment.speed > 1 ? `<div class="detail" style="margin-top:auto;color:#fbad41">▶▶ played at ${segment.speed}× speed</div>` : ''}</div>`,
    })),
    { file: `${dir}/ring.png`, width: 72, height: 72, html: `<div class="ring"></div>`, transparent: true },
  ]);

  const inputs = ['-i', segment.video, '-loop', '1', '-i', `${dir}/${name}-top.png`, '-loop', '1', '-i', `${dir}/ring.png`];
  for (const index of captions.keys()) inputs.push('-loop', '1', '-i', `${dir}/${name}-cap${index}.png`);
  const filters: string[] = [`[0:v]fps=${FPS},scale=${PAGE.width}:${PAGE.height},setpts=PTS-STARTPTS[page0]`];
  let pageLabel = 'page0';
  segment.log.clicks.forEach((click, index) => {
    const from = click.atMs / 1000;
    const next = `pc${index}`;
    filters.push(
      `[${pageLabel}][2:v]overlay=${Math.round(click.x - 36)}:${Math.round(click.y - 36)}:enable='between(t,${from.toFixed(3)},${(from + 0.9).toFixed(3)})'[${next}]`,
    );
    pageLabel = next;
  });
  filters.push(`color=c=0x09090b:s=${CANVAS.width}x${CANVAS.height}:r=${FPS}:d=${length.toFixed(3)}[bg]`);
  filters.push(`[bg][${pageLabel}]overlay=${PAGE.x}:${PAGE.y}:shortest=1[c0]`);
  filters.push(`[c0][1:v]overlay=0:0[c1]`);
  let canvasLabel = 'c1';
  captions.forEach((caption, index) => {
    const from = caption.atMs / 1000;
    const to = captions[index + 1] ? captions[index + 1].atMs / 1000 : length + 1;
    const next = `k${index}`;
    filters.push(`[${canvasLabel}][${index + 3}:v]overlay=${PANEL.x}:${PANEL.y}:enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'[${next}]`);
    canvasLabel = next;
  });
  filters.push(`[${canvasLabel}]setpts=PTS/${segment.speed},fps=${FPS}[out]`);
  const output = `${dir}/${name}.mp4`;
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-t',
    (length / segment.speed).toFixed(3),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    '-preset',
    'veryfast',
    output,
  ]);
  return output;
}

export async function renderCard(dir: string, name: string, seconds: number, html: string): Promise<string> {
  await renderImages([{ file: `${dir}/${name}.png`, ...CANVAS, html: `<div class="full center">${html}</div>` }]);
  const output = `${dir}/${name}.mp4`;
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-t',
    String(seconds),
    '-i',
    `${dir}/${name}.png`,
    '-vf',
    `fps=${FPS},format=yuv420p`,
    '-c:v',
    'libx264',
    output,
  ]);
  return output;
}

export const readLog = (file: string): Log => JSON.parse(readFileSync(file, 'utf8'));

if (import.meta.main) {
  const [source, task, visionArm, out] = process.argv.slice(2);
  if (!source || !task || !visionArm || !out) throw new Error('usage: demo-video.ts <record dir> <task id> <vision arm file tag> <out.mp4>');
  const dir = `${source}/compose`;
  mkdirSync(dir, { recursive: true });
  const taskText = readLog(`${source}/${task}-pilot-r0.hud.json`).captions[0]?.status.replace(/^Task: /, '') ?? task;
  const visionModel = visionArm.replace(/^vision_/, '');
  const parts = [
    await renderCard(
      dir,
      'intro',
      4,
      `<h1>One task, two agents</h1><p style="margin-top:28px">${escapeHtml(taskText)}</p><p class="muted" style="font-size:26px;margin-top:28px">Real recording · real models on Workers AI · not staged</p>`,
    ),
    await renderSegment(dir, 'clef', {
      video: `${source}/${task}-pilot-r0.webm`,
      log: readLog(`${source}/${task}-pilot-r0.hud.json`),
      speed: 1,
      heading: 'Clef: the page lists what can be clicked, a small model picks one',
      sub: 'Orange ring = where the click landed · real time',
      accent: '#4ade80',
    }),
    await renderSegment(dir, 'vision', {
      video: `${source}/${task}-${visionArm}-r0.webm`,
      log: readLog(`${source}/${task}-${visionArm}-r0.hud.json`),
      speed: 4,
      heading: `Vision model (${visionModel}): looks at a screenshot, guesses a pixel`,
      sub: 'Orange ring = where the click landed · 4× speed',
      accent: '#fbad41',
    }),
    await renderCard(
      dir,
      'outro',
      7,
      `<h1>20 tasks · 3 repeats each</h1><table>
        <tr><th>arm</th><th>finished</th><th>cost / task</th><th>median time</th></tr>
        <tr class="win"><td>Clef alone</td><td>20.0 / 20</td><td>$0.0014</td><td>3.6 s</td></tr>
        <tr><td>LLM plans + Clef clicks</td><td>13.7 / 20</td><td>$0.0049</td><td>22.4 s</td></tr>
        <tr><td>vision · qwen3.8-27b</td><td>12.0 / 20</td><td>$0.0090</td><td>103.7 s</td></tr>
        <tr><td>vision · kimi-k2.6</td><td>11.7 / 20</td><td>$0.0065</td><td>13.4 s</td></tr>
      </table><p class="muted" style="margin-top:36px">github.com/acoyfellow/do · reproduce with bun run bench</p>`,
    ),
  ];
  const list = `${dir}/list.txt`;
  await Bun.write(list, parts.map((part) => `file '${part}'`).join('\n'));
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    '-preset',
    'veryfast',
    '-movflags',
    '+faststart',
    out,
  ]);
  console.log(`${out} ${durationSeconds(out).toFixed(1)}s`);
}
