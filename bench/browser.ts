import type { CDPSession, Page } from 'playwright';
import type { Device } from '../src/hand.ts';
import { type Box, type Candidate, center, describe } from '../src/perceive.ts';

export { type Box, type Candidate, center, describe };

const INTERACTIVE = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'switch',
  'checkbox',
  'radio',
  'combobox',
  'tab',
  'menuitem',
  'option',
  'slider',
  'spinbutton',
  'listbox',
]);

export async function cdp(page: Page): Promise<CDPSession> {
  const s = await page.context().newCDPSession(page);
  await s.send('DOM.enable');
  await s.send('Accessibility.enable');
  return s;
}
export async function axCandidates(page: Page, session: CDPSession): Promise<Candidate[]> {
  await session.send('DOM.getDocument', { depth: -1 });
  const { nodes } = (await session.send('Accessibility.getFullAXTree')) as { nodes: any[] };
  const vw = page.viewportSize()?.width ?? 1280;
  const vh = page.viewportSize()?.height ?? 800;
  const modal = await page.evaluate(() => !!document.querySelector('[role=dialog]'));
  const out: Candidate[] = [];
  for (const n of nodes) {
    if (n.ignored || !n.backendDOMNodeId) continue;
    const role = n.role?.value as string;
    if (!INTERACTIVE.has(role)) continue;
    let box: Box | undefined;
    try {
      const { model } = (await session.send('DOM.getBoxModel', { backendNodeId: n.backendDOMNodeId })) as any;
      const q = model.border as number[];
      const xs = [q[0], q[2], q[4], q[6]];
      const ys = [q[1], q[3], q[5], q[7]];
      box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    } catch {
      continue;
    }
    if (box.w < 2 || box.h < 2 || box.x + box.w < 0 || box.y + box.h < 0 || box.x > vw || box.y > vh) continue;
    out.push({
      id: '',
      role,
      name: String(n.name?.value ?? '')
        .trim()
        .slice(0, 80),
      backendNodeId: n.backendDOMNodeId,
      ...box,
    });
  }
  let list = out;
  if (modal) {
    const inDialog = await Promise.all(out.map((c) => insideDialog(session, c.backendNodeId)));
    list = out.filter((_, i) => inDialog[i]);
  }
  list.sort((a, b) => a.y - b.y || a.x - b.x);
  return list.map((c, i) => ({ ...c, id: `e${i + 1}` }));
}

async function insideDialog(session: CDPSession, backendNodeId: number): Promise<boolean> {
  try {
    const { object } = (await session.send('DOM.resolveNode', { backendNodeId })) as any;
    const r = (await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function(){return !!this.closest("[role=dialog]")}',
      returnByValue: true,
    })) as any;
    return r.result.value === true;
  } catch {
    return false;
  }
}
export async function groundTruthId(session: CDPSession, backendNodeId: number): Promise<string | null> {
  try {
    const { object } = (await session.send('DOM.resolveNode', { backendNodeId })) as any;
    const r = (await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function(){const e=this.closest("[data-t]");return e?e.dataset.t:null}',
      returnByValue: true,
    })) as any;
    return r.result.value ?? null;
  } catch {
    return null;
  }
}
export async function screenshot(page: Page, clip?: Box, quality = 80): Promise<string> {
  const buf = await page.screenshot({
    type: 'jpeg',
    quality,
    scale: clip ? 'device' : 'css',
    ...(clip ? { clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } } : {}),
  });
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

export async function screenshotAt(page: Page, width: number, height: number): Promise<string> {
  const full = await screenshot(page);
  const size = page.viewportSize();
  if (size && size.width === width && size.height === height) return full;
  return page.evaluate(
    async ({ data, w, h }) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')?.drawImage(image, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.8);
    },
    { data: full, w: width, h: height },
  );
}
export async function marked(page: Page, cands: Candidate[]): Promise<string> {
  await page.evaluate(
    (cs) => {
      const root = document.createElement('div');
      root.id = '__marks';
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
      cs.forEach((c, i) => {
        const b = document.createElement('div');
        b.style.cssText = `position:fixed;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;outline:2px solid #ff1f8f;`;
        const l = document.createElement('div');
        l.textContent = String(i + 1);
        l.style.cssText = `position:fixed;left:${Math.max(0, c.x - 2)}px;top:${Math.max(0, c.y - 13)}px;background:#ff1f8f;color:#fff;font:700 11px/13px monospace;padding:0 3px;border-radius:3px;`;
        root.append(b, l);
      });
      document.body.append(root);
    },
    cands.map(({ x, y, w, h }) => ({ x, y, w, h })),
  );
  const img = await screenshot(page);
  await page.evaluate(() => document.getElementById('__marks')?.remove());
  return img;
}
export async function gridShot(page: Page, region: Box, n = 4): Promise<{ img: string; cells: Record<string, Box> }> {
  const cells: Record<string, Box> = {};
  const cw = region.w / n;
  const ch = region.h / n;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) cells[`${String.fromCharCode(65 + r)}${c + 1}`] = { x: region.x + c * cw, y: region.y + r * ch, w: cw, h: ch };
  await page.evaluate(
    ({ cells }) => {
      const root = document.createElement('div');
      root.id = '__grid';
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
      for (const [k, b] of Object.entries(cells) as [string, any][]) {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;outline:1px solid rgba(255,31,143,.9);`;
        const l = document.createElement('div');
        l.textContent = k;
        l.style.cssText = `position:fixed;left:${b.x + 2}px;top:${b.y + 2}px;background:rgba(255,31,143,.85);color:#fff;font:700 10px/12px monospace;padding:0 2px;border-radius:2px;`;
        root.append(d, l);
      }
      document.body.append(root);
    },
    { cells },
  );
  const img = await screenshot(page, region);
  await page.evaluate(() => document.getElementById('__grid')?.remove());
  return { img, cells };
}
export const playwrightScreen = (page: Page) => ({
  viewport: () => page.viewportSize() ?? { width: 1280, height: 800 },
  screenshot: (clip?: Box) => screenshot(page, clip),
  marked: (cands: Candidate[]) => marked(page, cands),
  gridShot: (region: Box, n?: number) => gridShot(page, region, n),
});

export async function playwrightDevice(page: Page): Promise<Device> {
  const session: CDPSession = await cdp(page);
  return {
    ...playwrightScreen(page),
    candidates: () => axCandidates(page, session),
    click: async (p) => {
      await page.mouse.click(p.x, p.y);
    },
    typeInto: async (c: Candidate, text: string) => {
      const p = center(c);
      await page.mouse.click(p.x, p.y);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type(text);
    },
    setValue: async (c: Candidate, value: string) => {
      const { object } = (await session.send('DOM.resolveNode', { backendNodeId: c.backendNodeId })) as any;
      const r = (await session.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function(v){
          const want = String(v).trim().toLowerCase();
          if (this.tagName === 'SELECT') {
            const o = [...this.options].find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want);
            if (!o) return false;
            this.value = o.value;
          } else { this.value = v; }
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }`,
        arguments: [{ value }],
        returnByValue: true,
      })) as any;
      return r.result.value === true;
    },
    settle: () => page.waitForTimeout(150),
  };
}
