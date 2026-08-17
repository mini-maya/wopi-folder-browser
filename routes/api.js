'use strict';

const express = require('express');
const fs = require('fs/promises');
const multer = require('multer');

const config = require('../lib/config');
const { createAccessToken } = require('../lib/accessToken');
const { appendActivity, listActivity } = require('../lib/activityStore');
const { getActionUrl, getSupportedFormats } = require('../lib/discovery');
const {
	copyDocument,
	createDocumentByType,
	createFolder,
	deleteDocument,
	getDocumentById,
	listDocuments,
	renameOrMoveDocument,
	SUPPORTED_MIME_TYPES,
	uploadDocuments
} = require('../lib/documentStore');
const { createHttpError } = require('../lib/errors');
const { createDocumentsZip, createFolderZip } = require('../lib/folderZip');
const { createShare, getShare } = require('../lib/shareStore');
const { getSharedStorageRoot, STORAGE_CONTEXT_SHARED } = require('../lib/storageContext');
const { createDocumentFromTemplate, listTemplates } = require('../lib/templateStore');
const { getRequestUser } = require('../lib/userContext');
const { addRecent, loadUserState, setFavorite } = require('../lib/userStateStore');
const { deleteVersion, getVersionEntry, listVersions, renameVersion, restoreVersion } = require('../lib/versionStore');
const { invalidatePreview } = require('../lib/previewStore');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function getDocumentRoot(req) {
	return req.storageContext?.documentRoot || config.documentRoot;
}

function getSharedDocumentRoot() {
	return getSharedStorageRoot(config);
}

const FEATURE_MATRIX = [
	{ feature: 'Office Editor (Writer/Calc/Impress)', category: 1, note: 'Handled by Collabora via discovery action URL.' },
	{ feature: 'CheckFileInfo/GetFile/PutFile/Locks/Tokens', category: 2, note: 'Implemented as WOPI endpoints in this app.' },
	{ feature: 'Open/Edit/View mode mapping', category: 3, note: 'Mode chosen from permission and launch context.' },
	{ feature: 'New document/spreadsheet/presentation', category: 3, note: 'Implemented as API + browser action.' },
	{ feature: 'Templates (personal/group/global/admin)', category: 3, note: 'Template roots supported via filesystem folders.' },
	{ feature: 'Rename/Move/Copy/Delete', category: 3, note: 'Implemented with stable file IDs in file registry.' },
	{ feature: 'Version history (Open/Restore)', category: 3, note: 'Snapshot-based file versions in local state store.' },
	{ feature: 'Favorites/Recent', category: 3, note: 'User-scoped state persisted per user id.' },
	{ feature: 'Public share links (view/edit)', category: 3, note: 'Public share token with server-side validation on WOPI calls.' },
	{ feature: 'Sharing users/groups/teams ACL', category: 5, note: 'Not available in this sample because no auth/ACL backend exists.' },
	{ feature: 'Activities', category: 3, note: 'Session-level aggregated activity events persisted in app state.' },
	{ feature: 'Search integration', category: 4, note: 'Basic file metadata search implemented using existing file listing.' },
	{ feature: 'Preview generation/cache/indexing queue', category: 5, note: 'No rendering worker in sample host; invalidation hook only.' },
	{ feature: 'Admin config + diagnostics', category: 3, note: 'Configuration/diagnostic endpoints implemented.' }
];

function appendQueryParameter(url, key, value) {
	const separator = url.includes('?')
		? (url.endsWith('?') || url.endsWith('&') ? '' : '&')
		: '?';
	return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function normalizeEditorMode(value) {
	return value === 'view' ? 'view' : 'edit';
}

function getDocumentTypeName(type) {
	if (type === 'text' || type === 'microsoft-text') {
		return config.defaultTextDocumentName;
	}
	if (type === 'spreadsheet' || type === 'microsoft-spreadsheet') {
		return config.defaultSpreadsheetName;
	}
	if (type === 'presentation' || type === 'microsoft-presentation') {
		return config.defaultPresentationName;
	}
	return null;
}

function getDocumentTypeFileName(type) {
	const baseName = getDocumentTypeName(type);
	if (!baseName) {
		return null;
	}
	const extension = type === 'spreadsheet' ? '.ods'
		: type === 'presentation' ? '.odp'
			: type === 'microsoft-text' ? '.docx'
				: type === 'microsoft-spreadsheet' ? '.xlsx'
					: type === 'microsoft-presentation' ? '.pptx'
						: '.odt';
	return baseName.endsWith(extension) ? baseName : `${baseName}${extension}`;
}

function mapDocumentListWithUserState(documents, userState) {
	const favoriteSet = new Set(userState.favorites);
	const recentMap = new Map(userState.recent.map((entry) => [entry.fileId, entry.openedAt]));
	return documents.map((document) => ({
		...document,
		favorite: favoriteSet.has(document.id),
		recentlyOpenedAt: recentMap.get(document.id) || null
	}));
}

async function buildLaunchPayload(req, document, mode, shareId, versionId) {
	const user = getRequestUser(req);
	const writePermission = mode === 'edit';
	const actionUrl = await getActionUrl({
		collaboraInternalUrl: config.collaboraInternalUrl,
		collaboraPublicUrl: config.collaboraPublicUrl,
		extension: document.extension,
		mode: mode
	});
	const appBaseUrl = config.getAppBaseUrl(req);
	const wopiSrc = `${appBaseUrl}/wopi/files/${encodeURIComponent(document.id)}`;
	const launchUrl = appendQueryParameter(
		appendQueryParameter(actionUrl, 'lang', req.query.lang || 'en-US'),
		'WOPISrc',
		wopiSrc
	);
	const accessToken = createAccessToken({
		fileId: document.id,
		secret: config.accessTokenSecret,
		claims: {
			userId: user.id,
			userName: user.displayName,
			canWrite: writePermission,
			canRename: writePermission,
			shareId: shareId || null,
			versionId: versionId || null,
			storageContext: shareId ? STORAGE_CONTEXT_SHARED : (req.storageContext?.context || STORAGE_CONTEXT_SHARED)
		}
	});

	await addRecent(getDocumentRoot(req), user.id, document.id);
	await appendActivity(getDocumentRoot(req), {
		type: 'open',
		fileId: document.id,
		fileName: document.name,
		userId: user.id,
		userName: user.displayName,
		mode: mode
	});

	return {
		file: document,
		mode: mode,
		actionUrl: launchUrl,
		accessToken: accessToken.token,
		accessTokenTtl: accessToken.expiresAt
	};
}

router.get('/config', function(req, res) {
	res.json({
		documentRoot: getDocumentRoot(req),
		templateRoot: config.templateRoot,
		appBaseUrl: config.getPublicAppBaseUrl(req),
		collaboraPublicUrl: config.collaboraPublicUrl,
		storageContext: req.storageContext?.context || STORAGE_CONTEXT_SHARED,
		passwordMinLength: config.passwordMinLength,
		defaultEditorMode: config.defaultEditorMode,
		features: {
			allowDocumentCreation: config.allowDocumentCreation,
			allowTemplates: config.allowTemplates,
			allowPdfExport: config.allowPdfExport,
			allowPublicEditing: config.allowPublicEditing,
			previewGeneration: config.previewGeneration
		},
		defaultDocumentNames: {
			text: getDocumentTypeFileName('text'),
			spreadsheet: getDocumentTypeFileName('spreadsheet'),
			presentation: getDocumentTypeFileName('presentation'),
			'microsoft-text': getDocumentTypeFileName('microsoft-text'),
			'microsoft-spreadsheet': getDocumentTypeFileName('microsoft-spreadsheet'),
			'microsoft-presentation': getDocumentTypeFileName('microsoft-presentation')
		}
	});
});

router.get('/feature-matrix', function(req, res) {
	res.json({
		reference: {
			app: 'Nextcloud richdocuments',
			version: '12.0.0-dev.0',
			source: 'ref_richdocuments/richdocuments/appinfo/info.xml'
		},
		categories: {
			1: 'bereits durch Collabora vorhanden',
			2: 'durch WOPI vorhanden',
			3: 'muss in der Anwendung implementiert werden',
			4: 'durch vorhandene Anwendungskomponenten bereits vorhanden',
			5: 'nicht sinnvoll bzw. nicht unterstützt'
		},
		features: FEATURE_MATRIX
	});
});

router.get('/files', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const documents = await listDocuments(getDocumentRoot(req));
		const userState = await loadUserState(getDocumentRoot(req), user.id);
		res.json({ documents: mapDocumentListWithUserState(documents, userState) });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:fileId', async function(req, res, next) {
	try {
		const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
		res.json({ file: document });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:fileId/download', async function(req, res, next) {
	try {
		const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);

		if (req.query.versionId) {
			if (document.isDirectory) {
				throw createHttpError(400, 'Folders do not have versions.');
			}
			const { storagePath } = await getVersionEntry(getDocumentRoot(req), req.params.fileId, req.query.versionId);
			res.type(document.mimeType);
			res.download(storagePath, document.name);
			return;
		}

		if (document.isDirectory) {
			const zipArtifact = await createFolderZip(document);
			res
				.status(200)
				.type('application/zip')
				.attachment(zipArtifact.downloadName)
				.send(zipArtifact.buffer);
			return;
		}
		res.type(document.mimeType);
		res.download(document.absolutePath, document.name);
	} catch (error) {
		next(error);
	}
});

router.post('/files/bulk-download', async function(req, res, next) {
	try {
		const fileIds = Array.isArray(req.body.fileIds) ? req.body.fileIds : [];
		if (fileIds.length === 0) {
			throw createHttpError(400, 'No documents were selected for download.');
		}

		const documents = [];
		for (const fileId of fileIds) {
			const document = await getDocumentById(getDocumentRoot(req), fileId);
			documents.push(document);
		}

		const zipArtifact = await createDocumentsZip(documents);
		res
			.status(200)
			.type('application/zip')
			.attachment(zipArtifact.downloadName)
			.send(zipArtifact.buffer);
	} catch (error) {
		next(error);
	}
});

router.get('/files/:fileId/launch', async function(req, res, next) {
	try {
		const requestedMode = normalizeEditorMode(req.query.mode || config.defaultEditorMode);
		const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
		if (document.isDirectory) {
			throw createHttpError(404, 'Folders cannot be opened.');
		}
		const launchPayload = await buildLaunchPayload(req, document, requestedMode);
		res.json(launchPayload);
	} catch (error) {
		next(error);
	}
});

router.post('/files', async function(req, res, next) {
	try {
		if (!config.allowDocumentCreation) {
			throw createHttpError(403, 'Document creation is disabled.');
		}

		const user = getRequestUser(req);
		let document;
		if (req.body.templateId) {
			if (!config.allowTemplates) {
				throw createHttpError(403, 'Templates are disabled.');
			}

			document = await createDocumentFromTemplate(config, getDocumentRoot(req), user, {
				templateId: req.body.templateId,
				directory: req.body.directory,
				fileName: req.body.fileName
			});
		} else {
			const baseName = req.body.fileName || getDocumentTypeName(req.body.type || 'text');
			if (!baseName) {
				throw createHttpError(400, 'Unsupported document type.');
			}

			document = await createDocumentByType(getDocumentRoot(req), {
				documentType: req.body.type || 'text',
				directory: req.body.directory,
				baseName: baseName
			});
		}

		await appendActivity(getDocumentRoot(req), {
			type: 'create',
			fileId: document.id,
			fileName: document.name,
			userId: user.id,
			userName: user.displayName
		});
		await invalidatePreview(getDocumentRoot(req), document);
		const launchPayload = await buildLaunchPayload(req, document, normalizeEditorMode(req.body.mode || 'edit'));
		res.status(201).json(launchPayload);
	} catch (error) {
		next(error);
	}
});

router.post('/folders', async function(req, res, next) {
	try {
		if (!config.allowDocumentCreation) {
			throw createHttpError(403, 'Folder creation is disabled.');
		}

		const user = getRequestUser(req);
		const folder = await createFolder(getDocumentRoot(req), {
			directory: req.body.directory,
			folderName: req.body.folderName
		});
		await appendActivity(getDocumentRoot(req), {
			type: 'create-folder',
			fileId: folder.id,
			fileName: folder.name,
			userId: user.id,
			userName: user.displayName
		});
		res.status(201).json({ folder: folder });
	} catch (error) {
		next(error);
	}
});

router.post('/uploads', upload.array('files'), async function(req, res, next) {
	try {
		if (!config.allowDocumentCreation) {
			throw createHttpError(403, 'Uploads are disabled.');
		}

		let relativePaths = [];
		if (req.body.relativePaths) {
			try {
				const parsedRelativePaths = JSON.parse(req.body.relativePaths);
				if (!Array.isArray(parsedRelativePaths)) {
					throw new Error('relativePaths must be an array.');
				}
				relativePaths = parsedRelativePaths.map((entry) => String(entry || ''));
			} catch (error) {
				throw createHttpError(400, 'Upload metadata is invalid.');
			}
		}

		const uploadEntries = (req.files || []).map((file, index) => ({
			fileName: file.originalname,
			relativePath: relativePaths[index] || file.originalname,
			content: file.buffer
		}));
		const result = await uploadDocuments(getDocumentRoot(req), {
			directory: req.body.directory,
			files: uploadEntries
		});
		const user = getRequestUser(req);

		for (const document of result.uploadedDocuments) {
			await appendActivity(getDocumentRoot(req), {
				type: 'upload',
				fileId: document.id,
				fileName: document.name,
				userId: user.id,
				userName: user.displayName
			});
			await invalidatePreview(getDocumentRoot(req), document);
		}

		res.status(result.errors.length === 0 ? 201 : 200).json({
			files: result.uploadedDocuments,
			errors: result.errors
		});
	} catch (error) {
		next(error);
	}
});

router.post('/files/:fileId/move', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const result = await renameOrMoveDocument(getDocumentRoot(req), req.params.fileId, {
			targetDirectory: req.body.targetDirectory,
			targetName: req.body.targetName,
			conflictResolution: req.body.conflictResolution,
			operation: 'move'
		});
		if (result && result.skipped) {
			res.json({ skipped: true, operation: 'move', conflict: result.conflict });
			return;
		}
		const document = result || await getDocumentById(getDocumentRoot(req), req.params.fileId);
		await appendActivity(getDocumentRoot(req), {
			type: 'move',
			fileId: document.id,
			fileName: document.name,
			userId: user.id,
			userName: user.displayName
		});
		await invalidatePreview(getDocumentRoot(req), document);
		res.json({ file: document });
	} catch (error) {
		if (error && error.code === 'FILE_CONFLICT') {
			res.status(409).json(error.details || { error: 'FILE_CONFLICT', message: error.message });
			return;
		}
		next(error);
	}
});

router.post('/files/:fileId/copy', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const result = await copyDocument(getDocumentRoot(req), req.params.fileId, {
			targetDirectory: req.body.targetDirectory,
			targetName: req.body.targetName,
			conflictResolution: req.body.conflictResolution,
			operation: 'copy'
		});
		if (result && result.skipped) {
			res.json({ skipped: true, operation: 'copy', conflict: result.conflict });
			return;
		}
		const copiedDocument = result;
		await appendActivity(getDocumentRoot(req), {
			type: 'copy',
			fileId: copiedDocument.id,
			fileName: copiedDocument.name,
			userId: user.id,
			userName: user.displayName
		});
		await invalidatePreview(getDocumentRoot(req), copiedDocument);
		res.status(201).json({ file: copiedDocument });
	} catch (error) {
		if (error && error.code === 'FILE_CONFLICT') {
			res.status(409).json(error.details || { error: 'FILE_CONFLICT', message: error.message });
			return;
		}
		next(error);
	}
});

router.delete('/files/:fileId', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const deletedDocument = await deleteDocument(getDocumentRoot(req), req.params.fileId);
		await appendActivity(getDocumentRoot(req), {
			type: 'delete',
			fileId: deletedDocument.id,
			fileName: deletedDocument.name,
			userId: user.id,
			userName: user.displayName
		});
		res.status(204).end();
	} catch (error) {
		next(error);
	}
});

router.get('/files/:fileId/versions', async function(req, res, next) {
	try {
		const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
		if (document.isDirectory) {
			throw createHttpError(404, 'Folders do not have version history.');
		}
		const versions = await listVersions(getDocumentRoot(req), document);
		res.json({ versions: versions });
	} catch (error) {
		next(error);
	}
});

router.post('/files/:fileId/versions/:versionId/restore', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
		if (document.isDirectory) {
			throw createHttpError(404, 'Folders do not have version history.');
		}
		await restoreVersion(getDocumentRoot(req), document, req.params.versionId, {
			id: user.id,
			name: user.displayName
		});
		const updatedDocument = await getDocumentById(getDocumentRoot(req), req.params.fileId);
		await invalidatePreview(getDocumentRoot(req), updatedDocument);
		await appendActivity(getDocumentRoot(req), {
			type: 'restore-version',
			fileId: updatedDocument.id,
			fileName: updatedDocument.name,
			userId: user.id,
			userName: user.displayName,
			versionId: req.params.versionId
		});
		res.json({ file: updatedDocument });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:fileId/versions/:versionId/view', async function(req, res, next) {
	try {
		const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
		if (document.isDirectory) {
			throw createHttpError(404, 'Folders do not have version history.');
		}
		await getVersionEntry(getDocumentRoot(req), req.params.fileId, req.params.versionId);
		const launchPayload = await buildLaunchPayload(req, document, 'view', null, req.params.versionId);
		res.json(launchPayload);
	} catch (error) {
		next(error);
	}
});

router.patch('/files/:fileId/versions/:versionId', async function(req, res, next) {
	try {
		const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
		if (document.isDirectory) {
			throw createHttpError(404, 'Folders do not have version history.');
		}
		const label = req.body.label != null ? String(req.body.label).trim() : null;
		await renameVersion(getDocumentRoot(req), req.params.fileId, req.params.versionId, label || null);
		const versions = await listVersions(getDocumentRoot(req), document);
		res.json({ versions: versions });
	} catch (error) {
		next(error);
	}
});

router.delete('/files/:fileId/versions/:versionId', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
		if (document.isDirectory) {
			throw createHttpError(404, 'Folders do not have version history.');
		}
		await deleteVersion(getDocumentRoot(req), document, req.params.versionId);
		await appendActivity(getDocumentRoot(req), {
			type: 'delete-version',
			fileId: document.id,
			fileName: document.name,
			userId: user.id,
			userName: user.displayName,
			versionId: req.params.versionId
		});
		res.status(204).end();
	} catch (error) {
		next(error);
	}
});

router.post('/files/:fileId/favorite', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const favorite = req.body.favorite !== false;
		const favorites = await setFavorite(getDocumentRoot(req), user.id, req.params.fileId, favorite);
		res.json({ favorites: favorites });
	} catch (error) {
		next(error);
	}
});

router.get('/favorites', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const userState = await loadUserState(getDocumentRoot(req), user.id);
		const files = await Promise.all(
			userState.favorites.map(async (fileId) => {
				try {
					return await getDocumentById(getDocumentRoot(req), fileId);
				} catch (error) {
					return null;
				}
			})
		);
		res.json({ files: files.filter(Boolean) });
	} catch (error) {
		next(error);
	}
});

router.get('/recent', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const userState = await loadUserState(getDocumentRoot(req), user.id);
		const files = await Promise.all(
			userState.recent.map(async (entry) => {
				try {
					const file = await getDocumentById(getDocumentRoot(req), entry.fileId);
					return {
						file: file,
						openedAt: entry.openedAt
					};
				} catch (error) {
					return null;
				}
			})
		);
		res.json({ recent: files.filter(Boolean) });
	} catch (error) {
		next(error);
	}
});

router.get('/activities', async function(req, res, next) {
	try {
		const limit = Number.parseInt(req.query.limit, 10) || 50;
		const activity = await listActivity(getDocumentRoot(req), limit);
		res.json({ activities: activity });
	} catch (error) {
		next(error);
	}
});

router.get('/templates', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const templates = await listTemplates(config, user);
		res.json({ templates: templates });
	} catch (error) {
		next(error);
	}
});

router.post('/shares', async function(req, res, next) {
	try {
		const document = await getDocumentById(getSharedDocumentRoot(), req.body.fileId);
		if (document.isDirectory) {
			throw createHttpError(400, 'Folders cannot be shared.');
		}

		const share = await createShare(getSharedDocumentRoot(), {
			fileId: req.body.fileId,
			permission: req.body.permission
		});
		res.status(201).json({
			share: share,
			url: `${config.getPublicAppBaseUrl(req)}/share/${encodeURIComponent(share.id)}`
		});
	} catch (error) {
		next(error);
	}
});

router.get('/shares/:shareId/launch', async function(req, res, next) {
	try {
		const share = await getShare(getSharedDocumentRoot(), req.params.shareId);
		if (share.permission === 'edit' && !config.allowPublicEditing) {
			throw createHttpError(403, 'Public edit links are disabled.');
		}

		const document = await getDocumentById(getSharedDocumentRoot(), share.fileId);
		const launchPayload = await buildLaunchPayload(req, document, share.permission, share.id);
		res.json(launchPayload);
	} catch (error) {
		next(error);
	}
});

router.get('/search', async function(req, res, next) {
	try {
		const query = String(req.query.q || '').trim().toLowerCase();
		if (!query) {
			res.json({ files: [] });
			return;
		}

		const documents = await listDocuments(getDocumentRoot(req));
		const files = documents.filter((document) => (
			document.name.toLowerCase().includes(query) ||
			document.relativePath.toLowerCase().includes(query) ||
			String(document.mimeType || '').toLowerCase().includes(query) ||
			document.updatedAt.toLowerCase().includes(query)
		));
		res.json({ files: files });
	} catch (error) {
		next(error);
	}
});

router.get('/admin/config', async function(req, res, next) {
	try {
		const supportedFormats = await getSupportedFormats(config.collaboraInternalUrl);
		res.json({
			collaboraServer: config.collaboraPublicUrl,
			connectionStatus: 'configured',
			defaultEditorMode: config.defaultEditorMode,
			allowDocumentCreation: config.allowDocumentCreation,
			allowTemplates: config.allowTemplates,
			allowPdfExport: config.allowPdfExport,
			allowPublicEditing: config.allowPublicEditing,
			previewGeneration: config.previewGeneration,
			supportedFormats: supportedFormats
		});
	} catch (error) {
		next(error);
	}
});

router.get('/admin/diagnostics', async function(req, res, next) {
	try {
		const diagnostics = {
			collaboraDiscovery: { ok: false },
			wopi: { ok: false }
		};

		try {
			const formats = await getSupportedFormats(config.collaboraInternalUrl);
			diagnostics.collaboraDiscovery = {
				ok: true,
				supportedFormatCount: formats.length
			};
		} catch (error) {
			diagnostics.collaboraDiscovery = {
				ok: false,
				error: error.message
			};
		}

		try {
			await fs.access(getDocumentRoot(req));
			diagnostics.wopi = { ok: true };
		} catch (error) {
			diagnostics.wopi = { ok: false, error: error.message };
		}

		res.json(diagnostics);
	} catch (error) {
		next(error);
	}
});

router.get('/supported-formats', async function(req, res, next) {
	try {
		const discoveryExtensions = await getSupportedFormats(config.collaboraInternalUrl);
		const staticallySupported = Object.keys(SUPPORTED_MIME_TYPES).sort((a, b) => a.localeCompare(b));
		res.json({
			discoveryExtensions: discoveryExtensions,
			staticExtensions: staticallySupported
		});
	} catch (error) {
		next(error);
	}
});

module.exports = router;
