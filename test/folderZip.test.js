'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { createFolder } = require('../lib/documentStore');
const { createDocumentsZip, createFolderZip } = require('../lib/folderZip');
const { listDocuments } = require('../lib/documentStore');

function readZipEntries(buffer) {
	const endOfCentralDirectorySignature = 0x06054b50;
	let eocdOffset = -1;
	for (let index = buffer.length - 22; index >= 0; index--) {
		if (buffer.readUInt32LE(index) === endOfCentralDirectorySignature) {
			eocdOffset = index;
			break;
		}
	}
	if (eocdOffset < 0) {
		throw new Error('ZIP end of central directory not found.');
	}

	const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
	const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
	const entries = [];
	let offset = centralDirectoryOffset;
	for (let index = 0; index < totalEntries; index++) {
		assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
		const compressionMethod = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const uncompressedSize = buffer.readUInt32LE(offset + 24);
		const fileNameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localHeaderOffset = buffer.readUInt32LE(offset + 42);
		const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);
		const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
		const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
		const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
		const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
		const data = compressionMethod === 0 ? compressedData : zlib.inflateRawSync(compressedData);
		assert.equal(data.length, uncompressedSize);
		entries.push({ name: fileName, data: data });
		offset += 46 + fileNameLength + extraLength + commentLength;
	}

	return entries;
}

test('createFolderZip packages a folder and its descendants', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await createFolder(tempRoot, { folderName: 'archive' });
	await fs.mkdir(path.join(tempRoot, 'archive', 'nested'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'archive', 'root.txt'), 'root');
	await fs.writeFile(path.join(tempRoot, 'archive', 'nested', 'child.txt'), 'child');

	const [folder] = (await listDocuments(tempRoot)).filter((document) => document.relativePath === 'archive');
	const artifact = await createFolderZip(folder);

	try {
		const entries = readZipEntries(artifact.buffer);
		const names = entries.map((entry) => entry.name);
		assert.ok(names.includes('archive/'));
		assert.ok(names.includes('archive/root.txt'));
		assert.ok(names.includes('archive/nested/'));
		assert.ok(names.includes('archive/nested/child.txt'));
		assert.equal(path.basename(artifact.downloadName), 'archive.zip');
		assert.equal(entries.find((entry) => entry.name === 'archive/root.txt').data.toString(), 'root');
		assert.equal(entries.find((entry) => entry.name === 'archive/nested/child.txt').data.toString(), 'child');
		assert.equal(artifact.downloadName, 'archive.zip');
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});

test('createDocumentsZip packages multiple selected entries', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-folder-browser-'));
	await createFolder(tempRoot, { folderName: 'archive' });
	await fs.mkdir(path.join(tempRoot, 'archive', 'nested'), { recursive: true });
	await fs.writeFile(path.join(tempRoot, 'archive', 'nested', 'child.txt'), 'child');
	await fs.writeFile(path.join(tempRoot, 'notes.txt'), 'notes');

	const documents = await listDocuments(tempRoot);
	const selectedDocuments = [
		documents.find((document) => document.relativePath === 'archive'),
		documents.find((document) => document.relativePath === 'notes.txt')
	];
	const artifact = await createDocumentsZip(selectedDocuments);

	try {
		const entries = readZipEntries(artifact.buffer);
		const names = entries.map((entry) => entry.name);
		assert.ok(names.includes('archive/'));
		assert.ok(names.includes('archive/nested/'));
		assert.ok(names.includes('archive/nested/child.txt'));
		assert.ok(names.includes('notes.txt'));
		assert.equal(entries.find((entry) => entry.name === 'notes.txt').data.toString(), 'notes');
		assert.equal(artifact.downloadName, 'selected-items.zip');
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});
