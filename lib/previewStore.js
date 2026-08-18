'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { getStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');
const MAX_VERSIONS_PER_FILE = 5;

function getPreviewStatePath(documentRoot) {
	return path.join(getStateRoot(documentRoot), 'preview-cache.json');
}

function getThumbnailDirectory(documentRoot) {
	return path.join(getStateRoot(documentRoot), 'thumbnails');
}

function sanitizePathSegment(value) {
	return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildCacheKey(fileId, version) {
	return `${fileId}:${version}`;
}

function getThumbnailFileName(fileId, version) {
	return `${sanitizePathSegment(fileId)}-${sanitizePathSegment(version)}.png`;
}

function getThumbnailAbsolutePath(documentRoot, fileId, version) {
	return path.join(getThumbnailDirectory(documentRoot), getThumbnailFileName(fileId, version));
}

async function loadPreviewState(documentRoot) {
	await ensureDirectory(getStateRoot(documentRoot));
	const currentState = await readJson(getPreviewStatePath(documentRoot), {
		entries: {}
	});
	if (!currentState || typeof currentState !== 'object' || typeof currentState.entries !== 'object') {
		return { entries: {} };
	}
	return currentState;
}

async function savePreviewState(documentRoot, state) {
	await writeJsonAtomic(getPreviewStatePath(documentRoot), state);
}

function getThumbnailPublicUrl(fileId, version) {
	return `/api/thumbnails/${encodeURIComponent(fileId)}/${encodeURIComponent(version)}`;
}

async function getCachedThumbnail(documentRoot, fileId, version) {
	const state = await loadPreviewState(documentRoot);
	const cacheKey = buildCacheKey(fileId, version);
	const entry = state.entries[cacheKey];
	if (!entry || entry.status !== 'ready') {
		return null;
	}
	try {
		await fs.access(entry.absolutePath);
	} catch (error) {
		return null;
	}
	return {
		...entry,
		thumbnailUrl: getThumbnailPublicUrl(fileId, version)
	};
}

async function storeThumbnail(documentRoot, options) {
	await ensureDirectory(getThumbnailDirectory(documentRoot));
	const absolutePath = getThumbnailAbsolutePath(documentRoot, options.fileId, options.version);
	await fs.writeFile(absolutePath, options.buffer);
	const state = await loadPreviewState(documentRoot);
	const cacheKey = buildCacheKey(options.fileId, options.version);
	state.entries[cacheKey] = {
		fileId: options.fileId,
		version: options.version,
		relativePath: options.relativePath,
		absolutePath: absolutePath,
		mimeType: options.mimeType || 'image/png',
		width: options.width,
		height: options.height,
		status: 'ready',
		createdAt: new Date().toISOString()
	};
	const fileVersionEntries = Object.entries(state.entries)
		.filter(([entryKey, entry]) => entry?.status === 'ready' && entry?.fileId === options.fileId && entryKey.includes(':'))
		.sort((left, right) => String(right[1].createdAt || '').localeCompare(String(left[1].createdAt || '')));
	for (const [entryKey, entry] of fileVersionEntries.slice(MAX_VERSIONS_PER_FILE)) {
		try {
			await fs.unlink(entry.absolutePath);
		} catch (error) {
			if (error?.code !== 'ENOENT') {
				throw error;
			}
		}
		delete state.entries[entryKey];
	}
	await savePreviewState(documentRoot, state);
	return {
		...state.entries[cacheKey],
		thumbnailUrl: getThumbnailPublicUrl(options.fileId, options.version)
	};
}

async function invalidatePreview(documentRoot, document) {
	const currentState = await loadPreviewState(documentRoot);
	currentState.entries[document.id] = {
		fileId: document.id,
		relativePath: document.relativePath,
		version: document.version,
		invalidatedAt: new Date().toISOString(),
		status: 'invalidated'
	};
	await savePreviewState(documentRoot, currentState);
}

async function resolveThumbnailAbsolutePath(documentRoot, fileId, version) {
	const cachedEntry = await getCachedThumbnail(documentRoot, fileId, version);
	return cachedEntry?.absolutePath || null;
}

module.exports = {
	buildCacheKey: buildCacheKey,
	getCachedThumbnail: getCachedThumbnail,
	getThumbnailAbsolutePath: getThumbnailAbsolutePath,
	getThumbnailPublicUrl: getThumbnailPublicUrl,
	invalidatePreview: invalidatePreview,
	resolveThumbnailAbsolutePath: resolveThumbnailAbsolutePath,
	storeThumbnail: storeThumbnail
};
