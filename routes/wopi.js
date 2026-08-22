'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../lib/config');
const { verifyAccessToken } = require('../lib/accessToken');
const { recordEditActivity } = require('../lib/activityStore');
const { renameOrMoveDocument } = require('../lib/documentStore');
const { createHttpError } = require('../lib/errors');
const { clearLock, ensureLockMatches, getLock, setLock } = require('../lib/lockStore');
const { resolveDocumentById } = require('../lib/documentResolver');
const { invalidatePreview } = require('../lib/previewStore');
const {
  PUBLIC_SHARE_STATUS_EXHAUSTED,
  PUBLIC_SHARE_STATUS_EXPIRED,
  PUBLIC_SHARE_STATUS_REVOKED,
  getPublicShareById
} = require('../lib/shareStore');
const { createVersionSnapshot, getVersionEntry } = require('../lib/versionStore');

const router = express.Router();

async function loadAuthorizedDocument(req) {
	const fileId = req.params.fileId;
	const payload = verifyAccessToken(req.query.access_token, {
		fileId: fileId,
		secret: config.accessTokenSecret,
		validate: function(tokenPayload) {
			if (tokenPayload.shareId) {
				// Share permission is re-evaluated for each WOPI request.
				return;
			}
		}
	});

	const mountRegistry = req.app.locals.mountRegistry;
	const mountId = payload.mountId || 'documents';
	let mount = mountRegistry.get(mountId);
	if (!mount) {
		throw createHttpError(403, 'Mount not found or not accessible.');
	}
	let documentRoot = mount.root;

	if (payload.shareId) {
		const share = await getPublicShareById(config.stateRoot, payload.shareId);
		if (share.resourceId !== fileId) {
			throw createHttpError(403, 'The share does not grant access to this file.');
		}
		if (share.status === PUBLIC_SHARE_STATUS_REVOKED) {
			throw createHttpError(404, 'This share link is no longer available.');
		}
		if (share.status === PUBLIC_SHARE_STATUS_EXPIRED || (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now())) {
			throw createHttpError(403, 'This share link has expired.');
		}
		if (share.status === PUBLIC_SHARE_STATUS_EXHAUSTED) {
			throw createHttpError(403, 'This share link has reached its access limit.');
		}
		if (payload.mountId && share.mountId !== payload.mountId) {
			throw createHttpError(403, 'Mount access denied.');
		}
		if (share.permission !== 'read_write' && payload.canWrite) {
			throw createHttpError(403, 'This share does not allow editing.');
		}
		const shareMount = mountRegistry.get(share.mountId || 'documents');
		if (!shareMount) {
			throw createHttpError(403, 'Share mount not found.');
		}
		mount = shareMount;
		documentRoot = shareMount.root;
	}
	return {
		document: await resolveDocumentById(documentRoot, fileId, { mountId: mount.id }),
		tokenPayload: payload,
		documentRoot: documentRoot,
		mount: mount
	};
}

function getWopiOverride(req) {
	return String(req.get('X-WOPI-Override') || '').toUpperCase();
}

function getLockFromHeader(req) {
	return req.get('X-WOPI-Lock') || '';
}

router.get('/files/:fileId', async function(req, res, next) {
	try {
		const authorized = await loadAuthorizedDocument(req);
		const disableExport = Boolean(authorized.tokenPayload.shareId) && authorized.tokenPayload.shareDownloadEnabled === false;

		if (authorized.tokenPayload.versionId) {
			const { entry } = await getVersionEntry(authorized.documentRoot, req.params.fileId, authorized.tokenPayload.versionId);
			res.json({
				BaseFileName: authorized.document.name,
				OwnerId: 'shared-folder',
				Size: entry.size,
				UserId: authorized.tokenPayload.userId || 'shared-user',
				UserFriendlyName: authorized.tokenPayload.userName || 'Shared Folder User',
				UserCanWrite: false,
				UserCanRename: false,
				SupportsGetLock: false,
				SupportsLocks: false,
				SupportsUpdate: false,
				SupportsRename: false,
				DisableExport: disableExport,
				Version: entry.id,
				LastModifiedTime: entry.createdAt
			});
			return;
		}

		res.json({
			BaseFileName: authorized.document.name,
			OwnerId: 'shared-folder',
			Size: authorized.document.size,
			UserId: authorized.tokenPayload.userId || 'shared-user',
			UserFriendlyName: authorized.tokenPayload.userName || 'Shared Folder User',
			UserCanWrite: Boolean(authorized.tokenPayload.canWrite) && authorized.mount.readOnly !== true,
			UserCanRename: Boolean(authorized.tokenPayload.canRename) && authorized.mount.readOnly !== true,
			SupportsGetLock: true,
			SupportsLocks: true,
			SupportsUpdate: true,
			SupportsRename: true,
			DisableExport: disableExport,
			Version: authorized.document.version,
			LastModifiedTime: authorized.document.updatedAt
		});
	} catch (err) {
		next(err);
	}
});

router.get('/files/:fileId/contents', async function(req, res, next) {
	try {
		const authorized = await loadAuthorizedDocument(req);

		if (authorized.tokenPayload.versionId) {
			const { entry, storagePath } = await getVersionEntry(authorized.documentRoot, req.params.fileId, authorized.tokenPayload.versionId);
			res.type(authorized.document.mimeType);
			res.set('X-WOPI-ItemVersion', entry.id);
			res.sendFile(storagePath);
			return;
		}

		res.type(authorized.document.mimeType);
		res.set('X-WOPI-ItemVersion', authorized.document.version);
		res.sendFile(authorized.document.absolutePath);
	} catch (err) {
		next(err);
	}
});

router.post('/files/:fileId', async function(req, res, next) {
	try {
		const override = getWopiOverride(req);
		if (!override) {
			res.sendStatus(200);
			return;
		}

		const authorized = await loadAuthorizedDocument(req);
		const requestedLock = getLockFromHeader(req);
		const lockMountId = authorized.mount.id;
		if (override === 'LOCK') {
			const existingLock = getLock(req.params.fileId, lockMountId);
			if (existingLock?.lock && existingLock.lock !== requestedLock) {
				res.status(409).set('X-WOPI-Lock', existingLock.lock).end();
				return;
			}
			setLock(req.params.fileId, requestedLock, lockMountId);
			res.sendStatus(200);
			return;
		}

		if (override === 'REFRESH_LOCK') {
			if (!ensureLockMatches(req.params.fileId, requestedLock, lockMountId)) {
				const existingLock = getLock(req.params.fileId, lockMountId);
				res.status(409).set('X-WOPI-Lock', existingLock?.lock ?? '').end();
				return;
			}
			setLock(req.params.fileId, requestedLock, lockMountId);
			res.sendStatus(200);
			return;
		}

		if (override === 'GET_LOCK') {
			const existingLock = getLock(req.params.fileId, lockMountId);
			res.status(200).set('X-WOPI-Lock', existingLock?.lock ?? '').end();
			return;
		}

		if (override === 'UNLOCK') {
			if (!ensureLockMatches(req.params.fileId, requestedLock, lockMountId)) {
				const existingLock = getLock(req.params.fileId, lockMountId);
				res.status(409).set('X-WOPI-Lock', existingLock?.lock ?? '').end();
				return;
			}
			clearLock(req.params.fileId, lockMountId);
			res.sendStatus(200);
			return;
		}

		if (override === 'RENAME_FILE') {
			if (!authorized.tokenPayload.canRename || authorized.mount.readOnly === true) {
				throw createHttpError(403, 'You no longer have permission to edit this document.');
			}
			const requestedName = req.get('X-WOPI-RequestedName');
			if (!requestedName) {
				throw createHttpError(400, 'Missing X-WOPI-RequestedName header.');
			}

			const currentExtension = authorized.document.extension;
			const normalizedRequestedName = `${requestedName}${currentExtension}`;
			const updatedDocument = await renameOrMoveDocument(authorized.documentRoot, req.params.fileId, {
				targetName: normalizedRequestedName,
				actor: {
					id: authorized.tokenPayload.userId || 'shared-user',
					name: authorized.tokenPayload.userName || 'Shared Folder User'
				},
				context: authorized.tokenPayload.mountId || authorized.mount.id || null
			});
			res.json({
				Name: updatedDocument.name,
				Url: `${config.getAppBaseUrl(req)}/api/files/${encodeURIComponent(updatedDocument.id)}`
			});
			return;
		}

		res.sendStatus(200);
	} catch (err) {
		next(err);
	}
});

router.post('/files/:fileId/contents', async function(req, res, next) {
	try {
		const authorized = await loadAuthorizedDocument(req);
		if (!authorized.tokenPayload.canWrite || authorized.mount.readOnly === true) {
			throw createHttpError(403, 'You no longer have permission to edit this document.');
		}

		if (!Buffer.isBuffer(req.body)) {
			throw createHttpError(400, 'Expected a binary request body.');
		}

		if (!ensureLockMatches(req.params.fileId, getLockFromHeader(req), authorized.mount.id)) {
			const existingLock = getLock(req.params.fileId, authorized.mount.id);
			res.status(409).set('X-WOPI-Lock', existingLock?.lock ?? '').end();
			return;
		}

		const filePath = path.join(authorized.documentRoot, authorized.document.relativePath);
		await fs.writeFile(filePath, req.body);
		const updatedDocument = await resolveDocumentById(authorized.documentRoot, req.params.fileId, { mountId: authorized.mount.id });
		await createVersionSnapshot(authorized.documentRoot, updatedDocument, {
			id: authorized.tokenPayload.userId || 'shared-user',
			name: authorized.tokenPayload.userName || 'Shared Folder User'
		});
		await invalidatePreview(authorized.documentRoot, updatedDocument);
		await recordEditActivity(authorized.documentRoot, {
			fileId: updatedDocument.id,
			fileName: updatedDocument.name,
			userId: authorized.tokenPayload.userId || 'shared-user',
			userName: authorized.tokenPayload.userName || 'Shared Folder User'
		});
		res.set('X-WOPI-ItemVersion', updatedDocument.version);
		res.sendStatus(200);
	} catch (err) {
		next(err);
	}
});

module.exports = router;
