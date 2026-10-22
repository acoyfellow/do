import { expect, test } from 'bun:test';
import { checkRun } from './gate.ts';

const baseline = { run: 'b', arms: { relay: { minSuccess: 30, maxUsdPerTask: 0.002 } } };
const manifest = { run: 'b', mock: false, srcCommit: 'abc' };
const arm = (successMean: number, usdPerTask = 0.001) => ({ t4: { relay: { successMean, n: 30, usdPerTask, medianSecondsPerTask: 3 } } });

test('passes at the baseline', () => expect(checkRun(baseline, arm(30), manifest, true)).toEqual([]));
test('fails when success drops', () => expect(checkRun(baseline, arm(29), manifest, true)).toHaveLength(1));
test('fails when cost rises', () => expect(checkRun(baseline, arm(30, 0.01), manifest, true)).toHaveLength(1));
test('fails when src changed since the run', () => expect(checkRun(baseline, arm(30), manifest, false)[0]).toContain('rerun'));
test('fails on a mock run', () => expect(checkRun(baseline, arm(30), { ...manifest, mock: true }, true)).toHaveLength(1));
test('fails when an arm is missing', () => expect(checkRun(baseline, { t4: {} }, manifest, true)).toHaveLength(1));
