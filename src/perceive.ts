export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Candidate extends Box {
  id: string; // e1, e2... stable within one perception pass
  role: string;
  name: string;
  backendNodeId: number;
}

export const describe = (c: Candidate) => `${c.role} "${c.name}"`;
export const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const inside = (p: { x: number; y: number }, b: Box, pad = 0) =>
  p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
