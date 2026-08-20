'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { LocalStorageProvider } = require('../lib/storage/providers/localStorageProvider');

test('LocalStorageProvider supports list/read/write/stat/exists/mkdir/rename/copy/delete', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-storage-provider-'));
	const provider = new LocalStorageProvider(tempRoot);

	await provider.mkdir('docs');
	await provider.write('docs/file.odt', Buffer.from('hello'));
	assert.equal(await provider.exists('docs/file.odt'), true);
	assert.equal((await provider.read('docs/file.odt', 'utf8')), 'hello');
	assert.equal((await provider.stat('docs/file.odt')).isFile(), true);

	await provider.copy('docs/file.odt', 'docs/file-copy.odt');
	assert.equal((await provider.read('docs/file-copy.odt', 'utf8')), 'hello');

	await provider.rename('docs/file-copy.odt', 'docs/file-renamed.odt');
	assert.equal(await provider.exists('docs/file-copy.odt'), false);
	assert.equal(await provider.exists('docs/file-renamed.odt'), true);

	const entries = await provider.list('docs');
	assert.ok(entries.some((entry) => entry.name === 'file.odt'));
	assert.ok(entries.some((entry) => entry.name === 'file-renamed.odt'));

	await provider.delete('docs/file-renamed.odt');
	assert.equal(await provider.exists('docs/file-renamed.odt'), false);
});

test('LocalStorageProvider rejects traversal paths', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-storage-provider-'));
	const provider = new LocalStorageProvider(tempRoot);
	await assert.rejects(() => provider.read('../../etc/passwd'), /invalid traversal|Absolute|escapes/i);
	await assert.rejects(() => provider.read('foo/../../etc/passwd'), /invalid traversal|Absolute|escapes/i);
	await assert.rejects(() => provider.read('/etc/passwd'), /Absolute|invalid|escapes/i);
	await assert.rejects(() => provider.read('foo\\..\\..\\etc\\passwd'), /invalid traversal|Absolute|escapes/i);
});

test('LocalStorageProvider blocks symlink escapes', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-storage-provider-'));
	const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-storage-provider-outside-'));
	const outsideFile = path.join(outsideRoot, 'secret.txt');
	await fs.writeFile(outsideFile, 'secret');

	const linkPath = path.join(tempRoot, 'escape-link');
	await fs.symlink(outsideRoot, linkPath);

	const provider = new LocalStorageProvider(tempRoot);
	await assert.rejects(() => provider.read('escape-link/secret.txt'), /escapes/i);
});

test('LocalStorageProvider enforces read-only mode', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-storage-provider-'));
	await fs.writeFile(path.join(tempRoot, 'doc.odt'), 'hello');
	const provider = new LocalStorageProvider(tempRoot, { readOnly: true });
	assert.equal((await provider.read('doc.odt', 'utf8')), 'hello');
	await assert.rejects(() => provider.write('doc2.odt', Buffer.from('x')), /read-only/i);
	await assert.rejects(() => provider.delete('doc.odt'), /read-only/i);
	await assert.rejects(() => provider.rename('doc.odt', 'renamed.odt'), /read-only/i);
	await assert.rejects(() => provider.copy('doc.odt', 'copy.odt'), /read-only/i);
	await assert.rejects(() => provider.mkdir('folder'), /read-only/i);
});
