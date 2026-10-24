import { execFileSync, spawn } from 'node:child_process';
import { gatewayTransport } from '../src/clef.ts';
import { readConfig, readToken } from '../src/credentials.ts';
import { macosDevice } from '../src/devices/macos.ts';
import { Hand } from '../src/hand.ts';

const APP = 'Google Chrome';
const out = process.argv[2] ?? `${import.meta.dir}/../.demo/raw.mov`;
const helper = `${import.meta.dir}/ax`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RECORD_SECONDS = 40;
const recorder = spawn('screencapture', ['-v', '-V', String(RECORD_SECONDS), '-x', '-C', out], { stdio: 'ignore' });
await sleep(1500);

const transport = gatewayTransport({ ...readConfig(), token: readToken() });
const device = macosDevice({ helper, app: APP });
const hand = new Hand(transport, device, { model: 'clef', method: 'ax_text', tau: 0.3, riskTau: 0.5, injectionTau: 0.5, verify: false });
const log: { atMs: number; line: string }[] = [];
const started = Date.now();
const note = (line: string) => {
  log.push({ atMs: Date.now() - started, line });
  console.log(line);
};

execFileSync(helper, ['activate', APP]);
await sleep(800);
note(`act("switch to the termlab benchmark tab") -> ${await hand.act('switch to the termlab web terminal benchmark tab')}`);
await sleep(1200);
note(`type("coey.dev", "address bar") -> ${await hand.type('coey.dev', 'the address and search bar')}`);
await sleep(600);
execFileSync(helper, ['key', 'return']);
note('key return');
await sleep(3500);
note(`look("is coey.dev open?") -> ${await hand.look('Is the coey.dev website open in the browser?')}`);
await sleep(1000);
note(`device actions:\n  ${device.lastActions.join('\n  ')}`);
note(`total $${hand.costUsd.toFixed(4)}`);

await new Promise((resolve) => recorder.on('close', resolve));
await Bun.write(out.replace(/\.mov$/, '.log.json'), JSON.stringify(log, null, 2));
