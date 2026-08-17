'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { createHttpError } = require('./errors');

const STORAGE_CONTEXT_SHARED = 'shared';
const STORAGE_CONTEXT_PERSONAL = 'personal';

function getSharedStorageRoot(config) {
	return path.join(config.documentRoot, 'shared');
}

function getUsersStorageRoot(config) {
	return path.join(config.documentRoot, 'users');
}

function getUserStorageRoot(config, userId) {
	return path.join(getUsersStorageRoot(config), String(userId));
}

async function ensureStorageLayout(config) {
	await fs.mkdir(getSharedStorageRoot(config), { recursive: true });
	await fs.mkdir(getUsersStorageRoot(config), { recursive: true });
}

async function ensureUserStorageRoot(config, userId) {
	const userRoot = getUserStorageRoot(config, userId);
	await fs.mkdir(userRoot, { recursive: true });
	return userRoot;
}

function getResolvedStorageContext(req, config) {
	const isAuthenticated = Boolean(req.auth?.authenticated);
	if (!isAuthenticated) {
		return {
			context: STORAGE_CONTEXT_SHARED,
			documentRoot: getSharedStorageRoot(config),
			authenticated: false
		};
	}

	const selectedContext = req.session?.storageContext === STORAGE_CONTEXT_SHARED
		? STORAGE_CONTEXT_SHARED
		: STORAGE_CONTEXT_PERSONAL;
	if (selectedContext === STORAGE_CONTEXT_SHARED) {
		return {
			context: STORAGE_CONTEXT_SHARED,
			documentRoot: getSharedStorageRoot(config),
			authenticated: true
		};
	}

	return {
		context: STORAGE_CONTEXT_PERSONAL,
		documentRoot: getUserStorageRoot(config, req.auth.user.id),
		authenticated: true
	};
}

function assertStorageContextForUser(context, isAuthenticated) {
	const normalized = String(context || '').trim().toLowerCase();
	if (normalized !== STORAGE_CONTEXT_SHARED && normalized !== STORAGE_CONTEXT_PERSONAL) {
		throw createHttpError(400, 'Unsupported storage context.');
	}
	if (!isAuthenticated && normalized !== STORAGE_CONTEXT_SHARED) {
		throw createHttpError(403, 'Anonymous sessions can only use shared storage.');
	}
	return normalized;
}

function getStorageRootFromTokenClaims(config, tokenPayload) {
	if (tokenPayload.shareId) {
		return getSharedStorageRoot(config);
	}
	if (tokenPayload.storageContext === STORAGE_CONTEXT_PERSONAL && tokenPayload.userId) {
		return getUserStorageRoot(config, tokenPayload.userId);
	}
	return getSharedStorageRoot(config);
}

module.exports = {
	STORAGE_CONTEXT_PERSONAL: STORAGE_CONTEXT_PERSONAL,
	STORAGE_CONTEXT_SHARED: STORAGE_CONTEXT_SHARED,
	assertStorageContextForUser: assertStorageContextForUser,
	ensureStorageLayout: ensureStorageLayout,
	ensureUserStorageRoot: ensureUserStorageRoot,
	getResolvedStorageContext: getResolvedStorageContext,
	getSharedStorageRoot: getSharedStorageRoot,
	getStorageRootFromTokenClaims: getStorageRootFromTokenClaims,
	getUserStorageRoot: getUserStorageRoot
};
