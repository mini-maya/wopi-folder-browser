'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { createHttpError } = require('./errors');
const { removeActivityEntriesForFile } = require('./activityStore');
const { removePreviewEntriesForFile } = require('./previewStore');
const {
	getContextStateRoot,
	ensureDirectory,
	readJson,
	writeJsonAtomic
} = require('./statePaths');
const { removeDocumentReferences } = require('./userStateStore');
const { deletePublicSharesByResource } = require('./shareStore');
const {
	SUPPORTED_MIME_TYPES,
	createLegacyFileId,
	decodeLegacyFileId,
	ensureDocumentRoot,
	ensurePathId,
	getMimeType,
	getRegistryEntryPath,
	getTargetRelativePath,
	isPathWithinPrefix,
	loadRegistry,
	normalizeRelativePath,
	normalizeRegistryEntry,
	registerPathForId,
	resolveAbsolutePath,
	resolveRelativePathFromId,
	resolveTargetDirectory,
	saveRegistry
} = require('./documentStorePaths');
const { createVersionSnapshot, deleteAllVersions } = require('./versionStore');

const DOCUMENT_TYPE_DEFAULTS = {
	text: { extension: '.odt', fileNameKey: 'Untitled document' },
	spreadsheet: { extension: '.ods', fileNameKey: 'Untitled spreadsheet' },
	presentation: { extension: '.odp', fileNameKey: 'Untitled presentation' },
	'microsoft-text': { extension: '.docx', fileNameKey: 'Untitled document' },
	'microsoft-spreadsheet': { extension: '.xlsx', fileNameKey: 'Untitled spreadsheet' },
	'microsoft-presentation': { extension: '.pptx', fileNameKey: 'Untitled presentation' }
};

async function walkDirectory(documentRoot, relativeDirectory = '') {
	const absoluteDirectory = relativeDirectory
		? resolveAbsolutePath(documentRoot, relativeDirectory)
		: documentRoot;
	const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));

	let documents = [];
	for (const entry of entries) {
		if (entry.name.startsWith('.')) {
			continue;
		}
		const relativePath = relativeDirectory
			? path.posix.join(relativeDirectory, entry.name)
			: entry.name;

		if (entry.isDirectory()) {
			const stats = await fs.stat(resolveAbsolutePath(documentRoot, relativePath));
			const fileId = await ensurePathId(documentRoot, relativePath);
			documents.push(buildMetadata(documentRoot, fileId, relativePath, stats));
			const nestedDocuments = await walkDirectory(documentRoot, relativePath);
			documents = documents.concat(nestedDocuments);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		if (!getMimeType(relativePath)) {
			continue;
		}

		const stats = await fs.stat(resolveAbsolutePath(documentRoot, relativePath));
		const fileId = await ensurePathId(documentRoot, relativePath);
		await updateRegistryFileMetadata(documentRoot, fileId, relativePath, stats);
		documents.push(buildMetadata(documentRoot, fileId, relativePath, stats));
	}

	return documents;
}

async function calculateMd5(filePath) {
	const fileBuffer = await fs.readFile(filePath);
	return crypto.createHash('md5').update(fileBuffer).digest('hex');
}

async function updateRegistryFileMetadata(documentRoot, fileId, relativePath, stats) {
	if (!stats || !stats.isFile()) {
		return;
	}

	const normalizedPath = normalizeRelativePath(relativePath);
	const registry = await loadRegistry(documentRoot);
	const currentEntry = registry.entries[String(fileId)];
	const existingPath = getRegistryEntryPath(currentEntry);
	if (existingPath && existingPath !== normalizedPath) {
		return;
	}

	const metadata = {
		path: normalizedPath,
		md5: await calculateMd5(resolveAbsolutePath(documentRoot, normalizedPath))
	};

	if (currentEntry && typeof currentEntry === 'object' && currentEntry.md5 === metadata.md5) {
		return;
	}

	registry.entries[String(fileId)] = metadata;
	await saveRegistry(documentRoot, registry);
}

async function collectCurrentFileMetadata(documentRoot) {
	const files = [];

	async function walk(relativeDirectory = '') {
		const absoluteDirectory = relativeDirectory
			? resolveAbsolutePath(documentRoot, relativeDirectory)
			: documentRoot;
		const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));

		for (const entry of entries) {
			if (entry.name.startsWith('.')) {
				continue;
			}
			const relativePath = relativeDirectory
				? path.posix.join(relativeDirectory, entry.name)
				: entry.name;
			const absolutePath = resolveAbsolutePath(documentRoot, relativePath);

			if (entry.isDirectory()) {
				await walk(relativePath);
				continue;
			}

			if (!entry.isFile() || !getMimeType(relativePath)) {
				continue;
			}

			files.push({
				relativePath: relativePath,
				absolutePath: absolutePath,
				md5: await calculateMd5(absolutePath)
			});
		}
	}

	await walk();
	return files;
}

function scorePathSimilarity(oldRelativePath, candidateRelativePath) {
	const oldName = path.posix.basename(oldRelativePath);
	const candidateName = path.posix.basename(candidateRelativePath);
	const oldExtension = path.posix.extname(oldRelativePath).toLowerCase();
	const candidateExtension = path.posix.extname(candidateRelativePath).toLowerCase();
	const oldParent = path.posix.dirname(oldRelativePath) || '.';
	const candidateParent = path.posix.dirname(candidateRelativePath) || '.';
	const oldSegments = oldRelativePath.split('/');
	const candidateSegments = candidateRelativePath.split('/');
	let commonPrefixLength = 0;
	while (commonPrefixLength < oldSegments.length && commonPrefixLength < candidateSegments.length && oldSegments[commonPrefixLength] === candidateSegments[commonPrefixLength]) {
		commonPrefixLength += 1;
	}

	let score = commonPrefixLength * 10;
	if (oldName === candidateName) {
		score += 50;
	}
	if (oldExtension === candidateExtension) {
		score += 20;
	}
	if (oldParent === candidateParent) {
		score += 30;
	}

	const depthDelta = Math.abs(oldSegments.length - candidateSegments.length);
	const differingSegments = oldSegments.length + candidateSegments.length - (commonPrefixLength * 2);
	score -= depthDelta + differingSegments;

	return score;
}

async function reconcileMissingEntries(documentRoot) {
	const registry = await loadRegistry(documentRoot);
	let changed = false;
	const currentFiles = await collectCurrentFileMetadata(documentRoot);
	const indexedFiles = new Map();
	for (const file of currentFiles) {
		const filesWithHash = indexedFiles.get(file.md5) || [];
		filesWithHash.push(file);
		indexedFiles.set(file.md5, filesWithHash);
	}

	for (const [entryId, entryValue] of Object.entries(registry.entries || {})) {
		const currentPath = getRegistryEntryPath(entryValue);
		if (!currentPath) {
			continue;
		}

		const absolutePath = resolveAbsolutePath(documentRoot, currentPath);
		let stat;
		try {
			stat = await fs.stat(absolutePath);
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
			stat = null;
		}

		if (stat) {
			if (stat.isDirectory()) {
				continue;
			}
			const normalizedEntry = normalizeRegistryEntry(entryValue, currentPath);
			if (!normalizedEntry || normalizedEntry.md5 === null) {
				const md5 = await calculateMd5(absolutePath);
				const metadata = {
					path: currentPath,
					md5: md5
				};
				registry.entries[entryId] = metadata;
				changed = true;
			}
			continue;
		}

		const normalizedEntry = normalizeRegistryEntry(entryValue, currentPath) || { path: currentPath, md5: null };
		if (!normalizedEntry.md5) {
			continue;
		}

		const candidates = indexedFiles.get(normalizedEntry.md5) || [];
		if (candidates.length === 0) {
			continue;
		}

		const scoredCandidates = candidates.map((candidate) => ({
			candidate: candidate,
			score: scorePathSimilarity(normalizedEntry.path, candidate.relativePath)
		})).sort((left, right) => right.score - left.score);

		const winner = scoredCandidates[0];
		const second = scoredCandidates[1] || { score: Number.NEGATIVE_INFINITY };
		if (winner.score - second.score < 15) {
			continue;
		}

		registry.entries[entryId] = {
			path: winner.candidate.relativePath,
			md5: winner.candidate.md5
		};
		changed = true;
	}

	if (changed) {
		await saveRegistry(documentRoot, registry);
	}

	return changed;
}

async function listDocuments(documentRoot) {
	await ensureDocumentRoot(documentRoot);
	await reconcileMissingEntries(documentRoot);
	const documents = await walkDirectory(documentRoot);
	const missingRegistryEntries = await listMissingRegistryEntries(documentRoot, documents);
	return documents.concat(missingRegistryEntries);
}

async function listMissingRegistryEntries(documentRoot, knownDocuments = []) {
	const registry = await loadRegistry(documentRoot);
	const knownDocumentIds = new Set(knownDocuments.map((document) => String(document.id)));
	const missingRegistryEntries = [];
	for (const [entryId, entryValue] of Object.entries(registry.entries || {})) {
		const normalizedEntryId = String(entryId || '').trim();
		if (!normalizedEntryId || knownDocumentIds.has(normalizedEntryId)) {
			continue;
		}

		let normalizedRelativePath;
		try {
			normalizedRelativePath = getRegistryEntryPath(entryValue);
			if (normalizedRelativePath) {
				normalizedRelativePath = normalizeRelativePath(normalizedRelativePath);
			}
		} catch (error) {
			continue;
		}
		if (!normalizedRelativePath) {
			continue;
		}

		const absolutePath = resolveAbsolutePath(documentRoot, normalizedRelativePath);
		try {
			await fs.stat(absolutePath);
			continue;
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}

		const mimeType = getMimeType(normalizedRelativePath);
		const isDirectory = !mimeType;
		missingRegistryEntries.push({
			id: normalizedEntryId,
			name: path.posix.basename(normalizedRelativePath),
			relativePath: normalizedRelativePath,
			absolutePath: absolutePath,
			extension: isDirectory ? '' : path.extname(normalizedRelativePath).toLowerCase(),
			mimeType: mimeType,
			size: 0,
			createdAt: null,
			updatedAt: null,
			version: 'missing',
			kind: isDirectory ? 'folder' : 'file',
			isDirectory: isDirectory,
			isMissingOnDisk: true
		});
	}

	return missingRegistryEntries;
}

async function pruneMissingDocumentEntries(documentRoot) {
	await ensureDocumentRoot(documentRoot);
	const knownDocuments = await walkDirectory(documentRoot);
	const missingEntries = await listMissingRegistryEntries(documentRoot, knownDocuments);
	if (missingEntries.length === 0) {
		return { removed: false, missingEntryCount: 0, removedFileIds: [] };
	}

	const removedFileIds = [];
	for (const missingEntry of missingEntries) {
		const result = await cleanupStaleDocumentEntry(documentRoot, { fileId: missingEntry.id });
		if (result.removed) {
			removedFileIds.push(...(result.fileIds || []));
		}
	}

	return {
		removed: removedFileIds.length > 0,
		missingEntryCount: missingEntries.length,
		removedFileIds: [...new Set(removedFileIds)]
	};
}

function buildMetadata(documentRoot, fileId, relativePath, stats) {
	const isDirectory = stats.isDirectory();
	return {
		id: fileId,
		name: path.posix.basename(relativePath),
		relativePath: relativePath,
		absolutePath: resolveAbsolutePath(documentRoot, relativePath),
		extension: isDirectory ? '' : path.extname(relativePath).toLowerCase(),
		mimeType: isDirectory ? null : getMimeType(relativePath),
		size: isDirectory ? 0 : stats.size,
		createdAt: stats.birthtime.toISOString(),
		updatedAt: stats.mtime.toISOString(),
		version: `${Math.trunc(stats.mtimeMs)}-${stats.size}`,
		kind: isDirectory ? 'folder' : 'file',
		isDirectory: isDirectory
	};
}

function normalizeConflictEntry(document) {
	if (!document) {
		return null;
	}
	return {
		name: document.name,
		type: document.isDirectory ? 'directory' : 'file',
		size: document.size,
		modifiedAt: document.updatedAt,
		relativePath: document.relativePath,
		mimeType: document.mimeType || null,
		kind: document.kind || (document.isDirectory ? 'folder' : 'file')
	};
}

function createFileConflictError(operation, sourceDocument, targetDocument) {
	const message = `A ${operation} target already exists.`;
	const error = createHttpError(409, message);
	error.code = 'FILE_CONFLICT';
	error.details = {
		error: 'FILE_CONFLICT',
		conflictType: sourceDocument?.isDirectory || targetDocument?.isDirectory ? 'directory' : 'file',
		operation: operation,
		source: normalizeConflictEntry(sourceDocument),
		target: normalizeConflictEntry(targetDocument),
		message: message
	};
	return error;
}

function createDirectoryConflictError(operation, sourceDocument, targetDocument) {
	const message = `A ${operation} target folder already exists.`;
	const error = createHttpError(409, message);
	error.code = 'FILE_CONFLICT';
	error.details = {
		error: 'FILE_CONFLICT',
		conflictType: 'directory',
		operation: operation,
		source: normalizeConflictEntry(sourceDocument),
		target: normalizeConflictEntry(targetDocument),
		message: message
	};
	return error;
}

async function getTargetDocument(documentRoot, relativePath) {
	const absolutePath = resolveAbsolutePath(documentRoot, relativePath);
	try {
		const stats = await fs.stat(absolutePath);
		const existingFileId = await ensurePathId(documentRoot, relativePath);
		return buildMetadata(documentRoot, existingFileId, relativePath, stats);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

async function getAvailableName(documentRoot, directory, desiredName) {
	const normalizedDirectory = directory === undefined || directory === null || directory === ''
		? ''
		: normalizeRelativePath(directory);
	const baseName = String(desiredName || 'untitled').replace(/\\/g, '/');
	const parsed = path.posix.parse(baseName);
	let candidateName = normalizeRelativePath(baseName);
	let counter = 1;

	while (true) {
		const relativePath = getTargetRelativePath(normalizedDirectory, candidateName);
		const existingDocument = await getTargetDocument(documentRoot, relativePath);
		if (!existingDocument) {
			return candidateName;
		}
		const stem = parsed.name || normalizedNameWithoutExtension(baseName);
		const extension = parsed.ext || '';
		candidateName = `${stem} (${counter})${extension}`;
		counter += 1;
	}
}

function normalizedNameWithoutExtension(value) {
	const parsed = path.posix.parse(String(value || 'untitled').replace(/\\/g, '/'));
	return parsed.name || parsed.base || 'untitled';
}

async function updateRegistryPath(documentRoot, fileId, newRelativePath) {
	const registry = await loadRegistry(documentRoot);
	const normalizedPath = normalizeRelativePath(newRelativePath);
	const existingEntry = registry.entries[String(fileId)];
	registry.entries[String(fileId)] = existingEntry && typeof existingEntry === 'object'
		? { ...existingEntry, path: normalizedPath }
		: normalizedPath;
	await saveRegistry(documentRoot, registry);
}

async function createDocument(documentRoot, options) {
	await ensureDocumentRoot(documentRoot);
	const baseDirectory = options.directory ? normalizeRelativePath(options.directory) : '';
	const baseName = options.fileName;
	const extension = path.extname(baseName).toLowerCase();
	if (!getMimeType(baseName) || !extension) {
		throw createHttpError(400, 'Unsupported file extension for new document.');
	}

	const directoryPath = baseDirectory ? resolveAbsolutePath(documentRoot, baseDirectory) : documentRoot;
	await fs.mkdir(directoryPath, { recursive: true });

	const relativePath = baseDirectory ? path.posix.join(baseDirectory, baseName) : baseName;
	const absolutePath = resolveAbsolutePath(documentRoot, relativePath);

	try {
		await fs.access(absolutePath);
		throw createHttpError(409, 'A file with this name already exists.');
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}

	await fs.writeFile(absolutePath, options.content || Buffer.alloc(0));
	const fileId = await ensurePathId(documentRoot, relativePath);
	const stats = await fs.stat(absolutePath);
	await updateRegistryFileMetadata(documentRoot, fileId, relativePath, stats);
	return buildMetadata(documentRoot, fileId, relativePath, stats);
}

async function createFolder(documentRoot, options) {
	await ensureDocumentRoot(documentRoot);
	const baseDirectory = options.directory ? normalizeRelativePath(options.directory) : '';
	const folderName = normalizeRelativePath(options.folderName);
	const relativePath = baseDirectory ? path.posix.join(baseDirectory, folderName) : folderName;
	const absolutePath = resolveAbsolutePath(documentRoot, relativePath);
	await fs.mkdir(path.dirname(absolutePath), { recursive: true });

	try {
		await fs.mkdir(absolutePath);
	} catch (error) {
		if (error.code === 'EEXIST') {
			throw createHttpError(409, 'A folder with this name already exists.');
		}
		throw error;
	}

	const fileId = await ensurePathId(documentRoot, relativePath);
	const stats = await fs.stat(absolutePath);
	return buildMetadata(documentRoot, fileId, relativePath, stats);
}

async function createDocumentByType(documentRoot, options) {
	const typeDefaults = DOCUMENT_TYPE_DEFAULTS[options.documentType];
	if (!typeDefaults) {
		throw createHttpError(400, 'Unsupported document type.');
	}

	const configuredBaseName = options.baseName || typeDefaults.fileNameKey;
	const baseName = configuredBaseName.endsWith(typeDefaults.extension)
		? configuredBaseName.slice(0, -typeDefaults.extension.length)
		: configuredBaseName;
	return createDocument(documentRoot, {
		directory: options.directory,
		fileName: `${baseName}${typeDefaults.extension}`,
		content: options.content || Buffer.alloc(0)
	});
}

async function resolveUploadDirectory(documentRoot, targetDirectory) {
	const resolvedDirectory = resolveTargetDirectory(targetDirectory, '');
	if (!resolvedDirectory) {
		return {
			relativePath: '',
			absolutePath: documentRoot
		};
	}

	const absolutePath = resolveAbsolutePath(documentRoot, resolvedDirectory);
	let stats;
	try {
		stats = await fs.stat(absolutePath);
	} catch (error) {
		if (error.code === 'ENOENT') {
			throw createHttpError(400, 'The target folder does not exist.');
		}

		throw error;
	}

	if (!stats.isDirectory()) {
		throw createHttpError(400, 'The target path is not a folder.');
	}

	return {
		relativePath: resolvedDirectory,
		absolutePath: absolutePath
	};
}

async function getDocumentById(documentRoot, fileId) {
	await ensureDocumentRoot(documentRoot);
	const relativePath = await resolveRelativePathFromId(documentRoot, fileId);
	const absolutePath = resolveAbsolutePath(documentRoot, relativePath);
	let stats;
	try {
		stats = await fs.stat(absolutePath);
	} catch (error) {
		if (error.code === 'ENOENT') {
			throw createHttpError(404, 'The requested document does not exist.');
		}

		throw error;
	}

	if (!stats.isDirectory() && !getMimeType(relativePath)) {
		throw createHttpError(404, 'The requested file type is not supported.');
	}

	return buildMetadata(documentRoot, fileId, relativePath, stats);
}

async function uploadDocuments(documentRoot, options) {
	await ensureDocumentRoot(documentRoot);

	const uploads = Array.isArray(options.files) ? options.files : [];
	if (uploads.length === 0) {
		throw createHttpError(400, 'No files were selected for upload.');
	}

	const targetDirectory = await resolveUploadDirectory(documentRoot, options.directory);
	const uploadedDocuments = [];
	const errors = [];

	for (const upload of uploads) {
		const sourceLabel = String(upload.relativePath || upload.fileName || '').replace(/\\/g, '/');
		const uploadLabel = sourceLabel || 'unnamed file';

		let normalizedSourcePath;
		try {
			normalizedSourcePath = normalizeRelativePath(upload.relativePath || upload.fileName);
		} catch (error) {
			errors.push({
				relativePath: uploadLabel,
				message: error.message
			});
			continue;
		}

		const nestedDirectory = path.posix.dirname(normalizedSourcePath);
		const targetRelativeDirectory = nestedDirectory === '.'
			? targetDirectory.relativePath
			: (targetDirectory.relativePath
				? path.posix.join(targetDirectory.relativePath, nestedDirectory)
				: nestedDirectory);
		const targetFileName = path.posix.basename(normalizedSourcePath);
		const targetRelativePath = getTargetRelativePath(targetRelativeDirectory, targetFileName);

		if (!getMimeType(targetRelativePath)) {
			errors.push({
				relativePath: normalizedSourcePath,
				message: 'The file type is not supported.'
			});
			continue;
		}

		const targetPath = resolveAbsolutePath(documentRoot, targetRelativePath);

		try {
			await fs.mkdir(path.dirname(targetPath), { recursive: true });
			await ensureTargetDoesNotExist(targetPath);
			await fs.writeFile(targetPath, upload.content || Buffer.alloc(0));
			const fileId = await ensurePathId(documentRoot, targetRelativePath);
			const stats = await fs.stat(targetPath);
			await updateRegistryFileMetadata(documentRoot, fileId, targetRelativePath, stats);
			uploadedDocuments.push(buildMetadata(documentRoot, fileId, targetRelativePath, stats));
		} catch (error) {
			errors.push({
				relativePath: normalizedSourcePath,
				message: error.message
			});
		}
	}

	return {
		uploadedDocuments: uploadedDocuments,
		errors: errors
	};
}

async function ensureTargetDoesNotExist(targetPath) {
	try {
		await fs.access(targetPath);
		throw createHttpError(409, 'The target path already exists.');
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
}

async function cleanupStaleDocumentEntry(documentRoot, options = {}) {
	const fileId = options.fileId ? String(options.fileId) : null;
	const relativePath = options.relativePath ? normalizeRelativePath(options.relativePath) : null;
	if (!fileId && !relativePath) {
		return { removed: false, fileIds: [] };
	}

	const registry = await loadRegistry(documentRoot);
	const fileIdsToRemove = new Set();
	const nextEntries = {};
	for (const [entryId, entryValue] of Object.entries(registry.entries)) {
		const entryPath = getRegistryEntryPath(entryValue);
		const normalizedEntryPath = entryPath ? normalizeRelativePath(entryPath) : null;
		const matchesId = fileId && String(entryId) === fileId;
		const matchesPath = relativePath && normalizedEntryPath && (normalizedEntryPath === relativePath || isPathWithinPrefix(normalizedEntryPath, relativePath));
		if (matchesId || matchesPath) {
			fileIdsToRemove.add(String(entryId));
			continue;
		}
		nextEntries[entryId] = entryValue;
	}

	if (fileIdsToRemove.size === 0) {
		return { removed: false, fileIds: [] };
	}

	registry.entries = nextEntries;
	await saveRegistry(documentRoot, registry);
	for (const staleFileId of fileIdsToRemove) {
		await deleteAllVersions(documentRoot, staleFileId);
		await removePreviewEntriesForFile(documentRoot, staleFileId);
		await removeActivityEntriesForFile(documentRoot, staleFileId);
		await removeDocumentReferences(documentRoot, staleFileId);
		await deletePublicSharesByResource(documentRoot, staleFileId);
	}

	return {
		removed: true,
		fileIds: [...fileIdsToRemove]
	};
}

module.exports = {
	SUPPORTED_MIME_TYPES: SUPPORTED_MIME_TYPES,
	createLegacyFileId: createLegacyFileId,
	cleanupStaleDocumentEntry: cleanupStaleDocumentEntry,
	createDocument: createDocument,
	createDocumentByType: createDocumentByType,
	createFolder: createFolder,
	createFileConflictError: createFileConflictError,
	getAvailableName: getAvailableName,
	getDocumentById: getDocumentById,
	listDocuments: listDocuments,
	pruneMissingDocumentEntries: pruneMissingDocumentEntries,
	registerPathForId: registerPathForId,
	uploadDocuments: uploadDocuments
};
