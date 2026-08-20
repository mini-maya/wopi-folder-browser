'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { deleteAllVersions, deleteVersion, getVersionEntry } = require('./versionStore');
const { invalidatePreview } = require('./previewStore');
const { removeActivityEntriesForFile } = require('./activityStore');
const { removeDocumentReferences } = require('./userStateStore');
const { getContextStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

function getRecycledStatePath(documentRoot) {
	return path.join(getContextStateRoot(documentRoot), 'recycled.json');
}

async function loadRecycledState(documentRoot) {
	await ensureDirectory(getContextStateRoot(documentRoot));
	const state = await readJson(getRecycledStatePath(documentRoot), {
		entries: []
	});

	if (!state || typeof state !== 'object' || !Array.isArray(state.entries)) {
		return { entries: [] };
	}

	const entries = [];
	for (const entry of state.entries) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		if (!entry.id || !entry.fileId) {
			continue;
		}
		entries.push({
			id: String(entry.id),
			fileId: String(entry.fileId),
			originalName: entry.originalName ? String(entry.originalName) : '',
			originalPath: entry.originalPath ? String(entry.originalPath) : '',
			context: entry.context ? String(entry.context) : null,
			deletedAt: entry.deletedAt ? String(entry.deletedAt) : null,
			versionId: entry.versionId ? String(entry.versionId) : null,
			versionPath: entry.versionPath ? String(entry.versionPath) : null,
			snapshotId: entry.snapshotId ? String(entry.snapshotId) : null,
			versionSize: entry.versionSize != null ? Number(entry.versionSize) : null,
			mimeType: entry.mimeType ? String(entry.mimeType) : null,
			previewVersion: entry.previewVersion ? String(entry.previewVersion) : null
		});
	}

	return { entries: entries };
}

async function saveRecycledState(documentRoot, state) {
	const normalizedState = {
		entries: Array.isArray(state.entries) ? state.entries.map((entry) => ({
			id: String(entry.id),
			fileId: String(entry.fileId),
			originalName: entry.originalName ? String(entry.originalName) : '',
			originalPath: entry.originalPath ? String(entry.originalPath) : '',
			context: entry.context ? String(entry.context) : null,
			deletedAt: entry.deletedAt ? String(entry.deletedAt) : null,
			versionId: entry.versionId ? String(entry.versionId) : null,
			versionPath: entry.versionPath ? String(entry.versionPath) : null,
			snapshotId: entry.snapshotId ? String(entry.snapshotId) : null,
			versionSize: entry.versionSize != null ? Number(entry.versionSize) : null,
			mimeType: entry.mimeType ? String(entry.mimeType) : null,
			previewVersion: entry.previewVersion ? String(entry.previewVersion) : null
		})) : []
	};

	await writeJsonAtomic(getRecycledStatePath(documentRoot), normalizedState);
	return normalizedState;
}

function createRecycledEntryId() {
	return `recycled-${crypto.randomUUID()}`;
}

async function listRecycledEntries(documentRoot) {
	const state = await loadRecycledState(documentRoot);
	return state.entries;
}

async function addRecycledEntry(documentRoot, entry) {
	const state = await loadRecycledState(documentRoot);
	const nextEntry = {
		id: entry.id || createRecycledEntryId(),
		fileId: String(entry.fileId),
		originalName: entry.originalName ? String(entry.originalName) : '',
		originalPath: entry.originalPath ? String(entry.originalPath) : '',
		context: entry.context ? String(entry.context) : null,
		deletedAt: entry.deletedAt ? String(entry.deletedAt) : new Date().toISOString(),
		versionId: entry.versionId ? String(entry.versionId) : null,
		versionPath: entry.versionPath ? String(entry.versionPath) : null,
		snapshotId: entry.snapshotId ? String(entry.snapshotId) : null,
		versionSize: entry.versionSize != null ? Number(entry.versionSize) : null,
		mimeType: entry.mimeType ? String(entry.mimeType) : null,
		previewVersion: entry.previewVersion ? String(entry.previewVersion) : null
	};

	state.entries.unshift(nextEntry);
	await saveRecycledState(documentRoot, state);
	return nextEntry;
}

async function updateRecycledEntry(documentRoot, entryId, updates) {
	const state = await loadRecycledState(documentRoot);
	const entry = state.entries.find((item) => item.id === entryId);
	if (!entry) {
		return null;
	}

	Object.assign(entry, {
		fileId: updates.fileId !== undefined ? String(updates.fileId) : entry.fileId,
		originalName: updates.originalName !== undefined ? String(updates.originalName) : entry.originalName,
		originalPath: updates.originalPath !== undefined ? String(updates.originalPath) : entry.originalPath,
		context: updates.context !== undefined ? (updates.context === null ? null : String(updates.context)) : entry.context,
		deletedAt: updates.deletedAt !== undefined ? (updates.deletedAt === null ? null : String(updates.deletedAt)) : entry.deletedAt,
		versionId: updates.versionId !== undefined ? (updates.versionId === null ? null : String(updates.versionId)) : entry.versionId,
		versionPath: updates.versionPath !== undefined ? (updates.versionPath === null ? null : String(updates.versionPath)) : entry.versionPath,
		snapshotId: updates.snapshotId !== undefined ? (updates.snapshotId === null ? null : String(updates.snapshotId)) : entry.snapshotId,
		versionSize: updates.versionSize !== undefined ? (updates.versionSize === null ? null : Number(updates.versionSize)) : entry.versionSize
	});

	await saveRecycledState(documentRoot, state);
	return entry;
}

async function removeRecycledEntry(documentRoot, entryId) {
	const state = await loadRecycledState(documentRoot);
	const nextEntries = state.entries.filter((entry) => entry.id !== entryId);
	if (nextEntries.length === state.entries.length) {
		return false;
	}

	state.entries = nextEntries;
	await saveRecycledState(documentRoot, state);
	return true;
}

async function deleteRecycledEntry(documentRoot, entryId) {
	const state = await loadRecycledState(documentRoot);
	const entry = state.entries.find((item) => item.id === entryId);
	if (!entry) {
		return false;
	}

	if (entry.fileId) {
		const { deletePublicSharesByResource } = require('./shareStore');
		await deleteAllVersions(documentRoot, entry.fileId);
		await invalidatePreview(documentRoot, {
			id: entry.fileId,
			version: entry.previewVersion || entry.versionId
		});
		await removeActivityEntriesForFile(documentRoot, entry.fileId);
		await removeDocumentReferences(documentRoot, entry.fileId);
		await deletePublicSharesByResource(documentRoot, entry.fileId);
	}

	state.entries = state.entries.filter((item) => item.id !== entryId);
	await saveRecycledState(documentRoot, state);
	return true;
}

async function restoreRecycledEntry(documentRoot, entryId, options = {}) {
	const state = await loadRecycledState(documentRoot);
	const entry = state.entries.find((item) => item.id === entryId);
	if (!entry) {
		return null;
	}
	const { registerPathForId } = require('./documentStore');
	async function cleanupRestoredEntry() {
		if (entry.versionId) {
			await deleteVersion(documentRoot, { id: entry.fileId, extension: '' }, entry.versionId);
			await invalidatePreview(documentRoot, {
				id: entry.fileId,
				version: entry.previewVersion || entry.versionId
			});
		}
	}

	const { storagePath } = await getVersionEntry(documentRoot, entry.fileId, entry.versionId);
	const destinationPath = path.join(documentRoot, entry.originalPath);
	let destinationExists = false;
	try {
		await fs.access(destinationPath);
		destinationExists = true;
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}

	if (destinationExists) {
		const resolution = String(options.conflictResolution || '').trim();
		if (!resolution) {
			return { conflict: true, source: entry, target: { name: path.basename(entry.originalPath), relativePath: entry.originalPath } };
		}
		if (resolution === 'keep' || resolution === 'skip') {
			return { skipped: true, conflict: { source: entry, target: { name: path.basename(entry.originalPath), relativePath: entry.originalPath } } };
		}
		if (resolution === 'overwrite' || resolution === 'replace') {
			const { deleteDocumentWithOptions, listDocuments } = require('./documentStore');
			const existingTarget = (await listDocuments(documentRoot)).find((document) => document.relativePath === entry.originalPath && !document.isDirectory && document.id !== entry.fileId);
			if (existingTarget) {
				await deleteDocumentWithOptions(documentRoot, existingTarget.id, {
					actor: options.actor,
					context: options.context
				});
			}
			await fs.mkdir(path.dirname(destinationPath), { recursive: true });
			await fs.copyFile(storagePath, destinationPath);
			await registerPathForId(documentRoot, entry.fileId, entry.originalPath);
			const nextState = await loadRecycledState(documentRoot);
			nextState.entries = nextState.entries.filter((item) => item.id !== entryId);
			await saveRecycledState(documentRoot, nextState);
			await cleanupRestoredEntry();
			return { restored: true, fileId: entry.fileId, relativePath: entry.originalPath };
		}
		if (resolution === 'keep_both') {
			const parsed = path.posix.parse(entry.originalPath.replace(/\\/g, '/'));
			const directory = parsed.dir || '';
			const baseName = parsed.name || parsed.base || entry.originalName || 'recovered';
			const extension = parsed.ext || path.extname(entry.originalName || '');
			let counter = 1;
			let candidateRelativePath = entry.originalPath;
			while (true) {
				const candidateName = `${baseName} (${counter})${extension}`;
				candidateRelativePath = directory ? path.posix.join(directory, candidateName) : candidateName;
				try {
					await fs.access(path.join(documentRoot, candidateRelativePath));
					counter += 1;
				} catch (error) {
					if (error.code !== 'ENOENT') {
						throw error;
					}
					break;
				}
			}
			await fs.mkdir(path.dirname(path.join(documentRoot, candidateRelativePath)), { recursive: true });
			await fs.copyFile(storagePath, path.join(documentRoot, candidateRelativePath));
			await registerPathForId(documentRoot, entry.fileId, candidateRelativePath);
			state.entries = state.entries.filter((item) => item.id !== entryId);
			await saveRecycledState(documentRoot, state);
			await cleanupRestoredEntry();
			return { restored: true, fileId: entry.fileId, relativePath: candidateRelativePath };
		}
		return { conflict: true, source: entry };
	}

	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	await fs.copyFile(storagePath, destinationPath);
	await registerPathForId(documentRoot, entry.fileId, entry.originalPath);
	state.entries = state.entries.filter((item) => item.id !== entryId);
	await saveRecycledState(documentRoot, state);
	await cleanupRestoredEntry();
	return { restored: true, fileId: entry.fileId, relativePath: entry.originalPath };
}

module.exports = {
	addRecycledEntry: addRecycledEntry,
	createRecycledEntryId: createRecycledEntryId,
	getRecycledStatePath: getRecycledStatePath,
	listRecycledEntries: listRecycledEntries,
	loadRecycledState: loadRecycledState,
	deleteRecycledEntry: deleteRecycledEntry,
	removeRecycledEntry: removeRecycledEntry,
	saveRecycledState: saveRecycledState,
	restoreRecycledEntry: restoreRecycledEntry,
	updateRecycledEntry: updateRecycledEntry
};
