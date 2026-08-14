'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

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
	presentation: { extension: '.odp', fileNameKey: 'Untitled presentation' }
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

async function ensureFileIdForPath(documentRoot, relativePath) {
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

	const stableId = await ensureFileIdForPath(documentRoot, legacyPath);
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
		const fileId = await ensureFileIdForPath(documentRoot, relativePath);
		documents.push(toMetadata(documentRoot, fileId, relativePath, stats));
	}

	return documents;
}

async function listDocuments(documentRoot) {
	await ensureDocumentRoot(documentRoot);
	return walkDirectory(documentRoot);
}

async function updateRegistryPath(documentRoot, fileId, newRelativePath) {
	const registry = await loadRegistry(documentRoot);
	if (!registry.entries[fileId]) {
		registry.entries[fileId] = normalizeRelativePath(newRelativePath);
	} else {
		registry.entries[fileId] = normalizeRelativePath(newRelativePath);
	}
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
	const fileId = await ensureFileIdForPath(documentRoot, relativePath);
	const stats = await fs.stat(absolutePath);
	return toMetadata(documentRoot, fileId, relativePath, stats);
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

async function getDocumentById(documentRoot, fileId) {
	await ensureDocumentRoot(documentRoot);
	const relativePath = await resolveRelativePathFromId(documentRoot, fileId);
	const mimeType = getMimeType(relativePath);
	if (!mimeType) {
		throw createHttpError(404, 'The requested file type is not supported.');
	}

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

	if (!stats.isFile()) {
		throw createHttpError(404, 'The requested document is not a file.');
	}

	return toMetadata(documentRoot, fileId, relativePath, stats);
}

async function renameOrMoveDocument(documentRoot, fileId, options) {
	const document = await getDocumentById(documentRoot, fileId);
	const targetDirectory = options.targetDirectory ? normalizeRelativePath(options.targetDirectory) : path.posix.dirname(document.relativePath);
	const targetName = options.targetName || document.name;
	const targetRelativePath = targetDirectory === '.'
		? targetName
		: path.posix.join(targetDirectory, targetName);
	const targetMimeType = getMimeType(targetRelativePath);
	if (!targetMimeType) {
		throw createHttpError(400, 'The target file type is not supported.');
	}

	const sourcePath = document.absolutePath;
	const targetPath = resolveAbsolutePath(documentRoot, targetRelativePath);
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	try {
		await fs.access(targetPath);
		throw createHttpError(409, 'The target file already exists.');
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}

	await fs.rename(sourcePath, targetPath);
	await updateRegistryPath(documentRoot, fileId, targetRelativePath);
	return getDocumentById(documentRoot, fileId);
}

async function copyDocument(documentRoot, fileId, options) {
	const document = await getDocumentById(documentRoot, fileId);
	const targetDirectory = options.targetDirectory ? normalizeRelativePath(options.targetDirectory) : path.posix.dirname(document.relativePath);
	const targetName = options.targetName || `${path.posix.parse(document.name).name} copy${document.extension}`;
	const targetRelativePath = targetDirectory === '.'
		? targetName
		: path.posix.join(targetDirectory, targetName);
	if (!getMimeType(targetRelativePath)) {
		throw createHttpError(400, 'The target file type is not supported.');
	}

	const targetPath = resolveAbsolutePath(documentRoot, targetRelativePath);
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	try {
		await fs.access(targetPath);
		throw createHttpError(409, 'The target file already exists.');
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}

	await fs.copyFile(document.absolutePath, targetPath);
	const newFileId = await ensureFileIdForPath(documentRoot, targetRelativePath);
	return getDocumentById(documentRoot, newFileId);
}

async function deleteDocument(documentRoot, fileId) {
	const document = await getDocumentById(documentRoot, fileId);
	await fs.unlink(document.absolutePath);
	return document;
}

module.exports = {
	SUPPORTED_MIME_TYPES: SUPPORTED_MIME_TYPES,
	createLegacyFileId: createLegacyFileId,
	createDocument: createDocument,
	createDocumentByType: createDocumentByType,
	copyDocument: copyDocument,
	deleteDocument: deleteDocument,
	getDocumentById: getDocumentById,
	listDocuments: listDocuments,
	renameOrMoveDocument: renameOrMoveDocument
};
