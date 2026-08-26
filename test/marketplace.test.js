import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('declares an installable marketplace bundle', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const entryText = await readFile(new URL('marketplace-entry.yml', root), 'utf8');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.match(entryText, /^url: https:\/\/github\.com\/452926826\/dsh-feishu-bot$/m);
  assert.match(entryText, /^name: 452926826\/dsh-feishu-bot$/m);
  assert.match(entryText, /^category: remote$/m);
  assert.equal(pkg.repository.url, 'git+https://github.com/452926826/dsh-feishu-bot.git');
  assert.ok(pkg.keywords.includes('dsh-plugin'));
});
