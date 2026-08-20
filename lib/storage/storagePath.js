'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { StoragePathError } = require('./errors');

function normalizeRelativePath(relativePath) {
	const raw = String(relativePath || '').trim().replace(/\\/g, '/');
	if (!raw || raw === '.') {
		return '';
	}
	if (raw.startsWith('/')) {
		throw new StoragePathError('Absolute paths are not allowed.');
	}
	const segments = raw.split('/').filter(Boolean);
	if (segments.some((segment) => segment === '.' || segment === '..')) {
		throw new StoragePathError('The path contains invalid traversal segments.');
	}
	return segments.join('/');
}

async function resolveExistingParent(root, normalizedRelativePath) {
	if (!normalizedRelativePath) {
		return fs.realpath(root);
	}

	const segments = normalizedRelativePath.split('/');
	const parentSegments = segments.slice(0, -1);
	const parentCandidate = path.resolve(root, parentSegments.join('/'));
	return fs.realpath(parentCandidate);
}

async function resolveSafePath(root, relativePath) {
	const resolvedRoot = await fs.realpath(path.resolve(root));
	const normalizedRelativePath = normalizeRelativePath(relativePath);
	const targetAbsolute = normalizedRelativePath
		? path.resolve(resolvedRoot, normalizedRelativePath)
		: resolvedRoot;

	if (targetAbsolute !== resolvedRoot && !targetAbsolute.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new StoragePathError('Path escapes storage root.');
	}

	const parentRealPath = await resolveExistingParent(resolvedRoot, normalizedRelativePath);
	if (parentRealPath !== resolvedRoot && !parentRealPath.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new StoragePathError('Path escapes storage root.');
	}

	const targetName = normalizedRelativePath ? normalizedRelativePath.split('/').at(-1) : '';
	const safeAbsolutePath = targetName ? path.join(parentRealPath, targetName) : resolvedRoot;
	if (safeAbsolutePath !== resolvedRoot && !safeAbsolutePath.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new StoragePathError('Path escapes storage root.');
	}

	return {
		root: resolvedRoot,
		relativePath: normalizedRelativePath,
		absolutePath: safeAbsolutePath
	};
}

module.exports = {
	normalizeRelativePath,
	resolveSafePath
};
