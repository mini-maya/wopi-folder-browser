'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	createDocument,
	createLegacyFileId,
	createFolder,
	getAvailableName,
	getDocumentById,
	listDocuments,
	pruneMissingDocumentEntries,
	uploadDocuments
} = require('../lib/documentStore');
const { getCachedThumbnail, resolveThumbnailAbsolutePath, storeThumbnail } = require('../lib/previewStore');
const { getCommonStateRoot, getContextStateRoot, getStateRoot } = require('../lib/statePaths');
const { createVersionSnapshot, getVersionEntry } = require('../lib/versionStore');

const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y8h8AAAAASUVORK5CYII=',
	'base64'
);

test('listDocuments returns folders and supported files recursively', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.mkdir(path.join(tempRoot, 'nested'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'demo.docx'), 'demo');
	await fs.writeFile(path.join(tempRoot, 'nested', 'sheet.xlsx'), 'sheet');
	await fs.writeFile(path.join(tempRoot, 'notes.md'), '# ignored');

	const documents = await listDocuments(tempRoot);
	const relativePaths = documents.map(function(document) {
		return document.relativePath;
	});

	assert.deepEqual(relativePaths, ['demo.docx', 'nested', 'nested/sheet.xlsx']);
	assert.equal(documents[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
	assert.equal(documents[1].isDirectory, true);
});

test('listDocuments keeps registry entries visible when files are missing on disk', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'present.odt'), 'present');
	const stateRoot = getContextStateRoot(tempRoot);
	await fs.mkdir(stateRoot, { recursive: true });
	await fs.writeFile(path.join(stateRoot, 'file-registry.json'), JSON.stringify({
		entries: {
			'missing-file-id': 'missing-folder/missing.odt'
		}
	}, null, 2), 'utf8');

	const documents = await listDocuments(tempRoot);
	const missingEntry = documents.find((document) => document.id === 'missing-file-id');
	assert.ok(missingEntry);
	assert.equal(missingEntry.isMissingOnDisk, true);
	assert.equal(missingEntry.relativePath, 'missing-folder/missing.odt');
	assert.equal(missingEntry.isDirectory, false);
	assert.equal(missingEntry.mimeType, 'application/vnd.oasis.opendocument.text');
});

test('pruneMissingDocumentEntries removes missing registry-only entries', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'present.odt'), 'present');
	const stateRoot = getContextStateRoot(tempRoot);
	await fs.mkdir(stateRoot, { recursive: true });
	await fs.writeFile(path.join(stateRoot, 'file-registry.json'), JSON.stringify({
		entries: {
			'present-file-id': 'present.odt',
			'missing-file-id': 'missing-folder/missing.odt'
		}
	}, null, 2), 'utf8');

	const result = await pruneMissingDocumentEntries(tempRoot);
	assert.equal(result.removed, true);
	assert.equal(result.missingEntryCount, 1);
	assert.deepEqual(result.removedFileIds, ['missing-file-id']);

	const registry = JSON.parse(await fs.readFile(path.join(stateRoot, 'file-registry.json'), 'utf8'));
	assert.deepEqual(registry.entries, {
		'present-file-id': 'present.odt'
	});
});

test('getDocumentById resolves a supported document from its file id', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const listedDocuments = await listDocuments(tempRoot);
	const document = await getDocumentById(tempRoot, listedDocuments[0].id);

	assert.equal(document.name, 'report.odt');
	assert.equal(document.relativePath, 'report.odt');
	assert.match(document.version, /^\d+-\d+$/);
});

test('getDocumentById rejects traversal-like file ids', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));

	await assert.rejects(function() {
		return getDocumentById(tempRoot, createLegacyFileId('../secret.txt'));
	}, /(invalid document path|unknown)/);
});

test('uploadDocuments stores supported files and preserves dropped folder structure', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await createFolder(tempRoot, { folderName: 'inbox' });

	const result = await uploadDocuments(tempRoot, {
		directory: 'inbox',
		files: [
			{ fileName: 'report.docx', relativePath: 'report.docx', content: Buffer.from('report') },
			{ fileName: 'sheet.xlsx', relativePath: 'quarterly/sheet.xlsx', content: Buffer.from('sheet') }
		]
	});

	assert.equal(result.errors.length, 0);
	assert.deepEqual(
		result.uploadedDocuments.map((document) => document.relativePath),
		['inbox/report.docx', 'inbox/quarterly/sheet.xlsx']
	);

	const listedDocuments = await listDocuments(tempRoot);
	assert.ok(listedDocuments.some((entry) => entry.relativePath === 'inbox/report.docx'));
	assert.ok(listedDocuments.some((entry) => entry.relativePath === 'inbox/quarterly'));
	assert.ok(listedDocuments.some((entry) => entry.relativePath === 'inbox/quarterly/sheet.xlsx'));
});

test('uploadDocuments skips unsupported and conflicting files while keeping supported ones', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'existing.odt'), 'existing');

	const result = await uploadDocuments(tempRoot, {
		files: [
			{ fileName: 'existing.odt', relativePath: 'existing.odt', content: Buffer.from('new content') },
			{ fileName: 'notes.txt', relativePath: 'folder/notes.txt', content: Buffer.from('notes') },
			{ fileName: 'photo.jpg', relativePath: 'folder/photo.jpg', content: Buffer.from('image') }
		]
	});

	assert.deepEqual(
		result.uploadedDocuments.map((document) => document.relativePath),
		['folder/notes.txt']
	);
	assert.deepEqual(
		result.errors.map((entry) => [entry.relativePath, entry.message]),
		[
			['existing.odt', 'The target path already exists.'],
			['folder/photo.jpg', 'The file type is not supported.']
		]
	);
});

test('uploadDocuments rejects an unknown target folder', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));

	await assert.rejects(function() {
		return uploadDocuments(tempRoot, {
			directory: 'missing-folder',
			files: [
				{ fileName: 'report.odt', relativePath: 'report.odt', content: Buffer.from('report') }
			]
		});
	}, /The target folder does not exist/);
});

test('getContextStateRoot namespaces mount state under mounts/<hash>', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-state-root-test');
	const customStateRoot = path.join(tempRoot, 'state-root');
	const previousValue = process.env.WOPI_STATE_ROOT;
	process.env.WOPI_STATE_ROOT = customStateRoot;

	try {
		const contextStateRoot = getContextStateRoot(tempRoot);
		assert.match(contextStateRoot, new RegExp(`${customStateRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${path.sep}mounts${path.sep}`));
	} finally {
		if (previousValue === undefined) {
			delete process.env.WOPI_STATE_ROOT;
		} else {
			process.env.WOPI_STATE_ROOT = previousValue;
		}
	}
});

test('getContextStateRoot returns distinct namespaces for different mount roots', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-user-state-root-test');
	const customStateRoot = path.join(tempRoot, 'state-root');
	const mountOneRoot = path.join(tempRoot, 'mount-one');
	const mountTwoRoot = path.join(tempRoot, 'mount-two');
	const previousValue = process.env.WOPI_STATE_ROOT;
	process.env.WOPI_STATE_ROOT = customStateRoot;

	try {
		assert.notEqual(getContextStateRoot(mountOneRoot), getContextStateRoot(mountTwoRoot));
	} finally {
		if (previousValue === undefined) {
			delete process.env.WOPI_STATE_ROOT;
		} else {
			process.env.WOPI_STATE_ROOT = previousValue;
		}
	}
});

test('getCommonStateRoot keeps app-global state under common', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-common-state-root-test');
	const customStateRoot = path.join(tempRoot, 'state-root');
	const previousValue = process.env.WOPI_STATE_ROOT;
	process.env.WOPI_STATE_ROOT = customStateRoot;

	try {
		assert.equal(getCommonStateRoot(tempRoot), path.join(customStateRoot, 'common'));
	} finally {
		if (previousValue === undefined) {
			delete process.env.WOPI_STATE_ROOT;
		} else {
			process.env.WOPI_STATE_ROOT = previousValue;
		}
	}
});

test('getStateRoot honors an explicit WOPI_STATE_ROOT override', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-state-override-test');
	const previousValue = process.env.WOPI_STATE_ROOT;
	const customStateRoot = path.join(tempRoot, 'state-root');
	process.env.WOPI_STATE_ROOT = customStateRoot;

	try {
		const resolvedRoot = getStateRoot(tempRoot);
		assert.equal(resolvedRoot, path.resolve(customStateRoot));
	} finally {
		if (previousValue === undefined) {
			delete process.env.WOPI_STATE_ROOT;
		} else {
			process.env.WOPI_STATE_ROOT = previousValue;
		}
	}
});
