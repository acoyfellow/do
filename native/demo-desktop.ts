import { execFileSync, spawn } from 'node:child_process';
import { gatewayTransport } from '../src/clef.ts';
import { readConfig, readToken } from '../src/credentials.ts';
import { macosDevice } from '../src/devices/macos.ts';
import { Hand } from '../src/hand.ts';

const APP = 'Google Chrome';
const RECORD = process.argv.includes('--record');
const out = `${import.meta.dir}/../.demo/raw.mov`;
const helper = `${import.meta.dir}/ax`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const activeUrl = () => execFileSync('osascript', ['-e', 'tell application "Google Chrome" to get URL of active tab of front window'], { encoding: 'utf8' }).trim();

const log: { atMs: number; line: string }[] = [];
const started = Date.now();
const note = (line: string) => {
  log.push({ atMs: Date.now() - started, line });
  console.log(line);
};

const transport = gatewayTransport({ ...readConfig(), token: readToken() });
const device = macosDevice({ helper, app: APP });
const hand = new Hand(transport, device, { model: 'clef', method: 'ax_text', tau: 0.3, riskTau: 0.5, injectionTau: 0.5, verify: false });

const tabs = (await device.candidates()).filter((c) => c.role === 'radio').map((c) => c.name);
if (!tabs.some((t) => t.toLowerCase().includes('termlab'))) throw new Error(`no termlab tab in the front Chrome window: ${tabs.join(' | ')}`);

const RECORD_SECONDS = 30;
const recorder = RECORD ? spawn('screencapture', ['-v', '-V', String(RECORD_SECONDS), '-x', '-C', out], { stdio: 'ignore' }) : undefined;
await sleep(RECORD ? 1500 : 0);

async function step(label: string, run: () => Promise<string>, passed: (result: string) => boolean): Promise<void> {
  const result = await run();
  note(`${label} -> ${result}`);
  if (!passed(result)) {
    note(`STOPPED at ${label}. Device actions:\n  ${device.lastActions.join('\n  ')}`);
    throw new Error(`stopped at ${label}`);
  }
}

try {
  execFileSync(helper, ['activate', APP]);
  await sleep(800);
  await step(
    'act("switch to the termlab tab")',
    () => hand.act('switch to the termlab web terminal benchmark tab'),
    (r) => r.startsWith('Clicked') && activeUrl().includes('termlab'),
  );
  await sleep(1200);
  await step(
    'type("coey.dev", "address bar")',
    () => hand.type('coey.dev', 'the address and search bar'),
    (r) => r.startsWith('Typed'),
  );
  await sleep(500);
  const address = (await device.candidates()).find((c) => c.name.startsWith('Address and search bar'));
  await step(
    'submit address bar',
    async () => String(address ? await device.submit(address) : false),
    (r) => r === 'true',
  );
  await sleep(3500);
  await step('page is coey.dev', async () => activeUrl(), (url) => /^https:\/\/coey\.dev\/?$/.test(url));
  note(`look("is coey.dev open?") -> ${await hand.look('Is the coey.dev website open in the browser?')}`);
  note(`device actions:\n  ${device.lastActions.join('\n  ')}`);
  note(`total $${hand.costUsd.toFixed(4)}`);
} finally {
  if (recorder) await new Promise((resolve) => recorder.on('close', resolve));
  await Bun.write(`${import.meta.dir}/../.demo/run.log.json`, JSON.stringify(log, null, 2));
}
