'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { checkDocumentConsistency } = require('../lib/consistencyCheck');
const { cleanupStaleDocumentEntry } = require('../lib/documentStore');
const { getContextStateRoot } = require('../lib/statePaths');

async function writeJson(filePath, data) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

test('checkDocumentConsistency detects mismatches between filesystem and JSON state files', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report-data');
	const stateRoot = getContextStateRoot(tempRoot);

	await writeJson(path.join(stateRoot, 'file-registry.json'), {
		entries: {
			'id-1': 'report.odt',
			'id-2': 'missing.docx'
		}
	});
	await writeJson(path.join(stateRoot, 'recycled.json'), {
		entries: [{
			id: 'recycled-1',
			fileId: 'id-ghost',
			originalPath: 'ghosted.docx'
		}]
	});
	await writeJson(path.join(stateRoot, 'preview-cache.json'), {
		entries: {
			'id-ghost': {
				fileId: 'id-ghost',
				relativePath: 'ghosted.docx'
			}
		}
	});
	await writeJson(path.join(stateRoot, 'activities.json'), [
		{ id: 'activity-1', fileId: 'id-ghost', fileName: 'ghosted.docx' },
		{ id: 'activity-2', fileId: 'id-1', fileName: 'different.txt' }
	]);
	await writeJson(path.join(tempRoot, '.wopi-state', 'common', 'users', 'shared-user.json'), {
		favorites: ['id-ghost'],
		recent: [
			{ fileId: 'id-ghost', openedAt: '2026-08-19T16:00:00.000Z' },
			{ fileId: 'id-1', openedAt: '2026-08-19T16:00:10.000Z' }
		]
	});

	const report = await checkDocumentConsistency(tempRoot);
	assert.equal(report.status, 'inconsistent');
	assert.ok(report.summary.issueCount > 0);
	const issueTypes = new Set(report.issues.map((issue) => issue.type));
	assert.ok(issueTypes.has('missing_in_filesystem'));
	assert.ok(issueTypes.has('orphaned_recycled_entry'));
	assert.ok(issueTypes.has('stale_preview_cache'));
	assert.ok(issueTypes.has('orphaned_activity_reference'));
	assert.ok(issueTypes.has('stale_favorite_reference'));
	assert.ok(issueTypes.has('stale_recent_reference'));
	assert.equal(report.issues.find((issue) => issue.type === 'orphaned_activity_reference')?.severity, 'info');
	assert.equal(report.issues.find((issue) => issue.type === 'stale_favorite_reference')?.severity, 'info');
	assert.equal(report.issues.find((issue) => issue.type === 'stale_recent_reference')?.severity, 'info');
	assert.equal(report.issues.find((issue) => issue.type === 'stale_preview_cache')?.severity, 'info');
	assert.equal(report.issues.find((issue) => issue.type === 'orphaned_recycled_entry')?.severity, 'info');
});

test('cleanupStaleDocumentEntry removes stale registry state and related user entries', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-cleanup-'));
	const stateRoot = getContextStateRoot(tempRoot);
	const staleFileId = 'stale-file-id';
	await writeJson(path.join(stateRoot, 'file-registry.json'), {
		entries: {
			[staleFileId]: 'ghost-folder/ghost.odt',
			'keep-file-id': 'kept.odt'
		}
	});
	const staleThumbnailPath = path.join(stateRoot, 'thumbnails', `${staleFileId}.png`);
	await fs.mkdir(path.dirname(staleThumbnailPath), { recursive: true });
	await fs.writeFile(staleThumbnailPath, 'png-data');
	await writeJson(path.join(stateRoot, 'preview-cache.json'), {
		entries: {
			[staleFileId]: {
				fileId: staleFileId,
				relativePath: 'ghost-folder/ghost.odt',
				absolutePath: staleThumbnailPath
			}
		}
	});
	await writeJson(path.join(stateRoot, 'activities.json'), [
		{ id: 'activity-ghost', fileId: staleFileId, fileName: 'ghost-folder/ghost.odt' },
		{ id: 'activity-kept', fileId: 'keep-file-id', fileName: 'kept.odt' }
	]);
	await writeJson(path.join(tempRoot, '.wopi-state', 'common', 'users', 'shared-user.json'), {
		favorites: [staleFileId, 'keep-file-id'],
		recent: [
			{ fileId: staleFileId, openedAt: '2026-08-19T16:00:00.000Z' },
			{ fileId: 'keep-file-id', openedAt: '2026-08-19T16:00:10.000Z' }
		]
	});

	const result = await cleanupStaleDocumentEntry(tempRoot, {
		fileId: staleFileId,
		relativePath: 'ghost-folder/ghost.odt'
	});
	assert.equal(result.removed, true);
	assert.deepEqual(result.fileIds, [staleFileId]);

	const registry = JSON.parse(await fs.readFile(path.join(stateRoot, 'file-registry.json'), 'utf8'));
	assert.equal(registry.entries[staleFileId], undefined);
	assert.equal(registry.entries['keep-file-id'], 'kept.odt');

	const previewState = JSON.parse(await fs.readFile(path.join(stateRoot, 'preview-cache.json'), 'utf8'));
	assert.equal(previewState.entries[staleFileId], undefined);
	await assert.rejects(fs.access(staleThumbnailPath), { code: 'ENOENT' });

	const activities = JSON.parse(await fs.readFile(path.join(stateRoot, 'activities.json'), 'utf8'));
	assert.deepEqual(activities, [{ id: 'activity-kept', fileId: 'keep-file-id', fileName: 'kept.odt' }]);

	const userState = JSON.parse(await fs.readFile(path.join(tempRoot, '.wopi-state', 'common', 'users', 'shared-user.json'), 'utf8'));
	assert.deepEqual(userState.favorites, ['keep-file-id']);
	assert.deepEqual(userState.recent, [{ fileId: 'keep-file-id', openedAt: '2026-08-19T16:00:10.000Z' }]);
});

test('checkDocumentConsistency returns ok when filesystem and state files are aligned', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-ok-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report-data');
	const stateRoot = getContextStateRoot(tempRoot);
	const fileId = 'id-valid';

	await writeJson(path.join(stateRoot, 'file-registry.json'), {
		entries: { [fileId]: 'report.odt' }
	});
	await writeJson(path.join(stateRoot, 'recycled.json'), { entries: [] });
	await writeJson(path.join(stateRoot, 'preview-cache.json'), {
		entries: {
			[fileId]: {
				fileId: fileId,
				relativePath: 'report.odt'
			}
		}
	});
	await writeJson(path.join(stateRoot, 'activities.json'), [
		{ id: 'activity-ok', fileId: fileId, fileName: 'report.odt' }
	]);
	await writeJson(path.join(tempRoot, '.wopi-state', 'common', 'users', 'shared-user.json'), {
		favorites: [fileId],
		recent: [{ fileId: fileId, openedAt: '2026-08-19T16:00:00.000Z' }]
	});

	const report = await checkDocumentConsistency(tempRoot);
	assert.equal(report.status, 'ok');
	assert.equal(report.summary.issueCount, 0);
});

test('checkDocumentConsistency accepts shared file ids in user state', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-shared-'));
	const sharedRoot = path.join(tempRoot, 'shared');
	const userRoot = path.join(tempRoot, 'users', 'user-1');
	const sharedFileId = 'shared-file-id';
	const sharedFileName = 'shared-file.odt';

	await fs.mkdir(sharedRoot, { recursive: true });
	await fs.mkdir(userRoot, { recursive: true });
	await fs.writeFile(path.join(sharedRoot, sharedFileName), 'shared-data');
	await writeJson(path.join(tempRoot, '.wopi-state', 'common', 'users', 'user-1.json'), {
		favorites: [sharedFileId],
		recent: [{ fileId: sharedFileId, openedAt: '2026-08-19T16:00:00.000Z' }]
	});
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'file-registry.json'), {
		entries: { [sharedFileId]: sharedFileName }
	});
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'recycled.json'), { entries: [] });
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'preview-cache.json'), {
		entries: {
			[sharedFileId]: {
				fileId: sharedFileId,
				relativePath: sharedFileName
			}
		}
	});
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'activities.json'), [
		{ id: 'activity-shared', fileId: sharedFileId, fileName: sharedFileName }
	]);
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'file-registry.json'), { entries: {} });
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'recycled.json'), { entries: [] });
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'preview-cache.json'), { entries: {} });
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'activities.json'), []);

	const report = await checkDocumentConsistency(userRoot);
	assert.equal(report.status, 'ok');
	assert.equal(report.summary.issueCount, 0);
});

test('checkDocumentConsistency treats recycle-bin references as informational', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-recycle-'));
	const stateRoot = getContextStateRoot(tempRoot);
	const recycledFileId = 'id-recycled';

	await writeJson(path.join(stateRoot, 'recycled.json'), {
		entries: [{ id: 'recycled-1', fileId: recycledFileId, originalPath: 'recycled.odt' }]
	});
	await writeJson(path.join(stateRoot, 'preview-cache.json'), {
		entries: {
			[recycledFileId]: {
				fileId: recycledFileId,
				relativePath: 'recycled.odt'
			}
		}
	});
	await writeJson(path.join(stateRoot, 'activities.json'), [
		{ id: 'activity-recycled', fileId: recycledFileId, fileName: 'recycled.odt' }
	]);
	await writeJson(path.join(tempRoot, '.wopi-state', 'common', 'users', 'shared-user.json'), {
		favorites: [recycledFileId],
		recent: [{ fileId: recycledFileId, openedAt: '2026-08-19T16:00:00.000Z' }]
	});

	const report = await checkDocumentConsistency(tempRoot);
	assert.equal(report.status, 'ok');
	assert.equal(report.summary.issueCount, 0);
	assert.equal(report.summary.errorCount, 0);
	assert.equal(report.summary.warningCount, 0);
	assert.ok(report.issues.length > 0);
	assert.ok(report.issues.every((issue) => issue.severity === 'info'));
});

test('checkDocumentConsistency treats shared recycle-bin references as informational for user state', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-shared-recycle-'));
	const sharedRoot = path.join(tempRoot, 'shared');
	const userRoot = path.join(tempRoot, 'users', 'user-1');
	const sharedFileId = 'shared-recycled-id';

	await fs.mkdir(sharedRoot, { recursive: true });
	await fs.mkdir(userRoot, { recursive: true });
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'recycled.json'), {
		entries: [{ id: 'recycled-shared-1', fileId: sharedFileId, originalPath: 'shared-recycled.odt' }]
	});
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'preview-cache.json'), {
		entries: {
			[sharedFileId]: {
				fileId: sharedFileId,
				relativePath: 'shared-recycled.odt'
			}
		}
	});
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'activities.json'), [
		{ id: 'activity-shared-recycled', fileId: sharedFileId, fileName: 'shared-recycled.odt' }
	]);
	await writeJson(path.join(tempRoot, '.wopi-state', 'common', 'users', 'user-1.json'), {
		favorites: [sharedFileId],
		recent: [{ fileId: sharedFileId, openedAt: '2026-08-19T16:00:00.000Z' }]
	});
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'file-registry.json'), { entries: {} });
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'recycled.json'), { entries: [] });

	const report = await checkDocumentConsistency(userRoot);
	assert.equal(report.status, 'ok');
	assert.equal(report.summary.issueCount, 0);
	assert.equal(report.summary.warningCount, 0);
	assert.ok(report.issues.length > 0);
	assert.ok(report.issues.every((issue) => issue.severity === 'info'));
});

test('checkDocumentConsistency accepts personal registry ids referenced from shared user state', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-personal-registry-'));
	const sharedRoot = path.join(tempRoot, 'shared');
	const userRoot = path.join(tempRoot, 'users', 'user-1');
	const personalFileId = 'personal-file-id';
	const personalFileName = 'personal.odt';

	await fs.mkdir(sharedRoot, { recursive: true });
	await fs.mkdir(userRoot, { recursive: true });
	await fs.writeFile(path.join(userRoot, 'personal.odt'), 'personal-data');
	await writeJson(path.join(tempRoot, '.wopi-state', 'common', 'users', 'user-1.json'), {
		favorites: [personalFileId],
		recent: [{ fileId: personalFileId, openedAt: '2026-08-19T16:00:00.000Z' }]
	});
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'file-registry.json'), {
		entries: { [personalFileId]: personalFileName }
	});
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'recycled.json'), { entries: [] });
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'preview-cache.json'), { entries: {} });
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'activities.json'), []);
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'file-registry.json'), { entries: {} });
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'recycled.json'), { entries: [] });
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'preview-cache.json'), { entries: {} });
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'activities.json'), []);

	const report = await checkDocumentConsistency(sharedRoot);
	assert.equal(report.status, 'ok');
	assert.equal(report.summary.issueCount, 0);
	assert.equal(report.summary.warningCount, 0);
	assert.equal(report.summary.errorCount, 0);
});

test('checkDocumentConsistency treats personal recycle-bin ids as informational for user state', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-personal-recycle-'));
	const sharedRoot = path.join(tempRoot, 'shared');
	const userRoot = path.join(tempRoot, 'users', 'user-1');
	const recycledFileId = 'personal-recycled-id';

	await fs.mkdir(sharedRoot, { recursive: true });
	await fs.mkdir(userRoot, { recursive: true });
	await writeJson(path.join(tempRoot, '.wopi-state', 'common', 'users', 'user-1.json'), {
		favorites: [recycledFileId],
		recent: [{ fileId: recycledFileId, openedAt: '2026-08-19T16:00:00.000Z' }]
	});
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'file-registry.json'), { entries: {} });
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'recycled.json'), {
		entries: [{ id: 'recycled-personal-1', fileId: recycledFileId, originalPath: 'personal.odt' }]
	});
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'preview-cache.json'), { entries: {} });
	await writeJson(path.join(userRoot, '.wopi-state', 'users', 'user-1', 'activities.json'), []);
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'file-registry.json'), { entries: {} });
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'recycled.json'), { entries: [] });
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'preview-cache.json'), { entries: {} });
	await writeJson(path.join(sharedRoot, '.wopi-state', 'shared', 'activities.json'), []);

	const report = await checkDocumentConsistency(userRoot);
	assert.equal(report.status, 'ok');
	assert.equal(report.summary.issueCount, 0);
	assert.equal(report.summary.warningCount, 0);
	assert.equal(report.summary.errorCount, 0);
	assert.ok(report.issues.every((issue) => issue.severity === 'info'));
});

test('checkDocumentConsistency does not flag folder activities without registry entries', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-consistency-folder-'));
	const stateRoot = getContextStateRoot(tempRoot);

	await writeJson(path.join(stateRoot, 'activities.json'), [
		{ id: 'activity-folder', type: 'create-folder', fileId: 'folder-id', fileName: 'test' }
	]);
	await writeJson(path.join(stateRoot, 'file-registry.json'), { entries: {} });
	await writeJson(path.join(stateRoot, 'recycled.json'), { entries: [] });
	await writeJson(path.join(stateRoot, 'preview-cache.json'), { entries: {} });

	const report = await checkDocumentConsistency(tempRoot);
	assert.equal(report.status, 'ok');
	assert.equal(report.summary.issueCount, 0);
	assert.equal(report.summary.warningCount, 0);
	assert.equal(report.summary.errorCount, 0);
	assert.equal(report.issues.every((issue) => issue.severity === 'info'), true);
});
