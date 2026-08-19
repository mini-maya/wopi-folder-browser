'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { createHttpError } = require('./errors');
const { getContextStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

function getVersionRoot(documentRoot) {
	return path.join(getContextStateRoot(documentRoot), 'versions');
}

function getIndexFile(documentRoot, fileId) {
	return path.join(getVersionRoot(documentRoot), `${fileId}.json`);
}

async function loadIndex(documentRoot, fileId) {
	const content = await readJson(getIndexFile(documentRoot, fileId), {
		versions: []
	});
	if (!content || typeof content !== 'object' || !Array.isArray(content.versions)) {
		return { versions: [] };
	}

	return content;
}

async function saveIndex(documentRoot, fileId, indexData) {
	await writeJsonAtomic(getIndexFile(documentRoot, fileId), indexData);
}

async function createVersionSnapshot(documentRoot, document, actor) {
	await ensureDirectory(getVersionRoot(documentRoot));
	const index = await loadIndex(documentRoot, document.id);
	const versionId = `${Date.now()}-${crypto.randomUUID()}`;
	const storageFileName = `${versionId}${document.extension}`;
	const storagePath = path.join(getVersionRoot(documentRoot), storageFileName);

	await fs.copyFile(document.absolutePath, storagePath);
	index.versions.unshift({
		id: versionId,
		storageFileName: storageFileName,
		size: document.size,
		createdAt: new Date().toISOString(),
		createdBy: actor
	});
	await saveIndex(documentRoot, document.id, index);
	return index.versions[0];
}

async function listVersions(documentRoot, document) {
	const index = await loadIndex(documentRoot, document.id);
	return index.versions.map((version) => ({
		id: version.id,
		label: version.label || null,
		size: version.size,
		createdAt: version.createdAt,
		createdBy: version.createdBy
	}));
}

async function getVersionEntry(documentRoot, fileId, versionId) {
	const index = await loadIndex(documentRoot, fileId);
	const version = index.versions.find((entry) => entry.id === versionId);
	if (!version) {
		throw createHttpError(404, 'Version not found.');
	}
	return {
		entry: version,
		storagePath: path.join(getVersionRoot(documentRoot), version.storageFileName)
	};
}

async function renameVersion(documentRoot, fileId, versionId, label) {
	const index = await loadIndex(documentRoot, fileId);
	const version = index.versions.find((entry) => entry.id === versionId);
	if (!version) {
		throw createHttpError(404, 'Version not found.');
	}
	version.label = label || null;
	await saveIndex(documentRoot, fileId, index);
}

async function deleteVersion(documentRoot, document, versionId) {
	const index = await loadIndex(documentRoot, document.id);
	const versionIndex = index.versions.findIndex((entry) => entry.id === versionId);
	if (versionIndex === -1) {
		throw createHttpError(404, 'Version not found.');
	}
	const [version] = index.versions.splice(versionIndex, 1);
	await saveIndex(documentRoot, document.id, index);
	const storagePath = path.join(getVersionRoot(documentRoot), version.storageFileName);
	try {
		await fs.unlink(storagePath);
	} catch {
		// File may already be gone; ignore.
	}
}

async function restoreVersion(documentRoot, document, versionId) {
	const index = await loadIndex(documentRoot, document.id);
	const versionIndex = index.versions.findIndex((entry) => entry.id === versionId);
	if (versionIndex === -1) {
		throw createHttpError(404, 'Version not found.');
	}

	// Move the restored version to position 0 so it matches the live file content.
	const [version] = index.versions.splice(versionIndex, 1);
	index.versions.unshift(version);
	await saveIndex(documentRoot, document.id, index);
	await fs.copyFile(path.join(getVersionRoot(documentRoot), version.storageFileName), document.absolutePath);
}

module.exports = {
	createVersionSnapshot: createVersionSnapshot,
	deleteVersion: deleteVersion,
	getVersionEntry: getVersionEntry,
	listVersions: listVersions,
	renameVersion: renameVersion,
	restoreVersion: restoreVersion
};
