import { gatewayTransport } from '../src/clef.ts';
import { readConfig, readToken } from '../src/credentials.ts';
import { macosDevice } from '../src/devices/macos.ts';
import { Hand } from '../src/hand.ts';

const [app, ...intentWords] = process.argv.slice(2);
if (!app || !intentWords.length) throw new Error('usage: bun native/run.ts <app> <intent...>');
const transport = gatewayTransport({ ...readConfig(), token: readToken() });
const device = macosDevice({ helper: `${import.meta.dir}/ax`, app });
const hand = new Hand(transport, device, { model: 'clef', method: 'ax_text', tau: 0.3, riskTau: 0.5, injectionTau: 0.5, verify: true });
console.log(await hand.act(intentWords.join(' ')));
console.log(device.lastActions.join('\n'));
console.log(`$${hand.costUsd.toFixed(4)}`);
