'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function clearRepositoryModules() {
	for (const cacheKey of Object.keys(require.cache)) {
		if (cacheKey.includes(`${path.sep}wopi-folder-browser${path.sep}`)) {
			delete require.cache[cacheKey];
		}
	}
}

async function withEnv(overrides, fn) {
	const previous = {};
	for (const key of Object.keys(overrides)) {
		previous[key] = process.env[key];
		if (overrides[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = overrides[key];
		}
	}
	clearRepositoryModules();
	try {
		return await fn();
	} finally {
		for (const key of Object.keys(overrides)) {
			if (previous[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = previous[key];
			}
		}
		clearRepositoryModules();
	}
}

test('activity log is pruned by age but always keeps the newest entry', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-retention-activity-age-'));
	try {
		await withEnv({ WOPI_STATE_ROOT: tempRoot, ACTIVITY_MAX_AGE_DAYS: '1', ACTIVITY_MAX_COUNT: '100' }, async function() {
			const { appendActivity, listActivity } = require('../lib/activityStore');
			const documentRoot = path.join(tempRoot, 'documents');
			await fs.mkdir(documentRoot, { recursive: true });

			// Manually seed an old activities.json entry beyond the age limit.
			const { getContextStateRoot } = require('../lib/statePaths');
			const stateDir = getContextStateRoot(documentRoot);
			await fs.mkdir(stateDir, { recursive: true });
			const oldEntry = {
				id: 'old-entry',
				createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
				type: 'upload',
				fileId: 'a'
			};
			await fs.writeFile(path.join(stateDir, 'activities.json'), JSON.stringify([oldEntry]));

			await appendActivity(documentRoot, { type: 'upload', fileId: 'b' });
			const items = await listActivity(documentRoot, 50);
			assert.equal(items.length, 1);
			assert.equal(items[0].fileId, 'b');
		});
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});

test('activity log always keeps the newest entry even if older than the retention window', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-retention-activity-newest-'));
	try {
		await withEnv({ WOPI_STATE_ROOT: tempRoot, ACTIVITY_MAX_AGE_DAYS: '1', ACTIVITY_MAX_COUNT: '100' }, async function() {
			const { appendActivity, listActivity } = require('../lib/activityStore');
			const documentRoot = path.join(tempRoot, 'documents');
			await fs.mkdir(documentRoot, { recursive: true });

			const oldCreatedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
			// The only entry is itself older than the retention window; pruning must still keep it.
			await appendActivity(documentRoot, { type: 'upload', fileId: 'only', createdAt: oldCreatedAt });

			const items = await listActivity(documentRoot, 50);
			assert.equal(items.length, 1);
			assert.equal(items[0].fileId, 'only');
			assert.equal(items[0].createdAt, oldCreatedAt);
		});
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});

test('activity log is pruned by count while keeping the newest entry', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-retention-activity-count-'));
	try {
		await withEnv({ WOPI_STATE_ROOT: tempRoot, ACTIVITY_MAX_AGE_DAYS: '3650', ACTIVITY_MAX_COUNT: '3' }, async function() {
			const { appendActivity, listActivity } = require('../lib/activityStore');
			const documentRoot = path.join(tempRoot, 'documents');
			await fs.mkdir(documentRoot, { recursive: true });

			for (let index = 0; index < 5; index += 1) {
				await appendActivity(documentRoot, { type: 'upload', fileId: `file-${index}` });
			}

			const items = await listActivity(documentRoot, 50);
			assert.equal(items.length, 3);
			assert.equal(items[0].fileId, 'file-4');
			assert.equal(items[2].fileId, 'file-2');
		});
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});

test('version history is pruned by count, deletes storage files, but keeps the newest and labeled versions', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-retention-versions-count-'));
	try {
		await withEnv({ WOPI_STATE_ROOT: tempRoot, VERSION_MAX_AGE_DAYS: '3650', VERSION_MAX_COUNT: '2' }, async function() {
			const { createVersionSnapshot, listVersions, renameVersion } = require('../lib/versionStore');
			const { getContextStateRoot } = require('../lib/statePaths');
			const documentRoot = path.join(tempRoot, 'documents');
			await fs.mkdir(documentRoot, { recursive: true });
			const sourcePath = path.join(documentRoot, 'source.txt');
			await fs.writeFile(sourcePath, 'content');
			const versionsDir = path.join(getContextStateRoot(documentRoot), 'versions');

			const document = {
				id: 'doc-1',
				absolutePath: sourcePath,
				extension: '.txt',
				size: 7
			};

			const firstVersion = await createVersionSnapshot(documentRoot, document, 'user-1');
			await renameVersion(documentRoot, document.id, firstVersion.id, 'Keep me');

			const secondVersion = await createVersionSnapshot(documentRoot, document, 'user-1');
			const thirdVersion = await createVersionSnapshot(documentRoot, document, 'user-1');
			const newestVersion = await createVersionSnapshot(documentRoot, document, 'user-1');

			const versions = await listVersions(documentRoot, document);
			const ids = versions.map((version) => version.id);

			// Labeled version and the newest version must always survive pruning.
			assert.ok(ids.includes(firstVersion.id), 'labeled version must survive pruning');
			assert.ok(ids.includes(newestVersion.id), 'newest version must survive pruning');

			// With VERSION_MAX_COUNT=2, unlabeled versions beyond the limit (the oldest
			// unlabeled ones by array position, excluding the always-kept newest) are pruned.
			assert.ok(!ids.includes(secondVersion.id), 'oldest unlabeled version beyond the count limit must be pruned');
			assert.ok(ids.includes(thirdVersion.id), 'unlabeled version within the count limit must be kept');

			// The pruned version's storage file must actually be removed from disk.
			await assert.rejects(fs.access(path.join(versionsDir, `${secondVersion.id}${document.extension}`)));
			// Kept versions' storage files must remain.
			await assert.doesNotReject(fs.access(path.join(versionsDir, `${firstVersion.id}${document.extension}`)));
			await assert.doesNotReject(fs.access(path.join(versionsDir, `${thirdVersion.id}${document.extension}`)));
			await assert.doesNotReject(fs.access(path.join(versionsDir, `${newestVersion.id}${document.extension}`)));
		});
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});

test('version history is pruned by age but never removes labeled or the newest version', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-retention-versions-age-'));
	try {
		await withEnv({ WOPI_STATE_ROOT: tempRoot, VERSION_MAX_AGE_DAYS: '1', VERSION_MAX_COUNT: '100' }, async function() {
			const { getContextStateRoot } = require('../lib/statePaths');
			const documentRoot = path.join(tempRoot, 'documents');
			const versionsDir = path.join(getContextStateRoot(documentRoot), 'versions');
			await fs.mkdir(versionsDir, { recursive: true });

			const oldLabeledFile = 'old-labeled.txt';
			const oldUnlabeledFile = 'old-unlabeled.txt';
			await fs.writeFile(path.join(versionsDir, oldLabeledFile), 'a');
			await fs.writeFile(path.join(versionsDir, oldUnlabeledFile), 'b');

			const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
			const index = {
				versions: [
					{ id: 'old-unlabeled', storageFileName: oldUnlabeledFile, size: 1, createdAt: oldDate, createdBy: 'user-1' },
					{ id: 'old-labeled', storageFileName: oldLabeledFile, size: 1, createdAt: oldDate, createdBy: 'user-1', label: 'Important' }
				]
			};
			await fs.writeFile(path.join(versionsDir, 'doc-1.json'), JSON.stringify(index));

			const sourcePath = path.join(tempRoot, 'source.txt');
			await fs.writeFile(sourcePath, 'content');
			const document = { id: 'doc-1', absolutePath: sourcePath, extension: '.txt', size: 7 };

			const { createVersionSnapshot, listVersions } = require('../lib/versionStore');
			const newestVersion = await createVersionSnapshot(documentRoot, document, 'user-1');

			const versions = await listVersions(documentRoot, document);
			const ids = versions.map((version) => version.id);
			assert.ok(ids.includes('old-labeled'), 'labeled version must never be pruned by age');
			assert.ok(ids.includes(newestVersion.id), 'newest version must always be kept');
			assert.ok(!ids.includes('old-unlabeled'), 'old unlabeled version beyond max age must be pruned');

			// The pruned version's storage file must be deleted from disk.
			await assert.rejects(fs.access(path.join(versionsDir, oldUnlabeledFile)));
			// The labeled version's storage file must remain.
			await assert.doesNotReject(fs.access(path.join(versionsDir, oldLabeledFile)));
		});
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});
