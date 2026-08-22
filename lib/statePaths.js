'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_WOPI_STATE_ROOT = '/var/lib/wopi-state';

function getStateRoot(documentRoot) {
	if (process.env.WOPI_STATE_ROOT) {
		return path.resolve(process.env.WOPI_STATE_ROOT);
	}
	return path.resolve(DEFAULT_WOPI_STATE_ROOT);
}

function getCommonStateRoot(documentRoot) {
	return path.join(getStateRoot(documentRoot), 'common');
}

function getSharedStateRoot(documentRoot) {
	return path.join(getStateRoot(documentRoot), 'shared');
}

function getContextStateRoot(documentRoot) {
	const normalizedDocumentRoot = path.resolve(documentRoot);
	const mountNamespace = crypto
		.createHash('sha256')
		.update(normalizedDocumentRoot)
		.digest('hex')
		.slice(0, 16);
	return path.join(getStateRoot(documentRoot), 'mounts', mountNamespace);
}

function getCommonUsersDirectory(documentRoot) {
	return path.join(getCommonStateRoot(documentRoot), 'users');
}

function getSharedUserStatePath(documentRoot) {
	return path.join(getCommonUsersDirectory(documentRoot), 'shared-user.json');
}

function getUserStatePath(documentRoot, userId) {
	return path.join(getCommonUsersDirectory(documentRoot), `${String(userId)}.json`);
}

async function ensureDirectory(directoryPath) {
	await fs.mkdir(directoryPath, { recursive: true });
}

async function readJson(filePath, defaultValue) {
	try {
		const content = await fs.readFile(filePath, 'utf8');
		return JSON.parse(content);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return defaultValue;
		}

		throw error;
	}
}

async function writeJsonAtomic(filePath, data) {
	const directory = path.dirname(filePath);
	await ensureDirectory(directory);
	const tempFilePath = `${filePath}.${Date.now()}.tmp`;
	await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf8');
	await fs.rename(tempFilePath, filePath);
}

module.exports = {
	getCommonStateRoot: getCommonStateRoot,
	getCommonUsersDirectory: getCommonUsersDirectory,
	getContextStateRoot: getContextStateRoot,
	getSharedStateRoot: getSharedStateRoot,
	getSharedUserStatePath: getSharedUserStatePath,
	getStateRoot: getStateRoot,
	getUserStatePath: getUserStatePath,
	ensureDirectory: ensureDirectory,
	readJson: readJson,
	writeJsonAtomic: writeJsonAtomic
};
