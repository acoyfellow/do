import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Device } from '../hand.ts';
import { type Box, type Candidate, inside } from '../perceive.ts';

const run = promisify(execFile);

interface AxNode {
  id: string;
  role: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  path: number[];
}
interface AxSnapshot {
  app: string;
  candidates: AxNode[];
}
interface AxOutcome {
  ok: boolean;
  detail: string;
}

const ROLE_NAMES: Record<string, string> = {
  AXButton: 'button',
  AXLink: 'link',
  AXTextField: 'textbox',
  AXTextArea: 'textbox',
  AXSearchField: 'searchbox',
  AXCheckBox: 'checkbox',
  AXRadioButton: 'radio',
  AXPopUpButton: 'combobox',
  AXComboBox: 'combobox',
  AXMenuItem: 'menuitem',
  AXMenuButton: 'button',
  AXTab: 'tab',
  AXSlider: 'slider',
  AXIncrementor: 'spinbutton',
  AXDisclosureTriangle: 'button',
  AXSwitch: 'switch',
};

export interface MacosDeviceOptions {
  readonly helper: string;
  readonly app?: string;
  readonly display?: { width: number; height: number };
  readonly allowMouse?: boolean;
}

export interface MacosCandidate extends Candidate {
  readonly path: string;
}

export function toCandidate(node: AxNode, index: number): MacosCandidate {
  return {
    id: node.id,
    role: ROLE_NAMES[node.role] ?? node.role.replace(/^AX/, '').toLowerCase(),
    name: node.name.replace(/\s+/g, ' ').trim(),
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    backendNodeId: index,
    path: node.path.join('.'),
  };
}

export function keepUseful(cands: MacosCandidate[]): MacosCandidate[] {
  const seen = new Set<string>();
  return cands.filter((c) => {
    if (!c.name && c.role !== 'textbox' && c.role !== 'searchbox') return false;
    const key = `${c.role}|${c.name}|${Math.round(c.x)}|${Math.round(c.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function smallestContaining(cands: MacosCandidate[], p: { x: number; y: number }): MacosCandidate | undefined {
  return cands.filter((c) => inside(p, c)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
}

export function macosDevice(opts: MacosDeviceOptions): Device & { lastActions: string[] } {
  const appArg = opts.app ?? '-';
  let last: MacosCandidate[] = [];
  const lastActions: string[] = [];
  const helper = async <T>(...args: string[]): Promise<T> => JSON.parse((await run(opts.helper, args, { maxBuffer: 64 * 1024 * 1024 })).stdout) as T;

  const capture = async (clip?: Box): Promise<string> => {
    const dir = mkdtempSync(join(tmpdir(), 'do-shot-'));
    const file = join(dir, 'shot.jpg');
    try {
      const region = clip ? ['-R', `${Math.round(clip.x)},${Math.round(clip.y)},${Math.round(clip.w)},${Math.round(clip.h)}`] : [];
      await run('screencapture', ['-x', '-t', 'jpg', ...region, file]);
      await run('sips', ['-Z', '1600', file]);
      return `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const press = async (c: MacosCandidate): Promise<boolean> => {
    const outcome = await helper<AxOutcome>('press', appArg, c.path).catch(() => ({ ok: false, detail: 'press failed' }));
    lastActions.push(`press ${c.role} "${c.name}": ${outcome.detail}`);
    return outcome.ok;
  };

  return {
    lastActions,
    viewport: () => opts.display ?? { width: 1728, height: 1117 },
    screenshot: (clip) => capture(clip),
    marked: () => capture(),
    gridShot: async (region) => ({ img: await capture(region), cells: { a1: region } }),
    candidates: async () => {
      const snap = await helper<AxSnapshot>('snapshot', appArg);
      last = keepUseful(snap.candidates.map(toCandidate));
      return last;
    },
    press: async (c) => {
      const target = c as MacosCandidate;
      if (await press(target)) return;
      if (!opts.allowMouse) throw new Error(`${target.role} "${target.name}" has no accessibility press action and mouse input is off`);
      const p = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
      const outcome = await helper<AxOutcome>('click', String(p.x), String(p.y));
      lastActions.push(`mouse ${outcome.detail}`);
    },
    click: async (p) => {
      const target = smallestContaining(last, p);
      if (target && (await press(target))) return;
      if (!opts.allowMouse) throw new Error(`no accessibility action for the control at ${Math.round(p.x)},${Math.round(p.y)} and mouse input is off`);
      const outcome = await helper<AxOutcome>('click', String(p.x), String(p.y));
      lastActions.push(`mouse ${outcome.detail}`);
    },
    typeInto: async (c, text) => {
      const target = c as MacosCandidate;
      const outcome = await helper<AxOutcome>('set', appArg, target.path, text);
      lastActions.push(`set ${target.role} "${target.name}": ${outcome.detail}`);
      if (!outcome.ok) throw new Error(`could not set text: ${outcome.detail}`);
    },
    setValue: async (c, value) => {
      const target = c as MacosCandidate;
      const outcome = await helper<AxOutcome>('set', appArg, target.path, value);
      lastActions.push(`set ${target.role} "${target.name}": ${outcome.detail}`);
      return outcome.ok;
    },
    settle: () => new Promise((resolve) => setTimeout(resolve, 400)),
  };
}
