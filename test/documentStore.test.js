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
	renameOrMoveDocument,
	uploadDocuments
} = require('../lib/documentStore');
const { getCommonStateRoot, getContextStateRoot, getStateRoot } = require('../lib/statePaths');

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
	await fs.writeFile(path.join(tempRoot, 'report.odt'), 'original');
	await fs.writeFile(path.join(tempRoot, 'report (1).odt'), 'existing');

	const sourceDocument = (await listDocuments(tempRoot)).find((document) => document.relativePath === 'report.odt');
	await assert.rejects(function() {
		return copyDocument(tempRoot, sourceDocument.id, {
			targetName: 'report.odt'
		});
	}, (error) => error && error.code === 'FILE_CONFLICT');

	const resolvedCopy = await copyDocument(tempRoot, sourceDocument.id, {
		targetName: 'report.odt',
		conflictResolution: 'keep_both'
	});
	assert.equal(resolvedCopy.relativePath, 'report (2).odt');
	assert.equal(await fs.readFile(path.join(tempRoot, 'report (2).odt'), 'utf8'), 'original');
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

test('getContextStateRoot keeps shared document state under shared when configured', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-state-root-test');
	const customStateRoot = path.join(tempRoot, 'state-root');
	const previousValue = process.env.WOPI_STATE_ROOT;
	process.env.WOPI_STATE_ROOT = customStateRoot;

	try {
		assert.equal(getContextStateRoot(tempRoot), path.join(customStateRoot, 'shared'));
	} finally {
		if (previousValue === undefined) {
			delete process.env.WOPI_STATE_ROOT;
		} else {
			process.env.WOPI_STATE_ROOT = previousValue;
		}
	}
});

test('getContextStateRoot keeps personal document state isolated under users/<userId>', function() {
	const tempRoot = path.join(os.tmpdir(), 'wopi-folder-browser-user-state-root-test');
	const customStateRoot = path.join(tempRoot, 'state-root');
	const userRoot = path.join(tempRoot, 'users', 'user-42');
	const previousValue = process.env.WOPI_STATE_ROOT;
	process.env.WOPI_STATE_ROOT = customStateRoot;

	try {
		assert.equal(getContextStateRoot(userRoot), path.join(customStateRoot, 'users', 'user-42'));
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
