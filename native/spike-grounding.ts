import { execFileSync } from 'node:child_process';
import { Effect } from 'effect';
import { gatewayTransport } from '../src/clef.ts';
import { ask } from '../src/clef.ts';
import { readConfig, readToken } from '../src/credentials.ts';

type Node = { id: string; role: string; name: string; x: number; y: number; w: number; h: number };
type Intent = { app: string; intent: string; expect: (n: Node) => boolean };

const INTENTS: Intent[] = [
  { app: 'Google Chrome', intent: 'go back to the previous page', expect: (n) => n.role === 'AXButton' && n.name === 'Back' },
  { app: 'Google Chrome', intent: 'type a new web address', expect: (n) => n.role === 'AXTextField' && n.name.startsWith('Address') },
  { app: 'Google Chrome', intent: 'refresh this page', expect: (n) => n.name === 'Reload' },
  { app: 'Google Chrome', intent: 'save this page to bookmarks', expect: (n) => n.name.startsWith('Bookmark this') },
  { app: 'Google Chrome', intent: 'open a fresh empty tab', expect: (n) => n.name === 'New Tab' },
  { app: 'Google Chrome', intent: 'find a tab by searching open tabs', expect: (n) => n.name === 'Tab search' },
  { app: 'Google Chrome', intent: 'show the browser extensions', expect: (n) => n.name === 'Extensions' },
  { app: 'Google Chrome', intent: 'switch to the termlab benchmark tab', expect: (n) => n.role === 'AXRadioButton' && n.name.toLowerCase().includes('termlab') },
  { app: 'Notes', intent: 'start writing a new note', expect: (n) => /new note|compose/i.test(n.name) },
  { app: 'Notes', intent: 'look for a note by text', expect: (n) => /search/i.test(n.name) || n.role === 'AXSearchField' },
  { app: 'Finder', intent: 'tag the selected file red', expect: (n) => n.name.includes('Red') },
  { app: 'Finder', intent: 'open the tag editor', expect: (n) => n.name.startsWith('Tags') },
];

const dump = (app: string): Node[] => JSON.parse(execFileSync(`${import.meta.dir}/ax-dump`, [app], { encoding: 'utf8' })).candidates;
const describe = (n: Node) => `${n.role.replace(/^AX/, '').toLowerCase()} "${n.name.replace(/\s+/g, ' ').slice(0, 80)}"`;

function shortlist(nodes: Node[]): Node[] {
  const seen = new Set<string>();
  return nodes.filter((n) => {
    if (!n.name || n.role === 'AXCell' || n.role === 'AXRow') return false;
    const key = `${describe(n)}@${Math.round(n.x)},${Math.round(n.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const transport = gatewayTransport({ ...readConfig(), token: readToken() });
let correct = 0;
let total = 0;
let spend = 0;
const cache = new Map<string, Node[]>();
for (const item of INTENTS) {
  const nodes = cache.get(item.app) ?? shortlist(dump(item.app));
  cache.set(item.app, nodes);
  if (!nodes.some(item.expect)) {
    console.log(`SKIP ${item.app}: "${item.intent}" (target not on screen)`);
    continue;
  }
  const options = Object.fromEntries(nodes.slice(0, 250).map((n) => [n.id, describe(n)]));
  const res = await Effect.runPromise(
    ask(transport, { model: 'clef', state: { app: item.app, intent: item.intent }, questions: { target: { type: 'choice', instructions: 'Which control on screen does `intent` refer to?', criteria: options } } }),
  );
  spend += res.costUsd;
  const answer = res.answers.target;
  const picked = answer?.type === 'choice' ? nodes.find((n) => n.id === answer.choice) : undefined;
  const ok = Boolean(picked && item.expect(picked));
  total++;
  if (ok) correct++;
  console.log(`${ok ? 'OK  ' : 'MISS'} ${item.app}: "${item.intent}" -> ${picked ? describe(picked) : 'none'} p=${answer?.type === 'choice' ? answer.probabilities[answer.choice]?.toFixed(2) : '?'} (${Object.keys(options).length} options)`);
}
console.log(`\n${correct}/${total} correct, $${spend.toFixed(4)}`);
