'use strict';

const fs = require('fs/promises');
const path = require('path');

const STATE_DIRECTORY_NAME = '.wopi-state';

function getStateRoot(documentRoot) {
	return path.join(documentRoot, STATE_DIRECTORY_NAME);
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
	STATE_DIRECTORY_NAME: STATE_DIRECTORY_NAME,
	getStateRoot: getStateRoot,
	ensureDirectory: ensureDirectory,
	readJson: readJson,
	writeJsonAtomic: writeJsonAtomic
};
