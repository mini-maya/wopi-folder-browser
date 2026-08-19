'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { deleteDocument, listDocuments } = require('../lib/documentStore');
const { getCachedThumbnail, resolveThumbnailAbsolutePath, storeThumbnail } = require('../lib/previewStore');
const {
	addRecycledEntry,
	deleteRecycledEntry,
	getRecycledStatePath,
	listRecycledEntries,
	loadRecycledState,
	removeRecycledEntry,
	restoreRecycledEntry,
	updateRecycledEntry
} = require('../lib/recycleStore');
const { appendActivity, listActivity } = require('../lib/activityStore');
const { loadUserState } = require('../lib/userStateStore');
const { createVersionSnapshot, getVersionEntry } = require('../lib/versionStore');

const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y8h8AAAAASUVORK5CYII=',
	'base64'
);

test('recycle state is stored under the current document context root', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-recycle-store-'));
	const sharedRoot = path.join(tempRoot, 'shared');
	const personalRoot = path.join(tempRoot, 'users', 'user-7');
	const previousValue = process.env.WOPI_STATE_ROOT;
	process.env.WOPI_STATE_ROOT = path.join(tempRoot, 'state-root');

	try {
		assert.equal(getRecycledStatePath(sharedRoot), path.join(process.env.WOPI_STATE_ROOT, 'shared', 'recycled.json'));
		assert.equal(getRecycledStatePath(personalRoot), path.join(process.env.WOPI_STATE_ROOT, 'users', 'user-7', 'recycled.json'));
	} finally {
		if (previousValue === undefined) {
			delete process.env.WOPI_STATE_ROOT;
		} else {
			process.env.WOPI_STATE_ROOT = previousValue;
		}
	}
});

test('addRecycledEntry keeps multiple entries with the same file name', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-recycle-store-'));

	const firstEntry = await addRecycledEntry(tempRoot, {
		fileId: 'file-a',
		originalName: 'Test.ods',
		originalPath: 'users/alice/Test.ods',
		context: 'personal',
		versionId: 'v1'
	});
	const secondEntry = await addRecycledEntry(tempRoot, {
		fileId: 'file-b',
		originalName: 'Test.ods',
		originalPath: 'shared/Test.ods',
		context: 'shared',
		versionId: 'v2'
	});

	const entries = await listRecycledEntries(tempRoot);
	assert.equal(entries.length, 2);
	assert.equal(entries[0].id, secondEntry.id);
	assert.equal(entries[1].id, firstEntry.id);
	assert.equal(entries[0].originalName, 'Test.ods');
	assert.equal(entries[1].originalName, 'Test.ods');
	assert.notEqual(entries[0].id, entries[1].id);
	assert.notEqual(entries[0].fileId, entries[1].fileId);
});

test('updateRecycledEntry and removeRecycledEntry modify the recycle list', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-recycle-store-'));

	const created = await addRecycledEntry(tempRoot, {
		fileId: 'file-c',
		originalName: 'report.odt',
		originalPath: 'report.odt',
		context: 'shared'
	});

	const updated = await updateRecycledEntry(tempRoot, created.id, {
		originalName: 'renamed-report.odt',
		versionId: 'v3',
		versionPath: '/snapshots/v3.odt'
	});
	assert.ok(updated);
	assert.equal(updated.originalName, 'renamed-report.odt');
	assert.equal(updated.versionId, 'v3');
	assert.equal(updated.versionPath, '/snapshots/v3.odt');

	const loadedState = await loadRecycledState(tempRoot);
	assert.equal(loadedState.entries[0].originalName, 'renamed-report.odt');

	const removed = await removeRecycledEntry(tempRoot, created.id);
	assert.equal(removed, true);
	assert.deepEqual(await listRecycledEntries(tempRoot), []);
});

test('deleteRecycledEntry removes the recycled snapshot and preview artifacts', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-recycle-store-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const [document] = await listDocuments(tempRoot);
	const firstVersion = await createVersionSnapshot(tempRoot, document, { id: 'user-1', name: 'User One' });
	const secondVersion = await createVersionSnapshot(tempRoot, document, { id: 'user-1', name: 'User One' });
	await storeThumbnail(tempRoot, {
		fileId: document.id,
		version: document.version,
		relativePath: document.relativePath,
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});

	await deleteDocument(tempRoot, document.id, {
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal'
	});

	const recycledEntry = (await listRecycledEntries(tempRoot))[0];
	assert.ok(recycledEntry);
	assert.ok(await getCachedThumbnail(tempRoot, document.id, document.version));

	await appendActivity(tempRoot, {
		type: 'open',
		fileId: document.id,
		fileName: 'report.odt',
		userId: 'user-1',
		userName: 'User One'
	});
	const usersDirectory = path.join(tempRoot, '.wopi-state', 'common', 'users');
	await fs.mkdir(usersDirectory, { recursive: true });
	await fs.writeFile(path.join(usersDirectory, 'user-1.json'), JSON.stringify({
		favorites: [document.id],
		recent: [{ fileId: document.id, openedAt: new Date().toISOString() }]
	}));

	const deleted = await deleteRecycledEntry(tempRoot, recycledEntry.id);
	assert.equal(deleted, true);
	assert.deepEqual(await listRecycledEntries(tempRoot), []);
	assert.equal(await getCachedThumbnail(tempRoot, document.id, document.version), null);
	assert.equal(await resolveThumbnailAbsolutePath(tempRoot, document.id, document.version), null);
	await assert.rejects(() => getVersionEntry(tempRoot, document.id, firstVersion.id), /Version not found/);
	await assert.rejects(() => getVersionEntry(tempRoot, document.id, secondVersion.id), /Version not found/);
	await assert.rejects(() => getVersionEntry(tempRoot, document.id, recycledEntry.versionId), /Version not found/);
	assert.deepEqual((await listActivity(tempRoot)).filter((entry) => entry.fileId === document.id), []);
	assert.deepEqual((await loadUserState(tempRoot, 'user-1')).favorites, []);
	assert.deepEqual((await loadUserState(tempRoot, 'user-1')).recent, []);
});

test('restoreRecycledEntry recreates the document at the original path', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-recycle-store-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const [document] = await listDocuments(tempRoot);
	await storeThumbnail(tempRoot, {
		fileId: document.id,
		version: document.version,
		relativePath: document.relativePath,
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});
	await deleteDocument(tempRoot, document.id, {
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal'
	});

	const recycledEntry = (await listRecycledEntries(tempRoot))[0];
	const restored = await restoreRecycledEntry(tempRoot, recycledEntry.id);

	assert.ok(restored.restored);
	assert.equal(restored.relativePath, 'report.odt');
	assert.equal(await fs.readFile(path.join(tempRoot, 'report.odt'), 'utf8'), 'report');
	assert.equal((await listRecycledEntries(tempRoot)).length, 0);
	assert.equal(await getCachedThumbnail(tempRoot, document.id, document.version), null);
	assert.equal(await resolveThumbnailAbsolutePath(tempRoot, document.id, document.version), null);
	await assert.rejects(() => getVersionEntry(tempRoot, document.id, recycledEntry.versionId), /Version not found/);
});

test('restoreRecycledEntry reports a conflict when the original path is occupied and no resolution is provided', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-recycle-store-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const [document] = await listDocuments(tempRoot);
	await storeThumbnail(tempRoot, {
		fileId: document.id,
		version: document.version,
		relativePath: document.relativePath,
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});
	await deleteDocument(tempRoot, document.id, {
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal'
	});
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'occupied');

	const recycledEntry = (await listRecycledEntries(tempRoot))[0];
	const result = await restoreRecycledEntry(tempRoot, recycledEntry.id);

	assert.equal(result.conflict, true);
	assert.equal(result.source.id, recycledEntry.id);
	assert.equal(await fs.readFile(path.join(tempRoot, 'report.odt'), 'utf8'), 'occupied');
	assert.equal((await listRecycledEntries(tempRoot)).length, 1);
});

test('restoreRecycledEntry overwrites the existing file when the original path is occupied and overwrite is chosen', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-recycle-store-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const [document] = await listDocuments(tempRoot);
	await storeThumbnail(tempRoot, {
		fileId: document.id,
		version: document.version,
		relativePath: document.relativePath,
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});
	await deleteDocument(tempRoot, document.id, {
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal'
	});
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'occupied');

	const recycledEntry = (await listRecycledEntries(tempRoot))[0];
	const existingTargetBeforeRestore = (await listDocuments(tempRoot)).find((item) => item.relativePath === 'report.odt');
	const restored = await restoreRecycledEntry(tempRoot, recycledEntry.id, { conflictResolution: 'overwrite' });

	assert.equal(restored.restored, true);
	assert.equal(restored.fileId, document.id);
	assert.equal(restored.relativePath, 'report.odt');
	assert.equal(await fs.readFile(path.join(tempRoot, 'report.odt'), 'utf8'), 'report');
	assert.equal((await listRecycledEntries(tempRoot)).length, 1);
	assert.equal((await listRecycledEntries(tempRoot))[0].fileId, existingTargetBeforeRestore.id);
	assert.equal(await getCachedThumbnail(tempRoot, document.id, document.version), null);
	assert.equal(await resolveThumbnailAbsolutePath(tempRoot, document.id, document.version), null);
	await assert.rejects(() => getVersionEntry(tempRoot, document.id, recycledEntry.versionId), /Version not found/);
});

test('restoreRecycledEntry keeps both copies when the original path is occupied', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-recycle-store-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const [document] = await listDocuments(tempRoot);
	await storeThumbnail(tempRoot, {
		fileId: document.id,
		version: document.version,
		relativePath: document.relativePath,
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});
	await deleteDocument(tempRoot, document.id, {
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal'
	});
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'occupied');

	const recycledEntry = (await listRecycledEntries(tempRoot))[0];
	const restored = await restoreRecycledEntry(tempRoot, recycledEntry.id, { conflictResolution: 'keep_both' });

	assert.equal(restored.restored, true);
	assert.match(restored.relativePath, /^report( \(\d+\))?\.odt$/);
	assert.equal(await fs.readFile(path.join(tempRoot, restored.relativePath), 'utf8'), 'report');
	assert.equal(await fs.readFile(path.join(tempRoot, 'report.odt'), 'utf8'), 'occupied');
	assert.equal(await getCachedThumbnail(tempRoot, document.id, document.version), null);
	assert.equal(await resolveThumbnailAbsolutePath(tempRoot, document.id, document.version), null);
	await assert.rejects(() => getVersionEntry(tempRoot, document.id, recycledEntry.versionId), /Version not found/);
});
