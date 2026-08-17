'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { createHttpError } = require('./errors');
const { STATE_DIRECTORY_NAME, getStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

const SUPPORTED_MIME_TYPES = {
	'.csv': 'text/csv',
	'.doc': 'application/msword',
	'.docm': 'application/vnd.ms-word.document.macroEnabled.12',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.fodg': 'application/vnd.oasis.opendocument.graphics-flat-xml',
	'.fodp': 'application/vnd.oasis.opendocument.presentation-flat-xml',
	'.fods': 'application/vnd.oasis.opendocument.spreadsheet-flat-xml',
	'.fodt': 'application/vnd.oasis.opendocument.text-flat-xml',
	'.odp': 'application/vnd.oasis.opendocument.presentation',
	'.odg': 'application/vnd.oasis.opendocument.graphics',
	'.ods': 'application/vnd.oasis.opendocument.spreadsheet',
	'.odt': 'application/vnd.oasis.opendocument.text',
	'.otp': 'application/vnd.oasis.opendocument.presentation-template',
	'.ots': 'application/vnd.oasis.opendocument.spreadsheet-template',
	'.ott': 'application/vnd.oasis.opendocument.text-template',
	'.potm': 'application/vnd.ms-powerpoint.template.macroEnabled.12',
	'.potx': 'application/vnd.openxmlformats-officedocument.presentationml.template',
	'.ppt': 'application/vnd.ms-powerpoint',
	'.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
	'.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
	'.rtf': 'application/rtf',
	'.sxc': 'application/vnd.sun.xml.calc',
	'.sxi': 'application/vnd.sun.xml.impress',
	'.sxw': 'application/vnd.sun.xml.writer',
	'.tsv': 'text/tab-separated-values',
	'.txt': 'text/plain',
	'.xls': 'application/vnd.ms-excel',
	'.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'.xltm': 'application/vnd.ms-excel.template.macroEnabled.12',
	'.xltx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.template'
};

const DOCUMENT_TYPE_DEFAULTS = {
	text: { extension: '.odt', fileNameKey: 'Untitled document' },
	spreadsheet: { extension: '.ods', fileNameKey: 'Untitled spreadsheet' },
	presentation: { extension: '.odp', fileNameKey: 'Untitled presentation' },
	'microsoft-text': { extension: '.docx', fileNameKey: 'Untitled document' },
	'microsoft-spreadsheet': { extension: '.xlsx', fileNameKey: 'Untitled spreadsheet' },
	'microsoft-presentation': { extension: '.pptx', fileNameKey: 'Untitled presentation' }
};

function getRegistryPath(documentRoot) {
	return path.join(getStateRoot(documentRoot), 'file-registry.json');
}

async function ensureDocumentRoot(documentRoot) {
	await fs.mkdir(documentRoot, { recursive: true });
	await ensureDirectory(getStateRoot(documentRoot));
}

function normalizeRelativePath(relativePath) {
	const normalized = String(relativePath || '').replace(/\\/g, '/');
	const segments = normalized.split('/').filter(Boolean);
	if (segments.length === 0) {
		throw createHttpError(400, 'The file path does not resolve to a document path.');
	}

	if (segments.some((segment) => segment === '.' || segment === '..')) {
		throw createHttpError(400, 'The file path contains an invalid document path.');
	}

	return segments.join('/');
}

function getMimeType(relativePath) {
	return SUPPORTED_MIME_TYPES[path.extname(relativePath).toLowerCase()] || null;
}

function resolveAbsolutePath(documentRoot, relativePath) {
	const safeRelativePath = normalizeRelativePath(relativePath);
	const absolutePath = path.resolve(documentRoot, safeRelativePath);
	const relativeToRoot = path.relative(documentRoot, absolutePath);
	if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
		throw createHttpError(400, 'The requested document path escapes the document root.');
	}

	return absolutePath;
}

function isPathWithinPrefix(relativePath, prefix) {
	return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

function getTargetRelativePath(targetDirectory, targetName) {
	const normalizedTargetName = normalizeRelativePath(targetName);
	if (!targetDirectory || targetDirectory === '.' || targetDirectory === './') {
		return normalizedTargetName;
	}

	return path.posix.join(normalizeRelativePath(targetDirectory), normalizedTargetName);
}

function resolveTargetDirectory(targetDirectory, fallbackDirectory) {
	if (targetDirectory === undefined || targetDirectory === null) {
		const effectiveFallback = fallbackDirectory === '.' ? '' : fallbackDirectory;
		return effectiveFallback === undefined || effectiveFallback === null ? '' : effectiveFallback;
	}

	if (targetDirectory === '' || targetDirectory === '.') {
		return '';
	}

	return normalizeRelativePath(targetDirectory);
}

function createLegacyFileId(relativePath) {
	return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function decodeLegacyFileId(fileId) {
	return Buffer.from(fileId, 'base64url').toString('utf8');
}

async function loadRegistry(documentRoot) {
	const registry = await readJson(getRegistryPath(documentRoot), {
		entries: {}
	});
	if (!registry || typeof registry !== 'object' || !registry.entries || typeof registry.entries !== 'object') {
		return { entries: {} };
	}

	return registry;
}

async function saveRegistry(documentRoot, registry) {
	await writeJsonAtomic(getRegistryPath(documentRoot), registry);
}

function toMetadata(documentRoot, fileId, relativePath, stats) {
	return {
		id: fileId,
		name: path.posix.basename(relativePath),
		relativePath: relativePath,
		absolutePath: resolveAbsolutePath(documentRoot, relativePath),
		extension: path.extname(relativePath).toLowerCase(),
		mimeType: getMimeType(relativePath),
		size: stats.size,
		createdAt: stats.birthtime.toISOString(),
		updatedAt: stats.mtime.toISOString(),
		version: `${Math.trunc(stats.mtimeMs)}-${stats.size}`
	};
}

async function ensurePathId(documentRoot, relativePath) {
	const normalizedPath = normalizeRelativePath(relativePath);
	const registry = await loadRegistry(documentRoot);
	const existingEntry = Object.entries(registry.entries).find((entry) => entry[1] === normalizedPath);
	if (existingEntry) {
		return existingEntry[0];
	}

	const generatedId = crypto.randomUUID();
	registry.entries[generatedId] = normalizedPath;
	await saveRegistry(documentRoot, registry);
	return generatedId;
}

async function resolveRelativePathFromId(documentRoot, fileId) {
	const registry = await loadRegistry(documentRoot);
	if (registry.entries[fileId]) {
		return registry.entries[fileId];
	}

	// fallback for path-encoded ids from previous versions
	let legacyPath;
	try {
		legacyPath = normalizeRelativePath(decodeLegacyFileId(fileId));
	} catch (error) {
		throw createHttpError(404, 'The requested document id is unknown.');
	}

	const absolutePath = resolveAbsolutePath(documentRoot, legacyPath);
	try {
		await fs.stat(absolutePath);
	} catch (error) {
		if (error.code === 'ENOENT') {
			throw createHttpError(404, 'The requested document does not exist.');
		}

		throw error;
	}

	const stableId = await ensurePathId(documentRoot, legacyPath);
	return registry.entries[stableId] || legacyPath;
}

async function walkDirectory(documentRoot, relativeDirectory = '') {
	const absoluteDirectory = relativeDirectory
		? resolveAbsolutePath(documentRoot, relativeDirectory)
		: documentRoot;
	const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));

	let documents = [];
	for (const entry of entries) {
		if (entry.name === STATE_DIRECTORY_NAME) {
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
		documents.push(buildMetadata(documentRoot, fileId, relativePath, stats));
	}

	return documents;
}

async function listDocuments(documentRoot) {
	await ensureDocumentRoot(documentRoot);
	return walkDirectory(documentRoot);
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
	registry.entries[fileId] = normalizeRelativePath(newRelativePath);
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

async function copyDirectoryRecursive(sourcePath, targetPath) {
	await fs.mkdir(targetPath, { recursive: true });
	const entries = await fs.readdir(sourcePath, { withFileTypes: true });
	for (const entry of entries) {
		const sourceEntryPath = path.join(sourcePath, entry.name);
		const targetEntryPath = path.join(targetPath, entry.name);
		if (entry.isDirectory()) {
			await copyDirectoryRecursive(sourceEntryPath, targetEntryPath);
			continue;
		}

		if (entry.isFile()) {
			await fs.copyFile(sourceEntryPath, targetEntryPath);
		}
	}
}

async function deleteRegistryEntries(documentRoot, relativePath) {
	const registry = await loadRegistry(documentRoot);
	let changed = false;
	for (const [entryId, entryPath] of Object.entries(registry.entries)) {
		if (isPathWithinPrefix(entryPath, relativePath)) {
			delete registry.entries[entryId];
			changed = true;
		}
	}

	if (changed) {
		await saveRegistry(documentRoot, registry);
	}
}

async function remapRegistryPaths(documentRoot, sourceRelativePath, targetRelativePath) {
	const registry = await loadRegistry(documentRoot);
	const updatedEntries = {};
	for (const [entryId, entryPath] of Object.entries(registry.entries)) {
		if (isPathWithinPrefix(entryPath, sourceRelativePath)) {
			const suffix = entryPath.slice(sourceRelativePath.length);
			updatedEntries[entryId] = `${targetRelativePath}${suffix}`;
			continue;
		}

		updatedEntries[entryId] = entryPath;
	}

	registry.entries = updatedEntries;
	await saveRegistry(documentRoot, registry);
}

async function integrateDirectoryTree(documentRoot, sourceRelativePath, targetRelativePath, options = {}) {
	const sourceAbsolutePath = resolveAbsolutePath(documentRoot, sourceRelativePath);
	const targetAbsolutePath = resolveAbsolutePath(documentRoot, targetRelativePath);
	await fs.mkdir(targetAbsolutePath, { recursive: true });
	const entries = await fs.readdir(sourceAbsolutePath, { withFileTypes: true });

	for (const entry of entries) {
		const sourceEntryRelativePath = path.posix.join(sourceRelativePath, entry.name);
		const targetEntryRelativePath = path.posix.join(targetRelativePath, entry.name);
		const sourceEntryAbsolutePath = resolveAbsolutePath(documentRoot, sourceEntryRelativePath);
		const targetEntryAbsolutePath = resolveAbsolutePath(documentRoot, targetEntryRelativePath);

		if (entry.isDirectory()) {
			const existingTarget = await getTargetDocument(documentRoot, targetEntryRelativePath);
			if (!existingTarget) {
				await copyDirectoryRecursive(sourceEntryAbsolutePath, targetEntryAbsolutePath);
				continue;
			}
			if (!existingTarget.isDirectory) {
				const resolution = options.fileConflictResolution || 'skip';
				if (resolution === 'skip') {
					continue;
				}
				if (resolution === 'overwrite') {
					await fs.rm(targetEntryAbsolutePath, { recursive: true, force: true });
					await copyDirectoryRecursive(sourceEntryAbsolutePath, targetEntryAbsolutePath);
					continue;
				}
				if (resolution === 'keep_both') {
					const nextTargetName = await getAvailableName(documentRoot, path.posix.dirname(targetEntryRelativePath), entry.name);
					const nextTargetRelativePath = getTargetRelativePath(path.posix.dirname(targetEntryRelativePath), nextTargetName);
					const nextTargetAbsolutePath = resolveAbsolutePath(documentRoot, nextTargetRelativePath);
					await copyDirectoryRecursive(sourceEntryAbsolutePath, nextTargetAbsolutePath);
					continue;
				}
				throw createFileConflictError(options.operation || 'copy', { name: entry.name, isDirectory: true, size: 0, updatedAt: new Date().toISOString(), kind: 'folder' }, existingTarget);
			}
			const directoryResolution = options.directoryConflictResolution || 'integrate';
			if (directoryResolution === 'skip') {
				continue;
			}
			if (directoryResolution === 'replace') {
				await fs.rm(targetEntryAbsolutePath, { recursive: true, force: true });
				await copyDirectoryRecursive(sourceEntryAbsolutePath, targetEntryAbsolutePath);
				continue;
			}
			if (directoryResolution === 'integrate') {
				await integrateDirectoryTree(documentRoot, sourceEntryRelativePath, targetEntryRelativePath, {
					operation: options.operation || 'copy',
					directoryConflictResolution: options.directoryConflictResolution || 'integrate',
					fileConflictResolution: options.fileConflictResolution || 'skip'
				});
				continue;
			}
			throw createDirectoryConflictError(options.operation || 'copy', { name: path.posix.basename(sourceEntryRelativePath), isDirectory: true, size: 0, updatedAt: new Date().toISOString(), kind: 'folder' }, existingTarget);
		}

		const existingTarget = await getTargetDocument(documentRoot, targetEntryRelativePath);
		if (!existingTarget) {
			if (entry.isFile()) {
				await fs.copyFile(sourceEntryAbsolutePath, targetEntryAbsolutePath);
			}
			continue;
		}

		const resolution = options.fileConflictResolution || 'skip';
		if (resolution === 'skip') {
			continue;
		}
		if (resolution === 'overwrite') {
			await fs.rm(targetEntryAbsolutePath, { recursive: true, force: true });
			if (entry.isFile()) {
				await fs.copyFile(sourceEntryAbsolutePath, targetEntryAbsolutePath);
			}
			continue;
		}
		if (resolution === 'keep_both') {
			const nextTargetName = await getAvailableName(documentRoot, path.posix.dirname(targetEntryRelativePath), entry.name);
			const nextTargetRelativePath = getTargetRelativePath(path.posix.dirname(targetEntryRelativePath), nextTargetName);
			const nextTargetAbsolutePath = resolveAbsolutePath(documentRoot, nextTargetRelativePath);
			if (entry.isFile()) {
				await fs.copyFile(sourceEntryAbsolutePath, nextTargetAbsolutePath);
			}
			continue;
		}
		throw createFileConflictError(options.operation || 'copy', { name: entry.name, isDirectory: entry.isDirectory(), size: 0, updatedAt: new Date().toISOString(), kind: entry.isDirectory() ? 'folder' : 'file' }, existingTarget);
	}
}

async function renameOrMoveDocument(documentRoot, fileId, options = {}) {
	const document = await getDocumentById(documentRoot, fileId);
	const operation = options.operation || 'move';
	const targetDirectory = resolveTargetDirectory(options.targetDirectory, path.posix.dirname(document.relativePath));
	const targetName = options.targetName || document.name;
	const targetRelativePath = getTargetRelativePath(targetDirectory, targetName);
	const targetPath = resolveAbsolutePath(documentRoot, targetRelativePath);
	const sourcePath = document.absolutePath;
	const existingTarget = await getTargetDocument(documentRoot, targetRelativePath);

	if (targetRelativePath === document.relativePath) {
		return document;
	}

	if (document.isDirectory && isPathWithinPrefix(targetRelativePath, document.relativePath)) {
		throw createHttpError(400, 'A folder cannot be moved into itself.');
	}

	if (!document.isDirectory && !getMimeType(targetRelativePath)) {
		throw createHttpError(400, 'The target file type is not supported.');
	}

	if (existingTarget && existingTarget.id !== document.id) {
		const resolution = options.conflictResolution;
		if (!resolution) {
			if (document.isDirectory && existingTarget.isDirectory) {
				throw createDirectoryConflictError(operation, document, existingTarget);
			}
			throw createFileConflictError(operation, document, existingTarget);
		}
		if (resolution === 'skip') {
			return { skipped: true, operation, conflict: { error: 'FILE_CONFLICT', source: normalizeConflictEntry(document), target: normalizeConflictEntry(existingTarget), conflictType: document.isDirectory || existingTarget.isDirectory ? 'directory' : 'file' } };
		}
		if (resolution === 'keep_both') {
			const nextTargetName = await getAvailableName(documentRoot, targetDirectory, targetName);
			const nextTargetRelativePath = getTargetRelativePath(targetDirectory, nextTargetName);
			const nextTargetPath = resolveAbsolutePath(documentRoot, nextTargetRelativePath);
			await fs.mkdir(path.dirname(nextTargetPath), { recursive: true });
			await fs.rename(sourcePath, nextTargetPath);
			await remapRegistryPaths(documentRoot, document.relativePath, nextTargetRelativePath);
			return getDocumentById(documentRoot, fileId);
		}
		if (resolution === 'replace') {
			if (document.isDirectory && existingTarget.isDirectory) {
				await fs.rm(targetPath, { recursive: true, force: true });
				await fs.mkdir(path.dirname(targetPath), { recursive: true });
				await fs.rename(sourcePath, targetPath);
				await deleteRegistryEntries(documentRoot, document.relativePath);
				return getDocumentById(documentRoot, fileId);
			}
			await fs.rm(targetPath, { recursive: true, force: true });
		}
		if (resolution === 'integrate' && document.isDirectory && existingTarget.isDirectory) {
			await integrateDirectoryTree(documentRoot, document.relativePath, targetRelativePath, {
				operation: operation,
				directoryConflictResolution: 'integrate',
				fileConflictResolution: 'skip'
			});
			await deleteRegistryEntries(documentRoot, document.relativePath);
			await fs.rm(sourcePath, { recursive: true, force: true });
			return existingTarget;
		}
		if (resolution === 'overwrite') {
			await fs.rm(targetPath, { recursive: true, force: true });
		}
	}

	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	if (existingTarget && existingTarget.id !== document.id && options.conflictResolution !== 'overwrite' && options.conflictResolution !== 'replace' && options.conflictResolution !== 'integrate') {
		await ensureTargetDoesNotExist(targetPath);
	}

	await fs.rename(sourcePath, targetPath);
	await remapRegistryPaths(documentRoot, document.relativePath, targetRelativePath);
	return getDocumentById(documentRoot, fileId);
}

async function copyDocument(documentRoot, fileId, options = {}) {
	const document = await getDocumentById(documentRoot, fileId);
	const operation = options.operation || 'copy';
	const targetDirectory = resolveTargetDirectory(options.targetDirectory, path.posix.dirname(document.relativePath));
	const targetName = options.targetName || (document.isDirectory
		? `${document.name} copy`
		: `${path.posix.parse(document.name).name} copy${document.extension}`);
	const targetRelativePath = getTargetRelativePath(targetDirectory, targetName);
	if (!document.isDirectory && !getMimeType(targetRelativePath)) {
		throw createHttpError(400, 'The target file type is not supported.');
	}

	const targetPath = resolveAbsolutePath(documentRoot, targetRelativePath);
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	const existingTarget = await getTargetDocument(documentRoot, targetRelativePath);

	if (document.isDirectory && isPathWithinPrefix(targetRelativePath, document.relativePath)) {
		throw createHttpError(400, 'A folder cannot be copied into itself.');
	}

	if (existingTarget) {
		const resolution = options.conflictResolution;
		if (!resolution) {
			if (document.isDirectory && existingTarget.isDirectory) {
				throw createDirectoryConflictError(operation, document, existingTarget);
			}
			throw createFileConflictError(operation, document, existingTarget);
		}
		if (resolution === 'skip') {
			return { skipped: true, operation, conflict: { error: 'FILE_CONFLICT', source: normalizeConflictEntry(document), target: normalizeConflictEntry(existingTarget), conflictType: document.isDirectory || existingTarget.isDirectory ? 'directory' : 'file' } };
		}
		if (resolution === 'keep_both') {
			const nextTargetName = await getAvailableName(documentRoot, targetDirectory, targetName);
			const nextTargetRelativePath = getTargetRelativePath(targetDirectory, nextTargetName);
			const nextTargetPath = resolveAbsolutePath(documentRoot, nextTargetRelativePath);
			if (document.isDirectory) {
				await copyDirectoryRecursive(document.absolutePath, nextTargetPath);
			} else {
				await fs.copyFile(document.absolutePath, nextTargetPath);
			}
			const newFileId = await ensurePathId(documentRoot, nextTargetRelativePath);
			return getDocumentById(documentRoot, newFileId);
		}
		if (resolution === 'replace') {
			if (document.isDirectory && existingTarget.isDirectory) {
				await fs.rm(targetPath, { recursive: true, force: true });
				await copyDirectoryRecursive(document.absolutePath, targetPath);
				const newFileId = await ensurePathId(documentRoot, targetRelativePath);
				return getDocumentById(documentRoot, newFileId);
			}
			await fs.rm(targetPath, { recursive: true, force: true });
		}
		if (resolution === 'integrate' && document.isDirectory && existingTarget.isDirectory) {
			await integrateDirectoryTree(documentRoot, document.relativePath, targetRelativePath, {
				operation: operation,
				directoryConflictResolution: 'integrate',
				fileConflictResolution: 'skip'
			});
			return existingTarget;
		}
		if (resolution === 'overwrite') {
			await fs.rm(targetPath, { recursive: true, force: true });
		}
	}

	if (existingTarget && options.conflictResolution !== 'overwrite' && options.conflictResolution !== 'replace' && options.conflictResolution !== 'integrate') {
		await ensureTargetDoesNotExist(targetPath);
	}

	if (document.isDirectory) {
		await copyDirectoryRecursive(document.absolutePath, targetPath);
	} else {
		await fs.copyFile(document.absolutePath, targetPath);
	}

	const newFileId = await ensurePathId(documentRoot, targetRelativePath);
	return getDocumentById(documentRoot, newFileId);
}

async function deleteDocument(documentRoot, fileId) {
	const document = await getDocumentById(documentRoot, fileId);
	if (document.isDirectory) {
		await fs.rm(document.absolutePath, { recursive: true, force: false });
	} else {
		await fs.unlink(document.absolutePath);
	}
	await deleteRegistryEntries(documentRoot, document.relativePath);
	return document;
}

module.exports = {
	SUPPORTED_MIME_TYPES: SUPPORTED_MIME_TYPES,
	createLegacyFileId: createLegacyFileId,
	createDocument: createDocument,
	createDocumentByType: createDocumentByType,
	createFolder: createFolder,
	copyDocument: copyDocument,
	createFileConflictError: createFileConflictError,
	deleteDocument: deleteDocument,
	getAvailableName: getAvailableName,
	getDocumentById: getDocumentById,
	listDocuments: listDocuments,
	renameOrMoveDocument: renameOrMoveDocument,
	uploadDocuments: uploadDocuments
};
