'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');

const config = require('../lib/config');
const packageJson = require('../package.json');
const { createAccessToken } = require('../lib/accessToken');
const { appendActivity, listActivity, removeActivityEntriesForFile } = require('../lib/activityStore');
const { getActionUrl, getSupportedFormats } = require('../lib/discovery');
const {
  copyDocument,
  createDocumentByType,
  createFolder,
  deleteDocument,
  getDocumentById,
  listDocuments,
  pruneMissingDocumentEntries,
  renameOrMoveDocument,
  SUPPORTED_MIME_TYPES,
  uploadDocuments
} = require('../lib/documentStore');
const { createHttpError } = require('../lib/errors');
const { createDocumentsZip, createFolderZip } = require('../lib/folderZip');
const { deleteRecycledEntry, listRecycledEntries, restoreRecycledEntry } = require('../lib/recycleStore');
const {
  createPublicShare,
  consumePublicShareAccess,
  createShare,
  deletePublicShare,
  getPublicShareById,
  getPublicShareResponse,
  updatePublicShare,
  validatePublicShareAccess,
  listPublicSharesByFile
} = require('../lib/shareStore');
const { getSharedStorageRoot, getUserStorageRoot } = require('../lib/storageContext');
const { createDocumentFromTemplate, listTemplates } = require('../lib/templateStore');
const { renderOfficeThumbnail } = require('../lib/thumbnailService');
const { getRequestUser } = require('../lib/userContext');
const { addRecent, loadUserState, removeDocumentReferences, setFavorite } = require('../lib/userStateStore');
const { deleteVersion, getVersionEntry, listVersions, renameVersion, restoreVersion } = require('../lib/versionStore');
const { getThumbnailPublicUrl, invalidatePreview, resolveThumbnailAbsolutePath } = require('../lib/previewStore');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function getDocumentRoot(req) {
  if (req.storage?.id === 'shared') {
    return getSharedStorageRoot(config);
  }

  if (req.storage?.id === 'documents' || !req.storage) {
    const userId = req.auth?.user?.id || req.session?.userId;
    if (userId) {
      return getUserStorageRoot(config, userId);
    }
  }

  return req.storage?.root || config.documentRoot;
}

function ensureWritableStorage(req) {
  if (req.storage?.readOnly === true) {
    throw createHttpError(403, 'Selected storage is read-only.');
  }
}

function logThumbnailDebug(message, details) {
  if (!config.thumbnailDebug) {
    return;
  }
  if (details !== undefined) {
    console.info('[thumbnail-debug]', message, details);
    return;
  }
  console.info('[thumbnail-debug]', message);
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
  { feature: 'Activities', category: 3, note: 'Session-level aggregated activity events (open/view/edit) persisted in app state.' },
  { feature: 'Search integration', category: 4, note: 'Basic file metadata search implemented using existing file listing.' },
  { feature: 'Preview generation/cache/indexing queue', category: 3, note: 'Office detail thumbnails are rendered via Collabora convert-to and cached per file version.' },
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

function getDocumentActivityType(beforeDocument, afterDocument) {
  if (!beforeDocument || !afterDocument) {
    return 'move';
  }
  const beforeDirectory = path.posix.dirname(beforeDocument.relativePath || '');
  const afterDirectory = path.posix.dirname(afterDocument.relativePath || '');
  const beforeName = path.posix.basename(beforeDocument.relativePath || '');
  const afterName = path.posix.basename(afterDocument.relativePath || '');

  if (beforeDirectory === afterDirectory && beforeName !== afterName) {
    return 'rename';
  }

  return 'move';
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

async function buildLaunchPayload(req, document, mode, options = {}) {
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
      shareId: options.shareId || null,
      versionId: options.versionId || null,
      shareOwnerUserId: options.shareOwnerUserId || null,
      sharePermission: options.sharePermission || null,
      shareDownloadEnabled: options.shareDownloadEnabled !== false,
      storageId: req.storage?.id || 'documents'
    }
  });

  await addRecent(getDocumentRoot(req), user.id, document.id);
  await appendActivity(getDocumentRoot(req), {
    type: mode === 'view' ? 'view' : 'open',
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
  const storageManager = req.app.locals.storageManager;
  const requestedStorageId = req.requestedStorageId || req.storage?.id || 'documents';
  const requestedStorage = storageManager.list().find((entry) => entry.id === requestedStorageId) || null;
  res.json({
    appVersion: packageJson.version,
    storageId: requestedStorageId,
    storageName: requestedStorage?.name || req.storage?.name || 'Documents',
    storageReadOnly: requestedStorage?.readOnly === true,
    storageAvailable: requestedStorageId === (req.storage?.id || 'documents') && requestedStorage?.available !== false,
    sharedStorageMode: String(config.sharedStorageMode || 'disabled').trim().toLowerCase(),
    templateRoot: config.templateRoot,
    appBaseUrl: config.getPublicAppBaseUrl(req),
    collaboraPublicUrl: config.collaboraPublicUrl,
    passwordMinLength: config.passwordMinLength,
    defaultEditorMode: config.defaultEditorMode,
    features: {
      allowDocumentCreation: config.allowDocumentCreation,
      allowTemplates: config.allowTemplates,
      allowPdfExport: config.allowPdfExport,
      allowPublicEditing: config.allowPublicEditing,
      previewGeneration: config.previewGeneration,
      officeThumbnails: true
    },
    thumbnail: {
      maxWidth: config.thumbnailMaxWidth,
      maxHeight: config.thumbnailMaxHeight,
      debug: config.thumbnailDebug
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

router.post('/files/prune-missing', async function(req, res, next) {
  try {
    const documentRoot = getDocumentRoot(req);
    const result = await pruneMissingDocumentEntries(documentRoot);
    res.json({
      ok: true,
      removed: Boolean(result.removed),
      missingEntryCount: Number(result.missingEntryCount || 0),
      removedFileIds: Array.isArray(result.removedFileIds) ? result.removedFileIds : []
    });
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

router.get('/files/:fileId/thumbnail', async function(req, res, next) {
  try {
    const documentRoot = getDocumentRoot(req);
    const document = await getDocumentById(documentRoot, req.params.fileId);
    logThumbnailDebug('thumbnail request received', {
      fileId: document.id,
      version: document.version,
      extension: document.extension
    });
    if (!config.previewGeneration) {
      res.json({
        status: 'CONVERSION_NOT_SUPPORTED',
        fileId: document.id,
        version: document.version,
        error: 'Preview generation is disabled.'
      });
      return;
    }
    const user = getRequestUser(req);
    const payload = await renderOfficeThumbnail({
      documentRoot: documentRoot,
      document: document,
      appBaseUrl: config.getAppBaseUrl(req),
      accessTokenSecret: config.accessTokenSecret,
      accessTokenTtlMs: config.thumbnailTokenTtlMs,
      collaboraInternalUrl: config.collaboraInternalUrl,
      maxWidth: config.thumbnailMaxWidth,
      maxHeight: config.thumbnailMaxHeight,
      retryAttempts: config.thumbnailRetryCount,
      retryDelayMs: config.thumbnailRetryDelayMs,
      requestTimeoutMs: config.thumbnailRequestTimeoutMs,
      userId: user.id,
      userName: user.displayName,
      storageId: req.storage?.id || 'documents'
    });
    logThumbnailDebug('thumbnail request completed', {
      fileId: payload.fileId,
      version: payload.version,
      status: payload.status
    });
    res.json(payload);
  } catch (error) {
    logThumbnailDebug('thumbnail request failed', {
      fileId: req.params.fileId,
      error: error.message
    });
    next(error);
  }
});

async function resolveThumbnailRequest(req, res, next) {
  try {
    const absolutePath = await resolveThumbnailAbsolutePath(getDocumentRoot(req), req.params.fileId, req.params.version);
    if (!absolutePath) {
      throw createHttpError(404, 'Thumbnail not found.');
    }
    res.type('image/png');
    res.sendFile(absolutePath);
  } catch (error) {
    next(error);
  }
}

router.get('/thumbnails/:fileId/:version', resolveThumbnailRequest);
router.get('/storage/:storageId/thumbnails/:fileId/:version', resolveThumbnailRequest);

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
      res.status(200).type('application/zip').attachment(zipArtifact.downloadName).send(zipArtifact.buffer);
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
    res.status(200).type('application/zip').attachment(zipArtifact.downloadName).send(zipArtifact.buffer);
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
    ensureWritableStorage(req);
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
    ensureWritableStorage(req);
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
    ensureWritableStorage(req);
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
    ensureWritableStorage(req);
    const user = getRequestUser(req);
    const previousDocument = await getDocumentById(getDocumentRoot(req), req.params.fileId);
    const result = await renameOrMoveDocument(getDocumentRoot(req), req.params.fileId, {
      targetDirectory: req.body.targetDirectory,
      targetName: req.body.targetName,
      conflictResolution: req.body.conflictResolution,
      directoryConflictResolution: req.body.directoryConflictResolution,
      directoryConflictResolutions: req.body.directoryConflictResolutions,
      fileConflictResolution: req.body.fileConflictResolution,
      fileConflictResolutions: req.body.fileConflictResolutions,
      operation: 'move',
      actor: { id: user.id, name: user.displayName },
      context: req.storage?.id || 'documents'
    });
    if (result && result.skipped) {
      res.json({ skipped: true, operation: 'move', conflict: result.conflict });
      return;
    }
    const document = result || previousDocument;
    const activityType = getDocumentActivityType(previousDocument, document);
    await appendActivity(getDocumentRoot(req), {
      type: activityType,
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
    ensureWritableStorage(req);
    const user = getRequestUser(req);
    const result = await copyDocument(getDocumentRoot(req), req.params.fileId, {
      targetDirectory: req.body.targetDirectory,
      targetName: req.body.targetName,
      conflictResolution: req.body.conflictResolution,
      directoryConflictResolution: req.body.directoryConflictResolution,
      directoryConflictResolutions: req.body.directoryConflictResolutions,
      fileConflictResolution: req.body.fileConflictResolution,
      fileConflictResolutions: req.body.fileConflictResolutions,
      operation: 'copy',
      actor: { id: user.id, name: user.displayName },
      context: req.storage?.id || 'documents'
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
    ensureWritableStorage(req);
    const user = getRequestUser(req);
    const deletedDocument = await deleteDocument(getDocumentRoot(req), req.params.fileId, {
      actor: { id: user.id, name: user.displayName },
      context: req.storage?.id || 'documents'
    });
    await appendActivity(getDocumentRoot(req), {
      type: 'recycle',
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

router.get('/recycle', async function(req, res, next) {
  try {
    const entries = (await listRecycledEntries(getDocumentRoot(req))).map((entry) => ({
      ...entry,
      thumbnailUrl: entry.previewVersion ? getThumbnailPublicUrl(entry.fileId, entry.previewVersion, req.storage?.id || 'documents') : null
    }));
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});

router.post('/recycle/:entryId/restore', async function(req, res, next) {
  try {
    ensureWritableStorage(req);
    const user = getRequestUser(req);
    const result = await restoreRecycledEntry(getDocumentRoot(req), req.params.entryId, {
      actor: { id: user.id, name: user.displayName },
      context: req.storage?.id || 'documents',
      conflictResolution: req.body?.conflictResolution
    });
    if (result?.skipped) {
      res.json(result);
      return;
    }
    if (result?.conflict) {
      const source = result.source || {};
      res.status(409).json({
        error: 'FILE_CONFLICT',
        message: 'A file already exists at the restore location.',
        conflictType: 'file',
        source: {
          name: source.originalName || 'Recovered file',
          type: 'file',
          size: source.versionSize || 0,
          modifiedAt: source.deletedAt || null,
          relativePath: source.originalPath || '',
          mimeType: null,
          kind: 'file'
        },
        target: {
          name: source.originalName || 'Existing file',
          type: 'file',
          size: 0,
          modifiedAt: null,
          relativePath: source.originalPath || '',
          mimeType: null,
          kind: 'file'
        }
      });
      return;
    }
    const restoredDocument = await getDocumentById(getDocumentRoot(req), result.fileId);
    await appendActivity(getDocumentRoot(req), {
      type: 'restore',
      fileId: restoredDocument.id,
      fileName: restoredDocument.name,
      userId: user.id,
      userName: user.displayName
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/recycle/:entryId', async function(req, res, next) {
  try {
    ensureWritableStorage(req);
    const user = getRequestUser(req);
    const recycledEntries = await listRecycledEntries(getDocumentRoot(req));
    const recycledEntry = recycledEntries.find((entry) => entry.id === req.params.entryId);
    const deleted = await deleteRecycledEntry(getDocumentRoot(req), req.params.entryId);
    if (!deleted) {
      throw createHttpError(404, 'Recycled entry not found.');
    }
    await appendActivity(getDocumentRoot(req), {
      type: 'delete',
      fileId: recycledEntry?.fileId || req.params.entryId,
      fileName: recycledEntry?.originalName || recycledEntry?.originalPath || req.params.entryId,
      userId: user.id,
      userName: user.displayName
    });
    if (recycledEntry?.fileId) {
      await removeActivityEntriesForFile(getDocumentRoot(req), recycledEntry.fileId);
      await removeDocumentReferences(getDocumentRoot(req), recycledEntry.fileId);
    }
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
    ensureWritableStorage(req);
    const user = getRequestUser(req);
    const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
    if (document.isDirectory) {
      throw createHttpError(404, 'Folders do not have version history.');
    }
    await restoreVersion(getDocumentRoot(req), document, req.params.versionId);
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
    const launchPayload = await buildLaunchPayload(req, document, 'view', {
      versionId: req.params.versionId
    });
    res.json(launchPayload);
  } catch (error) {
    next(error);
  }
});

router.patch('/files/:fileId/versions/:versionId', async function(req, res, next) {
  try {
    ensureWritableStorage(req);
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
    ensureWritableStorage(req);
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
          return { file: file, openedAt: entry.openedAt };
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
    if (!req.auth?.authenticated) {
      throw createHttpError(401, 'Authentication required.');
    }
    const user = getRequestUser(req);
    const document = await getDocumentById(getDocumentRoot(req), req.body.fileId);
    if (document.isDirectory) {
      throw createHttpError(400, 'Folders cannot be shared.');
    }

    const share = await createShare(config.documentRoot, {
      storageId: req.storage?.id || 'documents',
      fileId: req.body.fileId,
      permission: req.body.permission,
      createdBy: user.id,
      ownerUserId: req.storage?.id === 'documents' ? user.id : null
    });
    res.status(201).json({
      share: share,
      url: `${config.getPublicAppBaseUrl(req)}/share/${encodeURIComponent(share.token)}`
    });
  } catch (error) {
    next(error);
  }
});

router.get('/files/:fileId/public-shares', async function(req, res, next) {
  try {
    if (!req.auth?.authenticated) {
      throw createHttpError(401, 'Authentication required.');
    }
    const user = getRequestUser(req);
    const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
    if (document.isDirectory) {
      throw createHttpError(400, 'Only files can be shared publicly.');
    }
    const shares = await listPublicSharesByFile(config.documentRoot, req.params.fileId);
    const visibleShares = shares.filter((share) => req.auth.user.role === 'admin' || share.createdBy === user.id);
    const baseUrl = config.getPublicAppBaseUrl(req);
    res.json({
      enabled: visibleShares.length > 0,
      shares: visibleShares.map((share) => getPublicShareResponse(share, baseUrl))
    });
  } catch (error) {
    next(error);
  }
});

router.post('/files/:fileId/public-share', async function(req, res, next) {
  try {
    if (!req.auth?.authenticated) {
      throw createHttpError(401, 'Authentication required.');
    }
    const user = getRequestUser(req);
    const document = await getDocumentById(getDocumentRoot(req), req.params.fileId);
    if (document.isDirectory) {
      throw createHttpError(400, 'Only files can be shared publicly.');
    }
    const permission = String(req.body.permission || 'read').trim().toLowerCase();
    const share = await createPublicShare(config.documentRoot, {
      resourceId: req.params.fileId,
      storageId: req.storage?.id || 'documents',
      permission: permission,
      password: req.body.password ?? null,
      downloadEnabled: req.body.downloadEnabled !== false,
      expiresAt: req.body.expiresAt ?? null,
      maxAccessCount: req.body.maxAccessCount ?? null,
      note: req.body.note ?? null,
      createdBy: user.id,
      ownerUserId: req.storage?.id === 'documents' ? user.id : null
    });
    res.status(201).json(getPublicShareResponse(share, config.getPublicAppBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

router.patch('/public-shares/:shareId', async function(req, res, next) {
  try {
    if (!req.auth?.authenticated) {
      throw createHttpError(401, 'Authentication required.');
    }
    const user = getRequestUser(req);
    const existing = await getPublicShareById(config.documentRoot, req.params.shareId);
    if (req.auth.user.role !== 'admin' && existing.createdBy !== user.id) {
      throw createHttpError(403, 'You are not allowed to manage this share.');
    }
    const updatedShare = await updatePublicShare(config.documentRoot, req.params.shareId, {
      permission: req.body.permission,
      password: Object.prototype.hasOwnProperty.call(req.body, 'password') ? req.body.password : undefined,
      downloadEnabled: req.body.downloadEnabled,
      expiresAt: req.body.expiresAt,
      maxAccessCount: req.body.maxAccessCount,
      note: req.body.note,
      status: req.body.status
    });
    res.json(getPublicShareResponse(updatedShare, config.getPublicAppBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

router.delete('/public-shares/:shareId', async function(req, res, next) {
  try {
    if (!req.auth?.authenticated) {
      throw createHttpError(401, 'Authentication required.');
    }
    const user = getRequestUser(req);
    const existing = await getPublicShareById(config.documentRoot, req.params.shareId);
    if (req.auth.user.role !== 'admin' && existing.createdBy !== user.id) {
      throw createHttpError(403, 'You are not allowed to manage this share.');
    }
    const deleted = await deletePublicShare(config.documentRoot, req.params.shareId);
    if (!deleted) {
      throw createHttpError(404, 'Share link not found.');
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/shares/:shareId/launch', async function(req, res, next) {
  try {
    const password = req.get('X-Share-Password') || req.query.password || null;
    const validatedShare = await validatePublicShareAccess(config.documentRoot, req.params.shareId, { password: password });
    if (validatedShare.permission === 'read_write' && !config.allowPublicEditing) {
      throw createHttpError(403, 'Public edit links are disabled.');
    }

    const storageManager = req.app.locals.storageManager;
    const { storage } = storageManager.resolveOrHttpError(validatedShare.storageId);
    const shareDocumentRoot = validatedShare.storageId === 'documents' && validatedShare.ownerUserId
      ? getUserStorageRoot(config, validatedShare.ownerUserId)
      : (validatedShare.storageId === 'shared' ? getSharedStorageRoot(config) : storage.root);

    const document = await getDocumentById(shareDocumentRoot, validatedShare.resourceId);
    const share = await consumePublicShareAccess(config.documentRoot, validatedShare.id);
    req.storage = storage;
    const launchPayload = await buildLaunchPayload(
      req,
      document,
      share.permission === 'read_write' ? 'edit' : 'view',
      {
        shareId: share.id,
        shareOwnerUserId: share.ownerUserId,
        sharePermission: share.permission,
        shareDownloadEnabled: share.downloadEnabled
      }
    );
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

module.exports = router;
module.exports.getDocumentRoot = getDocumentRoot;
module.exports.normalizeEditorMode = normalizeEditorMode;
module.exports.getDocumentActivityType = getDocumentActivityType;
module.exports.buildLaunchPayload = buildLaunchPayload;
module.exports.resolveThumbnailRequest = resolveThumbnailRequest;
