'use strict';

const express = require('express');
const fs = require('fs/promises');

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
	SUPPORTED_MIME_TYPES
} = require('../lib/documentStore');
const { createHttpError } = require('../lib/errors');
const { createFolderZip } = require('../lib/folderZip');
const { createShare, getShare } = require('../lib/shareStore');
const { createDocumentFromTemplate, listTemplates } = require('../lib/templateStore');
const { getRequestUser } = require('../lib/userContext');
const { addRecent, loadUserState, setFavorite } = require('../lib/userStateStore');
const { listVersions, restoreVersion } = require('../lib/versionStore');
const { invalidatePreview } = require('../lib/previewStore');

const router = express.Router();

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
	if (type === 'text') {
		return config.defaultTextDocumentName;
	}
	if (type === 'spreadsheet') {
		return config.defaultSpreadsheetName;
	}
	if (type === 'presentation') {
		return config.defaultPresentationName;
	}
	return null;
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

async function buildLaunchPayload(req, document, mode, shareId) {
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
			shareId: shareId || null
		}
	});

	await addRecent(config.documentRoot, user.id, document.id);
	await appendActivity(config.documentRoot, {
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
		documentRoot: config.documentRoot,
		templateRoot: config.templateRoot,
		appBaseUrl: config.getAppBaseUrl(req),
		collaboraPublicUrl: config.collaboraPublicUrl,
		defaultEditorMode: config.defaultEditorMode,
		features: {
			allowDocumentCreation: config.allowDocumentCreation,
			allowTemplates: config.allowTemplates,
			allowPdfExport: config.allowPdfExport,
			allowPublicEditing: config.allowPublicEditing,
			previewGeneration: config.previewGeneration
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
		const documents = await listDocuments(config.documentRoot);
		const userState = await loadUserState(config.documentRoot, user.id);
		res.json({ documents: mapDocumentListWithUserState(documents, userState) });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:fileId', async function(req, res, next) {
	try {
		const document = await getDocumentById(config.documentRoot, req.params.fileId);
		res.json({ file: document });
	} catch (error) {
		next(error);
	}
});

router.get('/files/:fileId/download', async function(req, res, next) {
	try {
		const document = await getDocumentById(config.documentRoot, req.params.fileId);
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

router.get('/files/:fileId/launch', async function(req, res, next) {
	try {
		const requestedMode = normalizeEditorMode(req.query.mode || config.defaultEditorMode);
		const document = await getDocumentById(config.documentRoot, req.params.fileId);
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

			document = await createDocumentFromTemplate(config, config.documentRoot, user, {
				templateId: req.body.templateId,
				directory: req.body.directory,
				fileName: req.body.fileName
			});
		} else {
			const baseName = req.body.fileName || getDocumentTypeName(req.body.type || 'text');
			if (!baseName) {
				throw createHttpError(400, 'Unsupported document type.');
			}

			document = await createDocumentByType(config.documentRoot, {
				documentType: req.body.type || 'text',
				directory: req.body.directory,
				baseName: baseName
			});
		}

		await appendActivity(config.documentRoot, {
			type: 'create',
			fileId: document.id,
			fileName: document.name,
			userId: user.id,
			userName: user.displayName
		});
		await invalidatePreview(config.documentRoot, document);
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
		const folder = await createFolder(config.documentRoot, {
			directory: req.body.directory,
			folderName: req.body.folderName
		});
		await appendActivity(config.documentRoot, {
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

router.post('/files/:fileId/move', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const document = await renameOrMoveDocument(config.documentRoot, req.params.fileId, {
			targetDirectory: req.body.targetDirectory,
			targetName: req.body.targetName
		});
		await appendActivity(config.documentRoot, {
			type: 'move',
			fileId: document.id,
			fileName: document.name,
			userId: user.id,
			userName: user.displayName
		});
		await invalidatePreview(config.documentRoot, document);
		res.json({ file: document });
	} catch (error) {
		next(error);
	}
});

router.post('/files/:fileId/copy', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const copiedDocument = await copyDocument(config.documentRoot, req.params.fileId, {
			targetDirectory: req.body.targetDirectory,
			targetName: req.body.targetName
		});
		await appendActivity(config.documentRoot, {
			type: 'copy',
			fileId: copiedDocument.id,
			fileName: copiedDocument.name,
			userId: user.id,
			userName: user.displayName
		});
		await invalidatePreview(config.documentRoot, copiedDocument);
		res.status(201).json({ file: copiedDocument });
	} catch (error) {
		next(error);
	}
});

router.delete('/files/:fileId', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const deletedDocument = await deleteDocument(config.documentRoot, req.params.fileId);
		await appendActivity(config.documentRoot, {
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
		const document = await getDocumentById(config.documentRoot, req.params.fileId);
		if (document.isDirectory) {
			throw createHttpError(404, 'Folders do not have version history.');
		}
		const versions = await listVersions(config.documentRoot, document);
		res.json({ versions: versions });
	} catch (error) {
		next(error);
	}
});

router.post('/files/:fileId/versions/:versionId/restore', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const document = await getDocumentById(config.documentRoot, req.params.fileId);
		if (document.isDirectory) {
			throw createHttpError(404, 'Folders do not have version history.');
		}
		await restoreVersion(config.documentRoot, document, req.params.versionId, {
			id: user.id,
			name: user.displayName
		});
		const updatedDocument = await getDocumentById(config.documentRoot, req.params.fileId);
		await invalidatePreview(config.documentRoot, updatedDocument);
		await appendActivity(config.documentRoot, {
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

router.post('/files/:fileId/favorite', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const favorite = req.body.favorite !== false;
		const favorites = await setFavorite(config.documentRoot, user.id, req.params.fileId, favorite);
		res.json({ favorites: favorites });
	} catch (error) {
		next(error);
	}
});

router.get('/favorites', async function(req, res, next) {
	try {
		const user = getRequestUser(req);
		const userState = await loadUserState(config.documentRoot, user.id);
		const files = await Promise.all(
			userState.favorites.map(async (fileId) => {
				try {
					return await getDocumentById(config.documentRoot, fileId);
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
		const userState = await loadUserState(config.documentRoot, user.id);
		const files = await Promise.all(
			userState.recent.map(async (entry) => {
				try {
					const file = await getDocumentById(config.documentRoot, entry.fileId);
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
		const activity = await listActivity(config.documentRoot, limit);
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
		const document = await getDocumentById(config.documentRoot, req.body.fileId);
		if (document.isDirectory) {
			throw createHttpError(400, 'Folders cannot be shared.');
		}

		const share = await createShare(config.documentRoot, {
			fileId: req.body.fileId,
			permission: req.body.permission
		});
		res.status(201).json({
			share: share,
			url: `${config.getAppBaseUrl(req)}/share/${encodeURIComponent(share.id)}`
		});
	} catch (error) {
		next(error);
	}
});

router.get('/shares/:shareId/launch', async function(req, res, next) {
	try {
		const share = await getShare(config.documentRoot, req.params.shareId);
		if (share.permission === 'edit' && !config.allowPublicEditing) {
			throw createHttpError(403, 'Public edit links are disabled.');
		}

		const document = await getDocumentById(config.documentRoot, share.fileId);
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

		const documents = await listDocuments(config.documentRoot);
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
			await fs.access(config.documentRoot);
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
