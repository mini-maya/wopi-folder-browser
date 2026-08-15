'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const { createHttpError } = require('./errors');
const { getStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

function getSharePath(documentRoot) {
	return path.join(getStateRoot(documentRoot), 'shares.json');
}

async function loadShares(documentRoot) {
	await ensureDirectory(getStateRoot(documentRoot));
	const shares = await readJson(getSharePath(documentRoot), []);
	return Array.isArray(shares) ? shares : [];
}

async function saveShares(documentRoot, shares) {
	await writeJsonAtomic(getSharePath(documentRoot), shares);
}

async function createShare(documentRoot, options) {
	const shares = await loadShares(documentRoot);
	const shareId = crypto.randomBytes(10).toString('base64url');
	const share = {
		id: shareId,
		fileId: options.fileId,
		permission: options.permission === 'edit' ? 'edit' : 'view',
		createdAt: new Date().toISOString()
	};
	shares.push(share);
	await saveShares(documentRoot, shares);
	return share;
}

async function getShare(documentRoot, shareId) {
	const shares = await loadShares(documentRoot);
	const share = shares.find((entry) => entry.id === shareId);
	if (!share) {
		throw createHttpError(404, 'Share link not found.');
	}

	return share;
}

module.exports = {
	createShare: createShare,
	getShare: getShare
};
