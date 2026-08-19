'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { SUPPORTED_MIME_TYPES } = require('./documentStore');
const { getCommonUsersDirectory, getContextStateRoot, getSharedStateRoot } = require('./statePaths');

function resolveStorageRoots(documentRoot) {
	const resolvedDocumentRoot = path.resolve(documentRoot);
	const parentDocumentRoot = path.resolve(resolvedDocumentRoot, '..');
	const grandParentDocumentRoot = path.resolve(resolvedDocumentRoot, '../..');
	const normalizedSegments = resolvedDocumentRoot.split(path.sep).filter(Boolean);
	const usersIndex = normalizedSegments.lastIndexOf('users');
	const currentRoots = new Set([resolvedDocumentRoot]);
	const baseRoots = new Set();

	if (path.basename(resolvedDocumentRoot) === 'shared') {
		baseRoots.add(parentDocumentRoot);
	} else if (path.basename(parentDocumentRoot) === 'users' || usersIndex >= 0) {
		baseRoots.add(path.join(path.sep, ...normalizedSegments.slice(0, usersIndex >= 0 ? usersIndex : normalizedSegments.length - 1)) || path.sep);
	} else {
		baseRoots.add(resolvedDocumentRoot);
	}

	for (const root of baseRoots) {
		currentRoots.add(root);
		currentRoots.add(path.join(root, 'shared'));
		currentRoots.add(path.join(root, 'users'));
	}

	const sharedDocumentRoot = [...currentRoots].find((root) => path.basename(root) === 'shared') || null;
	return {
		currentDocumentRoot: resolvedDocumentRoot,
		sharedDocumentRoot: sharedDocumentRoot,
		baseDocumentRoot: [...baseRoots][0] || resolvedDocumentRoot,
		commonUserStateRoots: [...new Set([
			getCommonUsersDirectory(resolvedDocumentRoot),
			...([...baseRoots].map((baseRoot) => getCommonUsersDirectory(baseRoot))),
			...((sharedDocumentRoot ? [getCommonUsersDirectory(sharedDocumentRoot)] : []))
		])]
	};
}

function normalizeRelativePath(value) {
	const raw = String(value || '').replace(/\\/g, '/').trim();
	if (!raw) {
		return '';
	}
	const normalized = raw.replace(/^\/+/, '').replace(/\/+/g, '/');
	const segments = normalized.split('/').filter(Boolean);
	if (segments.length === 0) {
		return '';
	}
	if (segments.some((segment) => segment === '.' || segment === '..')) {
		return '';
	}
	return segments.join('/');
}

function createIssue(options) {
	return {
		id: options.id || `${options.type}-${Math.random().toString(36).slice(2, 10)}`,
		type: options.type,
		severity: options.severity || 'warning',
		source: options.source || 'unknown',
		path: options.path || null,
		fileId: options.fileId || null,
		message: options.message || 'State mismatch detected.',
		relatedPaths: Array.isArray(options.relatedPaths) ? options.relatedPaths : [],
		actions: Array.isArray(options.actions) ? options.actions : []
	};
}

async function readJsonFile(filePath, fallbackValue) {
	try {
		const content = await fs.readFile(filePath, 'utf8');
		return JSON.parse(content);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return fallbackValue;
		}
		throw error;
	}
}

async function readRecycledFileIds(filePath) {
	const recycledState = await readJsonFile(filePath, { entries: [] });
	const recycledEntries = recycledState && typeof recycledState === 'object' && Array.isArray(recycledState.entries)
		? recycledState.entries
		: [];
	return {
		entries: recycledEntries,
		fileIds: new Set(
			recycledEntries
				.filter((entry) => entry && typeof entry === 'object' && entry.fileId)
				.map((entry) => String(entry.fileId))
		)
	};
}

async function readRegistryEntries(filePath) {
	const registryData = await readJsonFile(filePath, { entries: {} });
	return registryData && typeof registryData === 'object' && registryData.entries && typeof registryData.entries === 'object'
		? registryData.entries
		: {};
}

async function walkSupportedFiles(documentRoot, relativeDirectory = '') {
	const absoluteDirectory = relativeDirectory
		? path.resolve(documentRoot, relativeDirectory)
		: path.resolve(documentRoot);
	const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
	const collected = {
		files: [],
		directories: []
	};

	for (const entry of entries) {
		if (entry.name === '.wopi-state') {
			continue;
		}
		const relativePath = relativeDirectory
			? path.posix.join(relativeDirectory, entry.name)
			: entry.name;

		if (entry.isDirectory()) {
			const normalizedPath = normalizeRelativePath(relativePath);
			if (normalizedPath) {
				collected.directories.push(normalizedPath);
			}
			const nested = await walkSupportedFiles(documentRoot, relativePath);
			collected.files.push(...nested.files);
			collected.directories.push(...nested.directories);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const extension = path.extname(entry.name).toLowerCase();
		if (!SUPPORTED_MIME_TYPES[extension]) {
			continue;
		}
		const normalizedPath = normalizeRelativePath(relativePath);
		if (normalizedPath) {
			collected.files.push(normalizedPath);
		}
	}

	return {
		files: [...new Set(collected.files)].sort(),
		directories: [...new Set(collected.directories)].sort()
	};
}

async function checkDocumentConsistency(documentRoot) {
	const storageRoots = resolveStorageRoots(documentRoot);
	const stateRoot = getContextStateRoot(documentRoot);
	const sharedStateRoot = storageRoots.sharedDocumentRoot ? getContextStateRoot(storageRoots.sharedDocumentRoot) : null;
	const registryPath = path.join(stateRoot, 'file-registry.json');
	const recycledPath = path.join(stateRoot, 'recycled.json');
	const previewCachePath = path.join(stateRoot, 'preview-cache.json');
	const activitiesPath = path.join(stateRoot, 'activities.json');

	const filesystemScan = await walkSupportedFiles(documentRoot);
	const actualFiles = new Set(filesystemScan.files);
	const actualDirectories = new Set(filesystemScan.directories);
	const registryData = await readJsonFile(registryPath, { entries: {} });
	const registryEntries = registryData && typeof registryData === 'object' && registryData.entries && typeof registryData.entries === 'object'
		? registryData.entries
		: {};
	const sharedRegistryData = sharedStateRoot ? await readJsonFile(path.join(sharedStateRoot, 'file-registry.json'), { entries: {} }) : { entries: {} };
	const sharedRegistryEntries = sharedRegistryData && typeof sharedRegistryData === 'object' && sharedRegistryData.entries && typeof sharedRegistryData.entries === 'object'
		? sharedRegistryData.entries
		: {};
	const recycledState = await readRecycledFileIds(recycledPath);
	const sharedRecycledState = sharedStateRoot ? await readRecycledFileIds(path.join(sharedStateRoot, 'recycled.json')) : { entries: [], fileIds: new Set() };
	const recycledEntries = recycledState.entries;
	const recycledFileIds = new Set([
		...recycledState.fileIds,
		...sharedRecycledState.fileIds
	]);
	const previewState = await readJsonFile(previewCachePath, { entries: {} });
	const previewEntries = previewState && typeof previewState === 'object' && previewState.entries && typeof previewState.entries === 'object'
		? previewState.entries
		: {};
	const activitiesData = await readJsonFile(activitiesPath, []);
	const activities = Array.isArray(activitiesData) ? activitiesData : [];
	const userRegistryEntries = [];
	const userRecycledFileIds = [];
	const usersRoot = path.join(storageRoots.baseDocumentRoot, 'users');
	try {
		const userEntries = await fs.readdir(usersRoot, { withFileTypes: true });
		for (const entry of userEntries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const userDocumentRoot = path.join(usersRoot, entry.name);
			const userRegistryPath = path.join(getContextStateRoot(userDocumentRoot), 'file-registry.json');
			userRegistryEntries.push(await readRegistryEntries(userRegistryPath));
			const userRecycledPath = path.join(getContextStateRoot(userDocumentRoot), 'recycled.json');
			const userRecycledState = await readRecycledFileIds(userRecycledPath);
			userRecycledFileIds.push(userRecycledState.fileIds);
		}
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
	const userStateFiles = [];
	for (const stateDirectory of storageRoots.commonUserStateRoots) {
		try {
			const entries = await fs.readdir(stateDirectory, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') {
					continue;
				}
				userStateFiles.push(path.join(stateDirectory, entry.name));
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
	}

	const issues = [];
	const registryLookup = new Map();
	const accessibleRegistryLookup = new Map();
	const registryPathLookup = new Map();
	const fileIdsSeen = new Set();

	for (const [fileId, rawRelativePath] of Object.entries(registryEntries)) {
		const id = String(fileId);
		const normalizedPath = normalizeRelativePath(rawRelativePath);
		if (!id) {
			issues.push(createIssue({
				type: 'invalid_registry_entry',
				severity: 'error',
				source: 'file-registry.json',
				path: String(rawRelativePath || ''),
				message: 'Registry entry has no id.'
			}));
			continue;
		}
		if (fileIdsSeen.has(id)) {
			issues.push(createIssue({
				type: 'duplicate_registry_id',
				severity: 'error',
				source: 'file-registry.json',
				fileId: id,
				path: normalizedPath || String(rawRelativePath || ''),
				message: `Registry id ${id} is duplicated.`
			}));
		}
		fileIdsSeen.add(id);
		if (!normalizedPath) {
			issues.push(createIssue({
				type: 'invalid_registry_path',
				severity: 'error',
				source: 'file-registry.json',
				fileId: id,
				path: String(rawRelativePath || ''),
				message: 'Registry path is empty or invalid.'
			}));
			continue;
		}
		if (registryPathLookup.has(normalizedPath)) {
			issues.push(createIssue({
				type: 'duplicate_registry_path',
				severity: 'error',
				source: 'file-registry.json',
				fileId: id,
				path: normalizedPath,
				relatedPaths: [registryPathLookup.get(normalizedPath), normalizedPath],
				message: `Multiple registry entries point to the same path: ${normalizedPath}.`
			}));
		}
		registryPathLookup.set(normalizedPath, id);
		registryLookup.set(id, normalizedPath);
		accessibleRegistryLookup.set(id, normalizedPath);
		const existsOnFilesystem = actualFiles.has(normalizedPath) || actualDirectories.has(normalizedPath);
		if (!existsOnFilesystem) {
			issues.push(createIssue({
				type: 'missing_in_filesystem',
				severity: 'error',
				source: 'file-registry.json',
				fileId: id,
				path: normalizedPath,
				actions: [{ id: 'cleanup-stale-entry', label: 'Delete stale entry', type: 'cleanup' }],
				message: `Registry entry ${id} points to ${normalizedPath}, but the file or folder no longer exists in the document root.`
			}));
		}
	}

	for (const [sharedFileId, sharedRelativePath] of Object.entries(sharedRegistryEntries)) {
		const normalizedSharedPath = normalizeRelativePath(sharedRelativePath);
		if (!normalizedSharedPath) {
			continue;
		}
		accessibleRegistryLookup.set(String(sharedFileId), normalizedSharedPath);
	}

	for (const userRegistry of userRegistryEntries) {
		for (const [userFileId, userRelativePath] of Object.entries(userRegistry)) {
			const normalizedUserPath = normalizeRelativePath(userRelativePath);
			if (!normalizedUserPath) {
				continue;
			}
			accessibleRegistryLookup.set(String(userFileId), normalizedUserPath);
		}
	}
	for (const fileIdSet of userRecycledFileIds) {
		for (const fileId of fileIdSet) {
			recycledFileIds.add(fileId);
		}
	}

	for (const filePath of actualFiles) {
		if (![...registryPathLookup.keys()].includes(filePath)) {
			issues.push(createIssue({
				type: 'missing_in_registry',
				severity: 'warning',
				source: 'filesystem',
				path: filePath,
				message: `File ${filePath} exists on disk but has no matching registry entry.`
			}));
		}
	}

	for (const directoryPath of actualDirectories) {
		if (![...registryPathLookup.keys()].includes(directoryPath)) {
			issues.push(createIssue({
				type: 'missing_in_registry',
				severity: 'warning',
				source: 'filesystem',
				path: directoryPath,
				message: `Folder ${directoryPath} exists on disk but has no matching registry entry.`
			}));
		}
	}

	for (const entry of recycledEntries) {
		if (!entry || typeof entry !== 'object') {
			issues.push(createIssue({
				type: 'invalid_recycled_entry',
				severity: 'warning',
				source: 'recycled.json',
				message: 'A recycled entry is not a valid object.'
			}));
			continue;
		}
		const entryId = String(entry.id || '');
		const fileId = String(entry.fileId || '');
		const originalPath = normalizeRelativePath(entry.originalPath || '');
		if (!entryId || !fileId) {
			issues.push(createIssue({
				type: 'invalid_recycled_entry',
				severity: 'warning',
				source: 'recycled.json',
				path: originalPath || null,
				message: 'A recycled entry is missing either id or fileId.'
			}));
			continue;
		}
		const registryPath = registryLookup.get(fileId);
		if (originalPath && registryPath && originalPath !== registryPath) {
			issues.push(createIssue({
				type: 'recycled_path_mismatch',
				severity: 'warning',
				source: 'recycled.json',
				fileId: fileId,
				path: originalPath,
				relatedPaths: [registryPath, originalPath],
				message: `Recycled entry ${entryId} references fileId ${fileId} with path ${originalPath}, but the current registry path is ${registryPath}.`
			}));
		}
		if (!registryPath && !actualFiles.has(originalPath)) {
			issues.push(createIssue({
				type: 'orphaned_recycled_entry',
				severity: recycledFileIds.has(fileId) ? 'info' : 'warning',
				source: 'recycled.json',
				fileId: fileId,
				path: originalPath || null,
				actions: [{ id: 'inspect-recycled-entry', label: 'Inspect entry', type: 'details' }],
				message: `Recycled entry ${entryId} refers to fileId ${fileId} and path ${originalPath || 'unknown'}, but no matching file or registry entry exists.`
			}));
		}
	}

	for (const [cacheKey, entry] of Object.entries(previewEntries)) {
		if (!entry || typeof entry !== 'object') {
			issues.push(createIssue({
				type: 'invalid_preview_entry',
				severity: 'warning',
				source: 'preview-cache.json',
				path: String(cacheKey),
				message: 'Preview cache entry is not an object.'
			}));
			continue;
		}
		const fileId = String(entry.fileId || cacheKey || '');
		const relativePath = normalizeRelativePath(entry.relativePath || '');
		if (!fileId) {
			issues.push(createIssue({
				type: 'invalid_preview_entry',
				severity: 'warning',
				source: 'preview-cache.json',
				path: String(cacheKey),
				message: 'Preview cache entry is missing a fileId.'
			}));
			continue;
		}
		const registryPath = registryLookup.get(fileId);
		if (!registryPath) {
			issues.push(createIssue({
				type: 'stale_preview_cache',
				severity: recycledFileIds.has(fileId) ? 'info' : 'warning',
				source: 'preview-cache.json',
				fileId: fileId,
				path: relativePath || String(cacheKey),
				message: `Preview cache entry for fileId ${fileId} is not present in the current registry.${recycledFileIds.has(fileId) ? ' The document is still present in the recycle bin.' : ''}`
			}));
			continue;
		}
		if (relativePath && relativePath !== registryPath) {
			issues.push(createIssue({
				type: 'preview_cache_path_mismatch',
				severity: 'warning',
				source: 'preview-cache.json',
				fileId: fileId,
				path: relativePath,
				relatedPaths: [registryPath, relativePath],
				message: `Preview cache for ${fileId} points to ${relativePath}, but the registry resolves to ${registryPath}.`
			}));
		}
	}

	for (const entry of activities) {
		if (!entry || typeof entry !== 'object') {
			issues.push(createIssue({
				type: 'invalid_activity_entry',
				severity: 'warning',
				source: 'activities.json',
				message: 'An activity record is not a valid object.'
			}));
			continue;
		}
		const fileId = entry.fileId ? String(entry.fileId) : '';
		const fileName = entry.fileName ? String(entry.fileName) : '';
		const activityType = String(entry.type || '');
		if (!fileId) {
			continue;
		}
		if (activityType.includes('folder')) {
			continue;
		}
		if (!registryLookup.has(fileId)) {
			issues.push(createIssue({
				type: 'orphaned_activity_reference',
				severity: recycledFileIds.has(fileId) ? 'info' : 'warning',
				source: 'activities.json',
				fileId: fileId,
				path: fileName || null,
				message: `Activity references fileId ${fileId}, but that file does not exist in the active registry.${recycledFileIds.has(fileId) ? ' The document is still present in the recycle bin.' : ''}`
			}));
		}
	}

	for (const stateFilePath of userStateFiles) {
		const stateFileName = path.basename(stateFilePath);
		const userState = await readJsonFile(stateFilePath, { favorites: [], recent: [] });
		if (!userState || typeof userState !== 'object') {
			issues.push(createIssue({
				type: 'invalid_user_state_file',
				severity: 'warning',
				source: `${stateFileName}`,
				path: stateFileName,
				message: `${stateFileName} is not a valid JSON object.`
			}));
			continue;
		}

		const favorites = Array.isArray(userState.favorites) ? userState.favorites : [];
		const recent = Array.isArray(userState.recent) ? userState.recent : [];
		if (!Array.isArray(userState.favorites) || !Array.isArray(userState.recent)) {
			issues.push(createIssue({
				type: 'invalid_user_state_shape',
				severity: 'warning',
				source: stateFileName,
				path: stateFileName,
				message: `${stateFileName} must expose arrays named favorites and recent.`
			}));
		}

		for (const favoriteId of favorites) {
			const normalizedId = String(favoriteId || '').trim();
			if (!normalizedId) {
				issues.push(createIssue({
					type: 'invalid_favorite_entry',
					severity: 'warning',
					source: stateFileName,
					path: stateFileName,
					message: `${stateFileName} contains an empty favorite id.`
				}));
				continue;
			}
			if (!accessibleRegistryLookup.has(normalizedId)) {
				issues.push(createIssue({
					type: 'stale_favorite_reference',
					severity: recycledFileIds.has(normalizedId) ? 'info' : 'warning',
					source: stateFileName,
					fileId: normalizedId,
					path: stateFileName,
					message: `${stateFileName} favorites fileId ${normalizedId}, but it is not present in the active or shared registries.${recycledFileIds.has(normalizedId) ? ' The document is still present in the recycle bin.' : ''}`
				}));
			}
		}

		for (const recentEntry of recent) {
			if (!recentEntry || typeof recentEntry !== 'object') {
				issues.push(createIssue({
					type: 'invalid_recent_entry',
					severity: 'warning',
					source: stateFileName,
					path: stateFileName,
					message: `${stateFileName} contains a recent entry that is not an object.`
				}));
				continue;
			}
			const recentFileId = String(recentEntry.fileId || '').trim();
			if (!recentFileId) {
				issues.push(createIssue({
					type: 'invalid_recent_entry',
					severity: 'warning',
					source: stateFileName,
					path: stateFileName,
					message: `${stateFileName} contains a recent entry without a fileId.`
				}));
				continue;
			}
			if (!accessibleRegistryLookup.has(recentFileId)) {
				issues.push(createIssue({
					type: 'stale_recent_reference',
					severity: recycledFileIds.has(recentFileId) ? 'info' : 'warning',
					source: stateFileName,
					fileId: recentFileId,
					path: stateFileName,
					message: `${stateFileName} recent entry references fileId ${recentFileId}, but it is not present in the active or shared registries.${recycledFileIds.has(recentFileId) ? ' The document is still present in the recycle bin.' : ''}`
				}));
			}
		}
	}

	const issuesByType = new Map();
	for (const issue of issues) {
		issuesByType.set(issue.id, issue);
	}

	const uniqueIssues = [...issuesByType.values()];
	uniqueIssues.sort((left, right) => {
		if (left.severity !== right.severity) {
			return left.severity === 'error' ? -1 : 1;
		}
		return left.type.localeCompare(right.type);
	});

	const summary = {
		totalFiles: actualFiles.size,
		totalRegistryEntries: Object.keys(registryEntries).length,
		totalRecycledEntries: recycledEntries.length,
		totalPreviewEntries: Object.keys(previewEntries).length,
		totalActivityEntries: activities.length,
		issueCount: uniqueIssues.filter((issue) => issue.severity === 'error' || issue.severity === 'warning').length,
		errorCount: uniqueIssues.filter((issue) => issue.severity === 'error').length,
		warningCount: uniqueIssues.filter((issue) => issue.severity === 'warning').length,
		infoCount: uniqueIssues.filter((issue) => issue.severity === 'info').length
	};

	return {
		status: summary.errorCount + summary.warningCount === 0 ? 'ok' : 'inconsistent',
		checkedAt: new Date().toISOString(),
		documentRoot: documentRoot,
		stateRoot: stateRoot,
		summary: summary,
		issues: uniqueIssues,
		actions: [
			{ id: 'download-report', label: 'Download report', type: 'download' }
		]
	};
}

module.exports = {
	checkDocumentConsistency: checkDocumentConsistency
};
