import { expect, test } from 'bun:test';
import { checkRun, checkWriterRun } from './gate.ts';

const baseline = { run: 'b', arms: { relay: { minSuccess: 30, maxUsdPerTask: 0.002 } } };
const manifest = { run: 'b', mock: false, srcCommit: 'abc' };
const arm = (successMean: number, usdPerTask = 0.001) => ({ t4: { relay: { successMean, n: 30, usdPerTask, medianSecondsPerTask: 3 } } });

test('passes at the baseline', () => expect(checkRun(baseline, arm(30), manifest, true)).toEqual([]));
test('fails when success drops', () => expect(checkRun(baseline, arm(29), manifest, true)).toHaveLength(1));
test('fails when cost rises', () => expect(checkRun(baseline, arm(30, 0.01), manifest, true)).toHaveLength(1));
test('fails when src changed since the run', () => expect(checkRun(baseline, arm(30), manifest, false)[0]).toContain('rerun'));
test('fails on a mock run', () => expect(checkRun(baseline, arm(30), { ...manifest, mock: true }, true)).toHaveLength(1));
test('fails when an arm is missing', () => expect(checkRun(baseline, { t4: {} }, manifest, true)).toHaveLength(1));

const writerBaseline = { run: 'w', minCases: 40, writers: { glm: { minAccuracy: 0.9, maxUsdPerCase: 0.0001 } } };
const writer = (passed: number, n = 44, usdPerCase = 0.00006) => ({ writers: { glm: { n, passed, accuracy: passed / n, usdPerCase } } });

test('writer passes at its floor', () => expect(checkWriterRun(writerBaseline, writer(41), manifest, true)).toEqual([]));
test('writer fails below its accuracy floor', () => expect(checkWriterRun(writerBaseline, writer(38), manifest, true)).toHaveLength(1));
test('writer fails with too few cases', () => expect(checkWriterRun(writerBaseline, writer(30, 30), manifest, true)[0]).toContain('cases'));
test('writer fails when too expensive', () => expect(checkWriterRun(writerBaseline, writer(41, 44, 0.001), manifest, true)).toHaveLength(1));
test('writer fails when stale', () => expect(checkWriterRun(writerBaseline, writer(41), manifest, false)[0]).toContain('rerun'));
test('writer fails when missing', () => expect(checkWriterRun(writerBaseline, { writers: {} }, manifest, true)).toHaveLength(1));
