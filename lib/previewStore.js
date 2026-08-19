'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { getContextStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

function getPreviewStatePath(documentRoot) {
	return path.join(getContextStateRoot(documentRoot), 'preview-cache.json');
}

function getThumbnailDirectory(documentRoot) {
	return path.join(getContextStateRoot(documentRoot), 'thumbnails');
}

function sanitizePathSegment(value) {
	return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildCacheKey(fileId, version) {
	return fileId;
}

function getThumbnailFileName(fileId, version) {
	return `${sanitizePathSegment(fileId)}.png`;
}

function getThumbnailAbsolutePath(documentRoot, fileId, version) {
	return path.join(getThumbnailDirectory(documentRoot), getThumbnailFileName(fileId, version));
}

async function loadPreviewState(documentRoot) {
	await ensureDirectory(getContextStateRoot(documentRoot));
	const currentState = await readJson(getPreviewStatePath(documentRoot), {
		entries: {}
	});
	if (!currentState || typeof currentState !== 'object' || typeof currentState.entries !== 'object') {
		return { entries: {} };
	}
	const normalizedEntries = {};
	for (const [entryKey, entryValue] of Object.entries(currentState.entries)) {
		if (!entryValue || typeof entryValue !== 'object') {
			continue;
		}
		if (entryValue.status === 'invalidated') {
			continue;
		}
		const fileId = String(entryValue.fileId || (entryKey.includes(':') ? entryKey.split(':')[0] : entryKey) || '');
		if (!fileId) {
			continue;
		}
		const normalizedValue = {
			...entryValue,
			fileId: fileId,
			version: entryValue.version || (entryKey.includes(':') ? entryKey.split(':').slice(1).join(':') : entryKey)
		};
		normalizedEntries[fileId] = normalizedValue;
	}
	const normalizedState = { ...currentState, entries: normalizedEntries };
	if (Object.keys(normalizedEntries).length !== Object.keys(currentState.entries).length) {
		await savePreviewState(documentRoot, normalizedState);
	}
	return normalizedState;
}

async function savePreviewState(documentRoot, state) {
	const normalizedState = {
		...state,
		entries: {},
	};
	for (const [entryKey, entryValue] of Object.entries(state.entries || {})) {
		if (!entryValue || typeof entryValue !== 'object') {
			continue;
		}
		const fileId = String(entryValue.fileId || entryKey);
		normalizedState.entries[fileId] = {
			...entryValue,
			fileId: fileId,
			version: entryValue.version || entryKey
		};
	}
	await writeJsonAtomic(getPreviewStatePath(documentRoot), normalizedState);
}

function getThumbnailPublicUrl(fileId, version) {
	return `/api/thumbnails/${encodeURIComponent(fileId)}/${encodeURIComponent(version)}`;
}

async function getCachedThumbnail(documentRoot, fileId, version) {
	const state = await loadPreviewState(documentRoot);
	const entry = state.entries[fileId];
	if (!entry || entry.status !== 'ready') {
		return null;
	}
	if (version !== undefined && version !== null && String(entry.version) !== String(version)) {
		return null;
	}
	try {
		await fs.access(entry.absolutePath);
	} catch (error) {
		return null;
	}
	return {
		...entry,
		thumbnailUrl: getThumbnailPublicUrl(fileId, entry.version)
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
	await savePreviewState(documentRoot, state);
	return {
		...state.entries[cacheKey],
		thumbnailUrl: getThumbnailPublicUrl(options.fileId, options.version)
	};
}

async function invalidatePreview(documentRoot, document) {
	const currentState = await loadPreviewState(documentRoot);
	const cacheKey = buildCacheKey(document.id, document.version);
	const currentEntry = currentState.entries[cacheKey];
	if (currentEntry?.absolutePath) {
		try {
			await fs.unlink(currentEntry.absolutePath);
		} catch (error) {
			if (error?.code !== 'ENOENT') {
				throw error;
			}
		}
	}
	delete currentState.entries[cacheKey];
	await savePreviewState(documentRoot, currentState);
}

async function removePreviewEntriesForFile(documentRoot, fileId) {
	const normalizedFileId = String(fileId || '');
	if (!normalizedFileId) {
		return false;
	}

	const currentState = await loadPreviewState(documentRoot);
	let changed = false;
	for (const [cacheKey, entry] of Object.entries(currentState.entries)) {
		if (String(entry?.fileId || cacheKey) !== normalizedFileId) {
			continue;
		}
		if (entry?.absolutePath) {
			try {
				await fs.unlink(entry.absolutePath);
			} catch (error) {
				if (error?.code !== 'ENOENT') {
					throw error;
				}
			}
		}
		delete currentState.entries[cacheKey];
		changed = true;
	}

	if (changed) {
		await savePreviewState(documentRoot, currentState);
	}
	return changed;
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
	removePreviewEntriesForFile: removePreviewEntriesForFile,
	resolveThumbnailAbsolutePath: resolveThumbnailAbsolutePath,
	storeThumbnail: storeThumbnail
};
