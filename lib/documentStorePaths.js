'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { createHttpError } = require('./errors');
const { STATE_DIRECTORY_NAME, getContextStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

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

function getRegistryPath(documentRoot) {
  return path.join(getContextStateRoot(documentRoot), 'file-registry.json');
}

async function ensureDocumentRoot(documentRoot) {
  await fs.mkdir(documentRoot, { recursive: true });
  await ensureDirectory(getContextStateRoot(documentRoot));
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

async function registerPathForId(documentRoot, fileId, relativePath) {
  const registry = await loadRegistry(documentRoot);
  registry.entries[String(fileId)] = normalizeRelativePath(relativePath);
  await saveRegistry(documentRoot, registry);
  return String(fileId);
}

async function resolveRelativePathFromId(documentRoot, fileId) {
  const registry = await loadRegistry(documentRoot);
  if (registry.entries[fileId]) {
    return registry.entries[fileId];
  }

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

module.exports = {
  SUPPORTED_MIME_TYPES,
  STATE_DIRECTORY_NAME,
  createLegacyFileId,
  decodeLegacyFileId,
  ensureDocumentRoot,
  ensurePathId,
  getMimeType,
  getRegistryPath,
  getTargetRelativePath,
  isPathWithinPrefix,
  loadRegistry,
  normalizeRelativePath,
  registerPathForId,
  resolveAbsolutePath,
  resolveRelativePathFromId,
  resolveTargetDirectory,
  saveRegistry
};
