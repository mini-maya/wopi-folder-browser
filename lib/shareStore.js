'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const { createHttpError } = require('./errors');
const { hashPassword, verifyPassword } = require('./passwords');
const { getCommonStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

const PUBLIC_SHARE_TYPE = 'public_link';
const PUBLIC_SHARE_RESOURCE_TYPE = 'file';
const PUBLIC_SHARE_STATUS_ACTIVE = 'active';
const PUBLIC_SHARE_STATUS_EXPIRED = 'expired';
const PUBLIC_SHARE_STATUS_EXHAUSTED = 'exhausted';
const PUBLIC_SHARE_STATUS_REVOKED = 'revoked';
const PUBLIC_SHARE_PERMISSIONS = new Set(['read', 'read_write']);
const PUBLIC_SHARE_STATUSES = new Set([
	PUBLIC_SHARE_STATUS_ACTIVE,
	PUBLIC_SHARE_STATUS_EXPIRED,
	PUBLIC_SHARE_STATUS_EXHAUSTED,
	PUBLIC_SHARE_STATUS_REVOKED
]);

let mutationQueue = Promise.resolve();

function getSharePath(documentRoot) {
	return path.join(getCommonStateRoot(documentRoot), 'shares.json');
}

function withMutation(work) {
	mutationQueue = mutationQueue
		.catch(() => {})
		.then(() => work());
	return mutationQueue;
}

function nowIso() {
	return new Date().toISOString();
}

function normalizePermission(permission) {
	const normalized = String(permission || '').trim().toLowerCase();
	if (normalized === 'read' || normalized === 'view') {
		return 'read';
	}
	if (normalized === 'read_write' || normalized === 'edit') {
		return 'read_write';
	}
	return null;
}

function normalizeStatus(status) {
	const normalized = String(status || '').trim().toLowerCase();
	return PUBLIC_SHARE_STATUSES.has(normalized) ? normalized : PUBLIC_SHARE_STATUS_ACTIVE;
}

function normalizeOptionalIsoDate(value) {
	if (!value) {
		return null;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return null;
	}
	return date.toISOString();
}

function normalizeMaxAccessCount(value) {
	if (value === null || value === undefined || value === '') {
		return null;
	}
	const parsed = Number.parseInt(String(value), 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		return null;
	}
	return parsed;
}

function normalizeAccessCount(value) {
	const parsed = Number.parseInt(String(value ?? 0), 10);
	if (!Number.isInteger(parsed) || parsed < 0) {
		return 0;
	}
	return parsed;
}

function normalizeShareEntry(entry) {
	if (!entry || typeof entry !== 'object') {
		return null;
	}
	const id = String(entry.id || '').trim();
	if (!id) {
		return null;
	}
	const permission = normalizePermission(entry.permission);
	if (!permission) {
		return null;
	}
	const resourceId = String(entry.resourceId || entry.fileId || '').trim();
	if (!resourceId) {
		return null;
	}
	const accessCount = normalizeAccessCount(entry.accessCount);
	const maxAccessCount = normalizeMaxAccessCount(entry.maxAccessCount);
	return {
		id: id,
		type: PUBLIC_SHARE_TYPE,
		resourceType: PUBLIC_SHARE_RESOURCE_TYPE,
		resourceId: resourceId,
		storageId: String(entry.storageId || 'documents'),
		token: String(entry.token || id),
		permission: permission,
		passwordEnabled: Boolean(entry.passwordEnabled) || Boolean(entry.passwordHash),
		passwordHash: entry.passwordHash ? String(entry.passwordHash) : null,
		downloadEnabled: entry.downloadEnabled !== false,
		expiresAt: normalizeOptionalIsoDate(entry.expiresAt),
		maxAccessCount: maxAccessCount,
		accessCount: accessCount,
		note: entry.note ? String(entry.note) : null,
		status: normalizeStatus(entry.status),
		createdBy: entry.createdBy ? String(entry.createdBy) : null,
		ownerUserId: entry.ownerUserId ? String(entry.ownerUserId) : null,
		createdAt: normalizeOptionalIsoDate(entry.createdAt) || nowIso(),
		updatedAt: normalizeOptionalIsoDate(entry.updatedAt) || normalizeOptionalIsoDate(entry.createdAt) || nowIso()
	};
}

function ensureActiveStatusFromRuntime(share) {
	if (share.status === PUBLIC_SHARE_STATUS_REVOKED) {
		return share.status;
	}
	if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
		return PUBLIC_SHARE_STATUS_EXPIRED;
	}
	if (share.maxAccessCount !== null && share.accessCount > share.maxAccessCount) {
		return PUBLIC_SHARE_STATUS_EXHAUSTED;
	}
	return PUBLIC_SHARE_STATUS_ACTIVE;
}

async function loadShares(documentRoot) {
	await ensureDirectory(getCommonStateRoot(documentRoot));
	const shares = await readJson(getSharePath(documentRoot), []);
	if (!Array.isArray(shares)) {
		return [];
	}
	return shares.map(normalizeShareEntry).filter(Boolean);
}

async function saveShares(documentRoot, shares) {
	await writeJsonAtomic(getSharePath(documentRoot), shares.map((share) => ({
		id: share.id,
		type: share.type,
		resourceType: share.resourceType,
		resourceId: share.resourceId,
		storageId: share.storageId,
		token: share.token,
		permission: share.permission,
		passwordEnabled: share.passwordEnabled === true,
		passwordHash: share.passwordHash || null,
		downloadEnabled: share.downloadEnabled !== false,
		expiresAt: share.expiresAt || null,
		maxAccessCount: share.maxAccessCount ?? null,
		accessCount: share.accessCount ?? 0,
		note: share.note || null,
		status: share.status,
		createdBy: share.createdBy || null,
		ownerUserId: share.ownerUserId || null,
		createdAt: share.createdAt,
		updatedAt: share.updatedAt
	})));
}

function getPublicShareResponse(share, baseUrl) {
	return {
		id: share.id,
		token: share.token,
		url: `${baseUrl}/share/${encodeURIComponent(share.token)}`,
		resourceId: share.resourceId,
		resourceType: share.resourceType,
		type: share.type,
		storageId: share.storageId,
		permission: share.permission,
		passwordEnabled: share.passwordEnabled,
		downloadEnabled: share.downloadEnabled,
		expiresAt: share.expiresAt,
		maxAccessCount: share.maxAccessCount,
		accessCount: share.accessCount,
		note: share.note,
		status: share.status,
		createdBy: share.createdBy,
		createdAt: share.createdAt,
		updatedAt: share.updatedAt
	};
}

async function createPublicShare(documentRoot, options) {
	const permission = normalizePermission(options.permission || 'read');
	if (!permission || !PUBLIC_SHARE_PERMISSIONS.has(permission)) {
		throw createHttpError(400, 'Invalid public share permission.');
	}
	const resourceId = String(options.resourceId || options.fileId || '').trim();
	if (!resourceId) {
		throw createHttpError(400, 'A file resource id is required.');
	}
	const password = options.password === undefined || options.password === null ? '' : String(options.password);
	const passwordEnabled = password.length > 0;
	const passwordHash = passwordEnabled ? await hashPassword(password) : null;
	const maxAccessCount = normalizeMaxAccessCount(options.maxAccessCount);
	const now = nowIso();
	const share = {
		id: `share-${crypto.randomUUID()}`,
		type: PUBLIC_SHARE_TYPE,
		resourceType: PUBLIC_SHARE_RESOURCE_TYPE,
		resourceId: resourceId,
		storageId: String(options.storageId || 'documents'),
		token: crypto.randomBytes(18).toString('base64url'),
		permission: permission,
		passwordEnabled: passwordEnabled,
		passwordHash: passwordHash,
		downloadEnabled: options.downloadEnabled !== false,
		expiresAt: normalizeOptionalIsoDate(options.expiresAt),
		maxAccessCount: maxAccessCount,
		accessCount: 0,
		note: options.note ? String(options.note) : null,
		status: PUBLIC_SHARE_STATUS_ACTIVE,
		createdBy: options.createdBy ? String(options.createdBy) : null,
		ownerUserId: options.ownerUserId ? String(options.ownerUserId) : null,
		createdAt: now,
		updatedAt: now
	};
	await withMutation(async () => {
		const shares = await loadShares(documentRoot);
		shares.push(share);
		await saveShares(documentRoot, shares);
	});
	return share;
}

async function getPublicShareById(documentRoot, shareId) {
	const shares = await loadShares(documentRoot);
	const share = shares.find((entry) => entry.id === String(shareId));
	if (!share) {
		throw createHttpError(404, 'Share link not found.');
	}
	return share;
}

async function getPublicShareByToken(documentRoot, token) {
	const shares = await loadShares(documentRoot);
	const share = shares.find((entry) => entry.token === String(token));
	if (!share) {
		throw createHttpError(404, 'Share link not found.');
	}
	return share;
}

async function listPublicSharesByFile(documentRoot, resourceId) {
	const normalizedResourceId = String(resourceId || '').trim();
	if (!normalizedResourceId) {
		return [];
	}
	const shares = await loadShares(documentRoot);
	return shares.filter((entry) => entry.resourceId === normalizedResourceId);
}

async function updatePublicShare(documentRoot, shareId, updates = {}) {
	return withMutation(async () => {
		const shares = await loadShares(documentRoot);
		const share = shares.find((entry) => entry.id === String(shareId));
		if (!share) {
			throw createHttpError(404, 'Share link not found.');
		}

		if (updates.permission !== undefined) {
			const permission = normalizePermission(updates.permission);
			if (!permission || !PUBLIC_SHARE_PERMISSIONS.has(permission)) {
				throw createHttpError(400, 'Invalid public share permission.');
			}
			share.permission = permission;
		}

		if (updates.password !== undefined) {
			const password = updates.password === null ? '' : String(updates.password);
			share.passwordEnabled = password.length > 0;
			share.passwordHash = share.passwordEnabled ? await hashPassword(password) : null;
		}

		if (updates.downloadEnabled !== undefined) {
			share.downloadEnabled = updates.downloadEnabled !== false;
		}

		if (updates.expiresAt !== undefined) {
			share.expiresAt = normalizeOptionalIsoDate(updates.expiresAt);
		}

		if (updates.maxAccessCount !== undefined) {
			share.maxAccessCount = normalizeMaxAccessCount(updates.maxAccessCount);
		}

		if (updates.note !== undefined) {
			share.note = updates.note ? String(updates.note) : null;
		}

		if (updates.status !== undefined) {
			const normalizedStatus = normalizeStatus(updates.status);
			if (!PUBLIC_SHARE_STATUSES.has(normalizedStatus)) {
				throw createHttpError(400, 'Invalid public share status.');
			}
			share.status = normalizedStatus;
		}

		share.status = ensureActiveStatusFromRuntime(share);
		share.updatedAt = nowIso();
		await saveShares(documentRoot, shares);
		return share;
	});
}

async function deletePublicShare(documentRoot, shareId) {
	return withMutation(async () => {
		const shares = await loadShares(documentRoot);
		const nextShares = shares.filter((entry) => entry.id !== String(shareId));
		if (nextShares.length === shares.length) {
			return false;
		}
		await saveShares(documentRoot, nextShares);
		return true;
	});
}

async function deletePublicSharesByResource(documentRoot, resourceId, options = {}) {
	const normalizedResourceId = String(resourceId || '').trim();
	if (!normalizedResourceId) {
		return 0;
	}
	const normalizedStorageId = options.storageId ? String(options.storageId).trim() : null;
	const hasOwnerUserIdFilter = Object.prototype.hasOwnProperty.call(options, 'ownerUserId');
	const normalizedOwnerUserId = hasOwnerUserIdFilter && options.ownerUserId != null
		? String(options.ownerUserId).trim()
		: null;
	return withMutation(async () => {
		const shares = await loadShares(documentRoot);
		const nextShares = shares.filter((entry) => {
			if (entry.resourceId !== normalizedResourceId) {
				return true;
			}
			if (normalizedStorageId && entry.storageId !== normalizedStorageId) {
				return true;
			}
			if (!hasOwnerUserIdFilter) {
				return false;
			}
			return (entry.ownerUserId || null) !== normalizedOwnerUserId;
		});
		const removedCount = shares.length - nextShares.length;
		if (removedCount > 0) {
			await saveShares(documentRoot, nextShares);
		}
		return removedCount;
	});
}

async function validatePublicShareAccess(documentRoot, token, options = {}) {
	const candidate = await getPublicShareByToken(documentRoot, token);
	if (candidate.status === PUBLIC_SHARE_STATUS_REVOKED) {
		throw createHttpError(404, 'This share link is no longer available.');
	}

	if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() < Date.now()) {
		await updatePublicShare(documentRoot, candidate.id, { status: PUBLIC_SHARE_STATUS_EXPIRED });
		throw createHttpError(403, 'This share link has expired.');
	}

	if (candidate.passwordEnabled) {
		const validPassword = await verifyPassword(options.password || '', candidate.passwordHash || '');
		if (!validPassword) {
			const error = createHttpError(401, options.password ? 'The password is incorrect.' : 'Password required.');
			error.code = options.password ? 'INVALID_SHARE_PASSWORD' : 'SHARE_PASSWORD_REQUIRED';
			throw error;
		}
	}

	return candidate;
}

async function consumePublicShareAccess(documentRoot, shareId) {
	return withMutation(async () => {
		const shares = await loadShares(documentRoot);
		const share = shares.find((entry) => entry.id === String(shareId));
		if (!share) {
			throw createHttpError(404, 'Share link not found.');
		}
		if (share.status === PUBLIC_SHARE_STATUS_REVOKED) {
			throw createHttpError(404, 'This share link is no longer available.');
		}
		if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
			share.status = PUBLIC_SHARE_STATUS_EXPIRED;
			share.updatedAt = nowIso();
			await saveShares(documentRoot, shares);
			throw createHttpError(403, 'This share link has expired.');
		}
		if (share.maxAccessCount !== null && share.accessCount >= share.maxAccessCount) {
			share.status = PUBLIC_SHARE_STATUS_EXHAUSTED;
			share.updatedAt = nowIso();
			await saveShares(documentRoot, shares);
			throw createHttpError(403, 'This share link has reached its access limit.');
		}
		share.accessCount += 1;
		share.status = ensureActiveStatusFromRuntime(share);
		share.updatedAt = nowIso();
		await saveShares(documentRoot, shares);
		return share;
	});
}

async function getShare(documentRoot, shareId) {
	return getPublicShareById(documentRoot, shareId);
}

async function createShare(documentRoot, options) {
	return createPublicShare(documentRoot, {
		resourceId: options.fileId,
		storageId: options.storageId,
		permission: options.permission === 'edit' ? 'read_write' : 'read',
		createdBy: options.createdBy,
		ownerUserId: options.ownerUserId
	});
}

module.exports = {
	PUBLIC_SHARE_STATUS_ACTIVE,
	PUBLIC_SHARE_STATUS_EXPIRED,
	PUBLIC_SHARE_STATUS_EXHAUSTED,
	PUBLIC_SHARE_STATUS_REVOKED,
	createPublicShare,
	consumePublicShareAccess,
	createShare: createShare,
	deletePublicShare,
	deletePublicSharesByResource,
	getPublicShareById,
	getPublicShareByToken,
	getPublicShareResponse,
	getShare: getShare,
	listPublicSharesByFile,
	updatePublicShare,
	validatePublicShareAccess
};
