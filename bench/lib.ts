import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { gatewayTransport, type Transport } from '../src/clef.ts';
import { readConfig, readToken } from '../src/credentials.ts';
import { mockTransport } from './mock.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const APP = `file://${join(ROOT, 'bench', 'fixtures', 'app.html')}`;
export const VIEWPORT = { width: 1280, height: 800 };

export interface ScreenSpec {
  screen: string;
  seed: number;
  theme: 'light' | 'dark';
  density: 'comfortable' | 'compact';
  accent: number;
  inj?: boolean;
  notoast?: boolean;
}
export const specKey = (s: ScreenSpec) => `${s.screen}-s${s.seed}-${s.theme[0]}${s.density === 'compact' ? 'k' : 'r'}${s.inj ? '-inj' : ''}`;
export const specUrl = (s: ScreenSpec) =>
  `${APP}?screen=${s.screen}&seed=${s.seed}&theme=${s.theme}&density=${s.density}&accent=${s.accent}${s.inj ? '&inj=1' : ''}`;

export const SCREENS = ['mail', 'settings', 'files', 'shop', 'dashboard', 'chat', 'people', 'editor'];

/** 3 variants per screen: light/comfortable, dark/compact, light/compact with a different accent. */
export function specs(): ScreenSpec[] {
  const out: ScreenSpec[] = [];
  SCREENS.forEach((screen, i) => {
    out.push({ screen, seed: 11 + i, theme: 'light', density: 'comfortable', accent: 0 });
    out.push({ screen, seed: 23 + i, theme: 'dark', density: 'compact', accent: 1 });
    out.push({ screen, seed: 37 + i, theme: 'light', density: 'compact', accent: 2 + (i % 2) });
  });
  return out;
}

let browser: Promise<Browser> | undefined;
/** One browser per process. Memoize the promise so concurrent callers never launch a second one. */
export function launch(): Promise<Browser> {
  browser ??= chromium.launch();
  return browser;
}
export async function close() {
  const b = browser;
  browser = undefined;
  await (await b)?.close();
}

/** Retina-like capture: 1280x800 CSS px at 2x, like a MacBook screen. */
export const RECORD_DIR = process.env.DO_RECORD;
const CLICK_LOG_SCRIPT = `
window.__doClicks = window.__doClicks || [];
addEventListener('pointerdown', (event) => { window.__doClicks.push({ at: Date.now(), x: event.clientX, y: event.clientY }); }, true);
`;
export async function open(spec: ScreenSpec): Promise<Page> {
  const b = await launch();
  const ctx = await b.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: RECORD_DIR ? 1 : 2,
    ...(RECORD_DIR ? { recordVideo: { dir: RECORD_DIR, size: VIEWPORT } } : {}),
  });
  if (RECORD_DIR) await ctx.addInitScript({ content: CLICK_LOG_SCRIPT });
  const pageCreatedAt = Date.now();
  const page = await ctx.newPage();
  recordingStart.set(page, pageCreatedAt);
  await page.goto(specUrl(spec));
  if (spec.notoast) await page.addStyleTag({ content: '#toast{display:none!important}' });
  await page.waitForTimeout(50);
  return page;
}

export type HudEvent = { atMs: number; title: string; status: string; detail?: string; tone?: 'run' | 'pass' | 'fail' };
const recordingStart = new WeakMap<Page, number>();
const hudEvents = new WeakMap<Page, HudEvent[]>();

export async function recordingLog(page: Page) {
  const start = recordingStart.get(page) ?? Date.now();
  const clicks = (await page
    .evaluate(() => (window as unknown as { __doClicks?: { at: number; x: number; y: number }[] }).__doClicks ?? [])
    .catch(() => [])) as { at: number; x: number; y: number }[];
  return { captions: hudEvents.get(page) ?? [], clicks: clicks.map((c) => ({ atMs: c.at - start, x: c.x, y: c.y })) };
}

export async function hud(page: Page, lines: Omit<HudEvent, 'atMs'>) {
  if (!RECORD_DIR) return;
  const events = hudEvents.get(page) ?? [];
  events.push({ atMs: Date.now() - (recordingStart.get(page) ?? Date.now()), ...lines });
  hudEvents.set(page, events);
}

export const MOCK = process.env.DO_MOCK === '1';
export const THINKING = process.env.DO_THINKING === '1';
export function limited(inner: Transport, n: number): Transport {
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = () => (active < n ? (active++, Promise.resolve()) : new Promise<void>((resume) => waiting.push(resume)));
  const release = () => {
    const resume = waiting.shift();
    if (resume) resume();
    else active--;
  };
  return async (id, body, signal) => {
    await acquire();
    try {
      return await inner(id, body, signal);
    } finally {
      release();
    }
  };
}

export const IN_FLIGHT = Number(process.env.DO_CONCURRENCY ?? 24);
export function transport(): Transport {
  if (MOCK) return limited(mockTransport(), IN_FLIGHT);
  const cfg = readConfig();
  return limited(gatewayTransport({ ...cfg, token: readToken() }), IN_FLIGHT);
}

export function runDir(test: string): string {
  const id = process.env.DO_RUN ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  process.env.DO_RUN = id;
  const dir = join(ROOT, 'bench', 'runs', `${id}${MOCK ? '-mock' : ''}`);
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, `${test}.jsonl`), { force: true });
  return join(dir, test);
}
export const jsonl = (path: string, rec: unknown) => appendFileSync(`${path}.jsonl`, `${JSON.stringify(rec)}\n`);
export const writeJson = (path: string, v: unknown) => writeFileSync(path, `${JSON.stringify(v, null, 2)}\n`);

export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T, i);
      }
    }),
  );
  return out;
}

export function auc(pos: number[], neg: number[]): number {
  if (!pos.length || !neg.length) return Number.NaN;
  let s = 0;
  for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
export const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
export function quantile(xs: number[], q: number) {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
}
