import { execFileSync } from 'node:child_process';
import { gatewayTransport } from '../src/clef.ts';
import { readConfig, readToken } from '../src/credentials.ts';
import { macosDevice } from '../src/devices/macos.ts';
import { Hand } from '../src/hand.ts';

const APP = 'Google Chrome';
const helper = `${import.meta.dir}/ax`;
const activeUrl = () => execFileSync('osascript', ['-e', 'tell application "Google Chrome" to get URL of active tab of front window'], { encoding: 'utf8' }).trim();

execFileSync(helper, ['activate', APP]);
await new Promise((resolve) => setTimeout(resolve, 600));
const before = activeUrl();
const transport = gatewayTransport({ ...readConfig(), token: readToken() });
const device = macosDevice({ helper, app: APP });
const hand = new Hand(transport, device, { model: 'clef', method: 'ax_text', tau: 0.3, riskTau: 0.5, injectionTau: 0.5, verify: false });
console.log(await hand.type('coey.dev', 'the address and search bar'));
const address = (await device.candidates()).find((c) => c.name.startsWith('Address and search bar'));
console.log('submit', address ? await device.submit(address) : 'no address bar');
await new Promise((resolve) => setTimeout(resolve, 3000));
const after = activeUrl();
console.log(device.lastActions.join('\n'));
console.log(`url before: ${before}\nurl after:  ${after}\n${after.includes('coey.dev') && !after.includes('termlab') ? 'PASS' : 'FAIL'}`);
