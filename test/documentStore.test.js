'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	copyDocument,
	createLegacyFileId,
	createFolder,
	deleteDocument,
	getDocumentById,
	listDocuments,
	renameOrMoveDocument
} = require('../lib/documentStore');

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
