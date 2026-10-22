import { chromium } from 'playwright';

type Card = { file: string; width: number; height: number; html: string };

const style = `
  body { margin: 0; background: transparent; font-family: -apple-system, Inter, Arial, sans-serif; }
  .bar { box-sizing: border-box; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; gap: 28px;
         background: #09090b; color: #fafafa; font-size: 28px; }
  .tag { display: inline-block; padding: 10px 18px; border-radius: 10px; background: rgba(9,9,11,.88); color: #fafafa; font-size: 30px; font-weight: 700; }
  .amber { color: #fbad41; }
  .muted { color: #a1a1aa; font-size: 22px; }
  .title { box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
           background: #09090b; color: #fafafa; text-align: center; padding: 60px; }
  .title h1 { font-size: 84px; margin: 0 0 18px; letter-spacing: -1px; }
  .title p { font-size: 34px; margin: 6px 0; color: #d4d4d8; max-width: 1500px; }
  table { border-collapse: collapse; margin-top: 30px; font-size: 32px; }
  td, th { padding: 12px 28px; text-align: left; color: #fafafa; }
  th { color: #a1a1aa; font-weight: 500; font-size: 24px; }
  tr.win td { color: #4ade80; font-weight: 700; }
`;

export async function renderCards(dir: string, cards: Card[]) {
  const browser = await chromium.launch();
  for (const card of cards) {
    const page = await browser.newPage({ viewport: { width: card.width, height: card.height } });
    await page.setContent(`<style>${style}</style>${card.html}`);
    await page.screenshot({ path: `${dir}/${card.file}`, omitBackground: true });
    await page.close();
  }
  await browser.close();
}

if (import.meta.main) {
  const dir = process.argv[2] ?? '.';
  await renderCards(dir, [
    {
      file: 'header.png',
      width: 1920,
      height: 60,
      html: `<div class="bar"><span class="amber">Same task:</span> add the USB hub, apply coupon "SAVE10", place the order. <span class="muted">Real run · real models · nothing staged</span></div>`,
    },
    { file: 'tag-left.png', width: 640, height: 70, html: `<span class="tag">Clef picks from a list</span>` },
    { file: 'speed.png', width: 360, height: 70, html: `<span class="tag amber">▶▶ 16× speed</span>` },
    { file: 'tag-right.png', width: 760, height: 70, html: `<span class="tag">Vision model guesses pixels</span>` },
    {
      file: 'intro.png',
      width: 1920,
      height: 1080,
      html: `<div class="title"><h1>do</h1><p>Don't let a model guess pixels.</p><p class="amber">List what can be clicked, and let a small model choose.</p></div>`,
    },
    {
      file: 'outro.png',
      width: 1920,
      height: 1080,
      html: `<div class="title"><h1>20 tasks · 3 repeats each</h1>
        <table>
          <tr><th style="color:#a1a1aa">arm</th><th>finished</th><th>cost / task</th><th>median time</th></tr>
          <tr class="win"><td>Clef alone (pilot)</td><td>20.0 / 20</td><td>$0.0014</td><td>3.6 s</td></tr>
          <tr><td>LLM plans + Clef clicks</td><td>13.7 / 20</td><td>$0.0049</td><td>22.4 s</td></tr>
          <tr><td>vision · qwen3.8-27b</td><td>12.0 / 20</td><td>$0.0090</td><td>103.7 s</td></tr>
          <tr><td>vision · kimi-k2.6</td><td>11.7 / 20</td><td>$0.0065</td><td>13.4 s</td></tr>
        </table>
        <p class="muted" style="margin-top:36px">Reproduce it: github.com/acoyfellow/do</p></div>`,
    },
  ]);
}
