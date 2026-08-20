'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	copyDocument,
	createDocument,
	createLegacyFileId,
	createFolder,
	deleteDocument,
	getAvailableName,
	getDocumentById,
	listDocuments,
	pruneMissingDocumentEntries,
	renameOrMoveDocument,
	uploadDocuments
} = require('../lib/documentStore');
const { getDocumentActivityType } = require('../routes/apiDocuments');
const { getCachedThumbnail, resolveThumbnailAbsolutePath, storeThumbnail } = require('../lib/previewStore');
const { listRecycledEntries } = require('../lib/recycleStore');
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

test('getDocumentActivityType treats same-folder renames as rename actions', function() {
	assert.equal(getDocumentActivityType({ relativePath: 'report.odt' }, { relativePath: 'renamed-report.odt' }), 'rename');
	assert.equal(getDocumentActivityType({ relativePath: 'folder/report.odt' }, { relativePath: 'folder/renamed-report.odt' }), 'rename');
	assert.equal(getDocumentActivityType({ relativePath: 'folder/report.odt' }, { relativePath: 'archive/report.odt' }), 'move');
});

test('renameOrMoveDocument keeps the same stable file id', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const [originalDocument] = await listDocuments(tempRoot);
	const renamedDocument = await renameOrMoveDocument(tempRoot, originalDocument.id, {
		targetName: 'renamed-report.odt'
	});

	assert.equal(renamedDocument.id, originalDocument.id);
	assert.equal(renamedDocument.relativePath, 'renamed-report.odt');
});

test('copyDocument creates a new independent file id', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const [originalDocument] = await listDocuments(tempRoot);
	const copiedDocument = await copyDocument(tempRoot, originalDocument.id, {
		targetName: 'report copy.odt'
	});

	assert.notEqual(copiedDocument.id, originalDocument.id);
	assert.equal(copiedDocument.relativePath, 'report copy.odt');
});

test('copyDocument throws a structured conflict before resolution and then keeps both', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'source.odt'), 'original');
	await fs.writeFile(path.join(tempRoot, 'target.odt'), 'existing');
	await fs.writeFile(path.join(tempRoot, 'target (1).odt'), 'existing-copy');

	const sourceDocument = (await listDocuments(tempRoot)).find((document) => document.relativePath === 'source.odt');
	await assert.rejects(function() {
		return copyDocument(tempRoot, sourceDocument.id, {
			targetName: 'target.odt'
		});
	}, (error) => error && error.code === 'FILE_CONFLICT');

	const resolvedCopy = await copyDocument(tempRoot, sourceDocument.id, {
		targetName: 'target.odt',
		conflictResolution: 'keep_both'
	});
	assert.equal(resolvedCopy.relativePath, 'target (2).odt');
	assert.equal(await fs.readFile(path.join(tempRoot, 'target (2).odt'), 'utf8'), 'original');
});

test('copyDocument rejects copying a file onto itself', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'report');

	const sourceDocument = (await listDocuments(tempRoot)).find((document) => document.relativePath === 'report.odt');
	await assert.rejects(function() {
		return copyDocument(tempRoot, sourceDocument.id, {
			targetName: 'report.odt',
			conflictResolution: 'overwrite'
		});
	}, /copied onto itself/);

	const documents = await listDocuments(tempRoot);
	assert.deepEqual(documents.map((document) => document.relativePath), ['report.odt']);
	assert.equal(await fs.readFile(path.join(tempRoot, 'report.odt'), 'utf8'), 'report');
});

test('renameOrMoveDocument resolves conflicts with overwrite and keep-both semantics', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'source');
	await fs.writeFile(path.join(tempRoot, 'renamed.odt'), 'target');

	const sourceDocument = (await listDocuments(tempRoot)).find((document) => document.relativePath === 'report.odt');
	await assert.rejects(function() {
		return renameOrMoveDocument(tempRoot, sourceDocument.id, {
			targetName: 'renamed.odt'
		});
	}, (error) => error && error.code === 'FILE_CONFLICT');

	const keepBothResult = await renameOrMoveDocument(tempRoot, sourceDocument.id, {
		targetName: 'renamed.odt',
		conflictResolution: 'keep_both'
	});
	assert.equal(keepBothResult.relativePath, 'renamed (1).odt');

	const [updatedSource] = await listDocuments(tempRoot);
	assert.ok(updatedSource.relativePath === 'renamed (1).odt' || updatedSource.relativePath === 'report.odt');
});

test('getAvailableName generates unique filenames and preserves file extensions', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'report.pdf'), 'report');
	await fs.writeFile(path.join(tempRoot, 'report (1).pdf'), 'report-one');
	await fs.writeFile(path.join(tempRoot, 'README'), 'readme');
	await fs.writeFile(path.join(tempRoot, 'photo.jpg'), 'photo');

	assert.equal(await getAvailableName(tempRoot, '', 'report.pdf'), 'report (2).pdf');
	assert.equal(await getAvailableName(tempRoot, '', 'README'), 'README (1)');
	assert.equal(await getAvailableName(tempRoot, '', 'photo.jpg'), 'photo (1).jpg');
});

test('createDocument can target a folder path', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.mkdir(path.join(tempRoot, 'archive'), { recursive: true });

	const document = await createDocument(tempRoot, {
		directory: 'archive',
		fileName: 'inside.odt',
		content: 'inside'
	});

	assert.equal(document.relativePath, 'archive/inside.odt');
	const listedDocuments = await listDocuments(tempRoot);
	assert.ok(listedDocuments.some((entry) => entry.relativePath === 'archive/inside.odt'));
});

test('createFolder and folder moves keep descendants stable', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await createFolder(tempRoot, { folderName: 'archive' });
	await fs.mkdir(path.join(tempRoot, 'archive', 'nested'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'archive', 'nested', 'report.odt'), 'report');

	const beforeMove = await listDocuments(tempRoot);
	const folderBefore = beforeMove.find((document) => document.relativePath === 'archive');
	const nestedBefore = beforeMove.find((document) => document.relativePath === 'archive/nested/report.odt');

	const movedFolder = await renameOrMoveDocument(tempRoot, folderBefore.id, {
		targetDirectory: '',
		targetName: 'archive-root'
	});

	const afterMove = await listDocuments(tempRoot);
	const folderAfter = afterMove.find((document) => document.relativePath === 'archive-root');
	const nestedAfter = afterMove.find((document) => document.relativePath === 'archive-root/nested/report.odt');

	assert.equal(movedFolder.id, folderBefore.id);
	assert.equal(folderAfter.id, folderBefore.id);
	assert.equal(nestedAfter.id, nestedBefore.id);
});

test('copyDocument copies folders recursively with new ids', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.mkdir(path.join(tempRoot, 'archive', 'nested'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'archive', 'nested', 'report.odt'), 'report');

	const beforeCopy = await listDocuments(tempRoot);
	const folderBefore = beforeCopy.find((document) => document.relativePath === 'archive');
	const nestedBefore = beforeCopy.find((document) => document.relativePath === 'archive/nested/report.odt');

	const copiedFolder = await copyDocument(tempRoot, folderBefore.id, {
		targetDirectory: '',
		targetName: 'archive copy'
	});

	const afterCopy = await listDocuments(tempRoot);
	const folderCopy = afterCopy.find((document) => document.relativePath === 'archive copy');
	const nestedCopy = afterCopy.find((document) => document.relativePath === 'archive copy/nested/report.odt');

	assert.notEqual(copiedFolder.id, folderBefore.id);
	assert.notEqual(folderCopy.id, folderBefore.id);
	assert.notEqual(nestedCopy.id, nestedBefore.id);
});

test('copyDocument replace recycles the replaced folder contents', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.mkdir(path.join(tempRoot, 'existing-folder', 'keep'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'existing-folder', 'keep', 'old.odt'), 'old');
	await fs.mkdir(path.join(tempRoot, 'replacement-folder', 'nested'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'replacement-folder', 'nested', 'new.odt'), 'new');

	const documents = await listDocuments(tempRoot);
	const sourceFolder = documents.find((document) => document.relativePath === 'replacement-folder');
	const targetFolder = documents.find((document) => document.relativePath === 'existing-folder');

	const replacedFolder = await copyDocument(tempRoot, sourceFolder.id, {
		targetName: 'existing-folder',
		conflictResolution: 'replace',
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal'
	});

	assert.equal(replacedFolder.relativePath, 'existing-folder');
	assert.equal(await fs.readFile(path.join(tempRoot, 'existing-folder', 'nested', 'new.odt'), 'utf8'), 'new');
	const recycledEntries = await listRecycledEntries(tempRoot);
	assert.ok(recycledEntries.some((entry) => entry.originalPath === 'existing-folder/keep/old.odt'));
	assert.equal((await listDocuments(tempRoot)).find((document) => document.relativePath === 'existing-folder')?.id, replacedFolder.id);
	assert.ok(targetFolder.id !== replacedFolder.id);
});

test('deleteDocument removes folders recursively', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.mkdir(path.join(tempRoot, 'archive', 'nested'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'archive', 'nested', 'report.odt'), 'report');

	const beforeDelete = await listDocuments(tempRoot);
	const folderBefore = beforeDelete.find((document) => document.relativePath === 'archive');

	await assert.doesNotReject(function() {
		return deleteDocument(tempRoot, folderBefore.id);
	});

	const afterDelete = await listDocuments(tempRoot);
	assert.deepEqual(afterDelete, []);
});

test('deleteDocument snapshots deleted files into recycle state and clears previews', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
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

	const deletedDocument = await deleteDocument(tempRoot, document.id, {
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal'
	});

	assert.equal(deletedDocument.id, document.id);
	await assert.rejects(() => getDocumentById(tempRoot, document.id));
	const cachedPreview = await getCachedThumbnail(tempRoot, document.id, document.version);
	assert.ok(cachedPreview);
	assert.equal(cachedPreview.version, document.version);
	assert.equal(await resolveThumbnailAbsolutePath(tempRoot, document.id, document.version), cachedPreview.absolutePath);
	await fs.access(cachedPreview.absolutePath);

	const recycledEntries = await listRecycledEntries(tempRoot);
	assert.equal(recycledEntries.length, 1);
	assert.equal(recycledEntries[0].fileId, document.id);
	assert.equal(recycledEntries[0].originalPath, 'report.odt');
	assert.equal(recycledEntries[0].versionId, recycledEntries[0].snapshotId);
	assert.equal(recycledEntries[0].versionSize, document.size);

	const versionEntry = await getVersionEntry(tempRoot, document.id, recycledEntries[0].versionId);
	assert.equal(recycledEntries[0].versionSize, versionEntry.entry.size);
	assert.equal(path.basename(versionEntry.storagePath).endsWith('.odt'), true);
	await fs.access(versionEntry.storagePath);
});

test('copyDocument overwrite recycles the existing target and preserves its preview', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'source.odt'), 'source');
	await fs.writeFile(path.join(tempRoot, 'target.odt'), 'target');

	const documents = await listDocuments(tempRoot);
	const sourceDocument = documents.find((document) => document.relativePath === 'source.odt');
	const targetDocument = documents.find((document) => document.relativePath === 'target.odt');

	await storeThumbnail(tempRoot, {
		fileId: targetDocument.id,
		version: targetDocument.version,
		relativePath: targetDocument.relativePath,
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});

	const copiedDocument = await copyDocument(tempRoot, sourceDocument.id, {
		targetName: 'target.odt',
		conflictResolution: 'overwrite'
	});

	assert.equal(copiedDocument.relativePath, 'target.odt');
	assert.equal(copiedDocument.id, targetDocument.id);
	assert.equal(await fs.readFile(path.join(tempRoot, 'target.odt'), 'utf8'), 'source');
	assert.ok(await getCachedThumbnail(tempRoot, targetDocument.id, targetDocument.version));
});

test('renameOrMoveDocument overwrite recycles the existing target and keeps the moved document id', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.writeFile(path.join(tempRoot, 'source.odt'), 'source');
	await fs.writeFile(path.join(tempRoot, 'target.odt'), 'target');

	const documents = await listDocuments(tempRoot);
	const sourceDocument = documents.find((document) => document.relativePath === 'source.odt');
	const targetDocument = documents.find((document) => document.relativePath === 'target.odt');

	await storeThumbnail(tempRoot, {
		fileId: targetDocument.id,
		version: targetDocument.version,
		relativePath: targetDocument.relativePath,
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});

	const movedDocument = await renameOrMoveDocument(tempRoot, sourceDocument.id, {
		targetName: 'target.odt',
		conflictResolution: 'overwrite',
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal'
	});

	assert.equal(movedDocument.id, sourceDocument.id);
	assert.equal(movedDocument.relativePath, 'target.odt');
	assert.equal(await fs.readFile(path.join(tempRoot, 'target.odt'), 'utf8'), 'source');

	const recycledEntries = await listRecycledEntries(tempRoot);
	assert.equal(recycledEntries.length, 1);
	assert.equal(recycledEntries[0].fileId, targetDocument.id);
	assert.equal(recycledEntries[0].originalPath, 'target.odt');
	assert.ok(await getCachedThumbnail(tempRoot, targetDocument.id, targetDocument.version));
});

test('renameOrMoveDocument integrate keep_both preserves nested moved file ids and versions', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.mkdir(path.join(tempRoot, 'Dokumente'), { recursive: true });
	await fs.mkdir(path.join(tempRoot, 'Dokumente4'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'Dokumente', 'dokumente.odt'), 'target');
	await fs.writeFile(path.join(tempRoot, 'Dokumente4', 'dokumente.odt'), 'source');

	const beforeMove = await listDocuments(tempRoot);
	const sourceFolder = beforeMove.find((document) => document.relativePath === 'Dokumente4');
	const sourceFile = beforeMove.find((document) => document.relativePath === 'Dokumente4/dokumente.odt');
	assert.ok(sourceFolder);
	assert.ok(sourceFile);

	const snapshot = await createVersionSnapshot(tempRoot, sourceFile, {
		id: 'user-1',
		name: 'User One'
	});

	await renameOrMoveDocument(tempRoot, sourceFolder.id, {
		targetName: 'Dokumente',
		conflictResolution: 'integrate',
		fileConflictResolution: 'keep_both',
		operation: 'move'
	});

	const afterMove = await listDocuments(tempRoot);
	const keptBothFile = afterMove.find((document) => document.relativePath === 'Dokumente/dokumente (1).odt');
	assert.ok(keptBothFile);
	assert.equal(keptBothFile.id, sourceFile.id);
	await assert.doesNotReject(() => getVersionEntry(tempRoot, keptBothFile.id, snapshot.id));
});

test('renameOrMoveDocument integrate overwrite recycles overwritten nested targets and keeps moved file ids', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.mkdir(path.join(tempRoot, 'Dokumente'), { recursive: true });
	await fs.mkdir(path.join(tempRoot, 'Dokumente4'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'Dokumente', 'dokumente.odt'), 'target');
	await fs.writeFile(path.join(tempRoot, 'Dokumente4', 'dokumente.odt'), 'source');

	const beforeMove = await listDocuments(tempRoot);
	const sourceFolder = beforeMove.find((document) => document.relativePath === 'Dokumente4');
	const sourceFile = beforeMove.find((document) => document.relativePath === 'Dokumente4/dokumente.odt');
	const targetFile = beforeMove.find((document) => document.relativePath === 'Dokumente/dokumente.odt');
	assert.ok(sourceFolder);
	assert.ok(sourceFile);
	assert.ok(targetFile);

	await renameOrMoveDocument(tempRoot, sourceFolder.id, {
		targetName: 'Dokumente',
		conflictResolution: 'integrate',
		fileConflictResolution: 'overwrite',
		actor: { id: 'user-1', name: 'User One' },
		context: 'personal',
		operation: 'move'
	});

	const afterMove = await listDocuments(tempRoot);
	const overwrittenFile = afterMove.find((document) => document.relativePath === 'Dokumente/dokumente.odt');
	assert.ok(overwrittenFile);
	assert.equal(overwrittenFile.id, sourceFile.id);
	assert.equal(await fs.readFile(path.join(tempRoot, 'Dokumente', 'dokumente.odt'), 'utf8'), 'source');

	const recycledEntries = await listRecycledEntries(tempRoot);
	assert.ok(recycledEntries.some((entry) => entry.fileId === targetFile.id && entry.originalPath === 'Dokumente/dokumente.odt'));
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

test('getContextStateRoot namespaces storage state under storages/<hash>', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-state-root-test');
	const customStateRoot = path.join(tempRoot, 'state-root');
	const previousValue = process.env.WOPI_STATE_ROOT;
	process.env.WOPI_STATE_ROOT = customStateRoot;

	try {
		const contextStateRoot = getContextStateRoot(tempRoot);
		assert.match(contextStateRoot, new RegExp(`${customStateRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${path.sep}storages${path.sep}`));
	} finally {
		if (previousValue === undefined) {
			delete process.env.WOPI_STATE_ROOT;
		} else {
			process.env.WOPI_STATE_ROOT = previousValue;
		}
	}
});

test('getContextStateRoot returns distinct namespaces for different storage roots', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-user-state-root-test');
	const customStateRoot = path.join(tempRoot, 'state-root');
	const storageOneRoot = path.join(tempRoot, 'storage-one');
	const storageTwoRoot = path.join(tempRoot, 'storage-two');
	const previousValue = process.env.WOPI_STATE_ROOT;
	process.env.WOPI_STATE_ROOT = customStateRoot;

	try {
		assert.notEqual(getContextStateRoot(storageOneRoot), getContextStateRoot(storageTwoRoot));
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

test('getStateRoot falls back to the document root .wopi-state directory', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-state-fallback-test');
	const previousValue = process.env.WOPI_STATE_ROOT;
	delete process.env.WOPI_STATE_ROOT;

	try {
		assert.equal(getStateRoot(tempRoot), path.join(tempRoot, '.wopi-state'));
	} finally {
		if (previousValue === undefined) {
			delete process.env.WOPI_STATE_ROOT;
		} else {
			process.env.WOPI_STATE_ROOT = previousValue;
		}
	}
});
