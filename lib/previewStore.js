'use strict';

const path = require('node:path');

const { getStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

function getPreviewStatePath(documentRoot) {
	return path.join(getStateRoot(documentRoot), 'preview-cache.json');
}

async function invalidatePreview(documentRoot, document) {
	await ensureDirectory(getStateRoot(documentRoot));
	const currentState = await readJson(getPreviewStatePath(documentRoot), {
		entries: {}
	});
	currentState.entries[document.id] = {
		fileId: document.id,
		relativePath: document.relativePath,
		version: document.version,
		invalidatedAt: new Date().toISOString(),
		status: 'invalidated'
	};
	await writeJsonAtomic(getPreviewStatePath(documentRoot), currentState);
}

module.exports = {
	invalidatePreview: invalidatePreview
};
