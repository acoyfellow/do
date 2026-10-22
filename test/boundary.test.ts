import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]));

test('src never imports bench or playwright', () => {
  const offenders = filesUnder('src').filter((file) => /from ['"](\.\.\/bench|playwright)/.test(readFileSync(file, 'utf8')));
  expect(offenders).toEqual([]);
});
