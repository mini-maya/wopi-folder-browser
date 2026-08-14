'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	copyDocument,
	createLegacyFileId,
	getDocumentById,
	listDocuments,
	renameOrMoveDocument
} = require('../lib/documentStore');

test('listDocuments returns supported files recursively', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await fs.mkdir(path.join(tempRoot, 'nested'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'demo.docx'), 'demo');
	await fs.writeFile(path.join(tempRoot, 'nested', 'sheet.xlsx'), 'sheet');
	await fs.writeFile(path.join(tempRoot, 'notes.md'), '# ignored');

	const documents = await listDocuments(tempRoot);
	const relativePaths = documents.map(function(document) {
		return document.relativePath;
	});

	assert.deepEqual(relativePaths, ['demo.docx', 'nested/sheet.xlsx']);
	assert.equal(documents[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
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
