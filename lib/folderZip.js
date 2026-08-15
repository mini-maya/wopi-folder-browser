'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const { createHttpError } = require('./errors');

const CRC32_TABLE = buildCrc32Table();

async function createFolderZip(document) {
	if (!document || !document.isDirectory) {
		throw createHttpError(400, 'Only folders can be downloaded as zip archives.');
	}

	const entries = [];
	const rootName = path.basename(document.absolutePath);
	await collectFolderEntries(document.absolutePath, rootName, entries);
	return {
		buffer: buildZipArchive(entries),
		downloadName: `${document.name}.zip`
	};
}

async function collectFolderEntries(absolutePath, zipPath, entries) {
	const stats = await fs.stat(absolutePath);
	entries.push({
		name: `${zipPath}/`,
		isDirectory: true,
		mtime: stats.mtime,
		buffer: Buffer.alloc(0)
	});

	const children = await fs.readdir(absolutePath, { withFileTypes: true });
	children.sort((left, right) => left.name.localeCompare(right.name));

	for (const child of children) {
		const childAbsolutePath = path.join(absolutePath, child.name);
		const childZipPath = path.posix.join(zipPath, child.name);
		if (child.isDirectory()) {
			await collectFolderEntries(childAbsolutePath, childZipPath, entries);
			continue;
		}
		if (!child.isFile()) {
			continue;
		}

		const fileStats = await fs.stat(childAbsolutePath);
		entries.push({
			name: childZipPath,
			isDirectory: false,
			mtime: fileStats.mtime,
			buffer: await fs.readFile(childAbsolutePath)
		});
	}
}

function buildZipArchive(entries) {
	const localFileParts = [];
	const centralDirectoryParts = [];
	let localOffset = 0;

	for (const entry of entries) {
		const fileName = Buffer.from(entry.name, 'utf8');
		const { dosTime, dosDate } = toDosDateTime(entry.mtime);
		const uncompressed = entry.buffer;
		const compressed = entry.isDirectory ? Buffer.alloc(0) : zlib.deflateRawSync(uncompressed);
		const method = entry.isDirectory ? 0 : 8;
		const crc32 = entry.isDirectory ? 0 : computeCrc32(uncompressed);
		const localHeader = Buffer.alloc(30 + fileName.length);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt16LE(0x0800, 6);
		localHeader.writeUInt16LE(method, 8);
		localHeader.writeUInt16LE(dosTime, 10);
		localHeader.writeUInt16LE(dosDate, 12);
		localHeader.writeUInt32LE(crc32, 14);
		localHeader.writeUInt32LE(compressed.length, 18);
		localHeader.writeUInt32LE(uncompressed.length, 22);
		localHeader.writeUInt16LE(fileName.length, 26);
		localHeader.writeUInt16LE(0, 28);
		fileName.copy(localHeader, 30);

		localFileParts.push(localHeader, compressed);

		const centralHeader = Buffer.alloc(46 + fileName.length);
		centralHeader.writeUInt32LE(0x02014b50, 0);
		centralHeader.writeUInt16LE(20, 4);
		centralHeader.writeUInt16LE(20, 6);
		centralHeader.writeUInt16LE(0x0800, 8);
		centralHeader.writeUInt16LE(method, 10);
		centralHeader.writeUInt16LE(dosTime, 12);
		centralHeader.writeUInt16LE(dosDate, 14);
		centralHeader.writeUInt32LE(crc32, 16);
		centralHeader.writeUInt32LE(compressed.length, 20);
		centralHeader.writeUInt32LE(uncompressed.length, 24);
		centralHeader.writeUInt16LE(fileName.length, 28);
		centralHeader.writeUInt16LE(0, 30);
		centralHeader.writeUInt16LE(0, 32);
		centralHeader.writeUInt16LE(0, 34);
		centralHeader.writeUInt16LE(entry.isDirectory ? 0x10 : 0, 36);
		centralHeader.writeUInt32LE(entry.isDirectory ? (0x10 << 16) : 0, 38);
		centralHeader.writeUInt32LE(localOffset, 42);
		fileName.copy(centralHeader, 46);

		centralDirectoryParts.push(centralHeader);
		localOffset += localHeader.length + compressed.length;
	}

	const centralDirectory = Buffer.concat(centralDirectoryParts);
	const endOfCentralDirectory = Buffer.alloc(22);
	endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
	endOfCentralDirectory.writeUInt16LE(0, 4);
	endOfCentralDirectory.writeUInt16LE(0, 6);
	endOfCentralDirectory.writeUInt16LE(entries.length, 8);
	endOfCentralDirectory.writeUInt16LE(entries.length, 10);
	endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
	endOfCentralDirectory.writeUInt32LE(localOffset, 16);
	endOfCentralDirectory.writeUInt16LE(0, 20);

	return Buffer.concat([...localFileParts, centralDirectory, endOfCentralDirectory]);
}

function toDosDateTime(date) {
	const safeDate = date instanceof Date ? date : new Date();
	const year = Math.max(1980, safeDate.getFullYear());
	const dosDate = ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate();
	const dosTime = (safeDate.getHours() << 11) | (safeDate.getMinutes() << 5) | Math.floor(safeDate.getSeconds() / 2);
	return { dosTime: dosTime, dosDate: dosDate };
}

function buildCrc32Table() {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) {
			if ((c & 1) !== 0) {
				c = 0xedb88320 ^ (c >>> 1);
			} else {
				c >>>= 1;
			}
		}
		table[i] = c >>> 0;
	}
	return table;
}

function computeCrc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

module.exports = {
	createFolderZip: createFolderZip
};
