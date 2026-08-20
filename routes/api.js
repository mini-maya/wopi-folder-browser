'use strict';

const fs = require('node:fs/promises');
const express = require('express');

const config = require('../lib/config');
const { getSupportedFormats } = require('../lib/discovery');
const { requireAdmin } = require('../lib/sessionAuth');
const documentsRouter = require('./apiDocuments');

const router = express.Router();

router.use(documentsRouter);

router.get('/storages', async function(req, res, next) {
  try {
    const storageManager = req.app.locals.storageManager;
    await storageManager.ensureInitialized();
    const mode = String(config.sharedStorageMode || 'disabled').trim().toLowerCase();
    const storageAclById = new Map((storageManager.storages || []).map((storage) => [storage.id, storage]));
    const visibleStorages = storageManager.list().filter((entry) => {
      if (!entry.enabled) {
        return false;
      }
      if (entry.id === 'documents') {
        return Boolean(req.auth?.authenticated);
      }
      if (entry.id === 'shared') {
        if (mode === 'disabled') {
          return false;
        }
        if (mode === 'auth') {
          return Boolean(req.auth?.authenticated);
        }
        return true;
      }
      if (entry.id === 'external') {
        if (!req.auth?.authenticated) {
          return false;
        }
        const aclSource = storageAclById.get(entry.id);
        const allowedUsers = Array.isArray(aclSource?.allowedUserIds) ? aclSource.allowedUserIds.map((id) => String(id)) : [];
        return allowedUsers.length > 0 && allowedUsers.includes(String(req.auth.user.id));
      }
      return true;
    });
    res.json(visibleStorages);
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
      thumbnailMaxWidth: config.thumbnailMaxWidth,
      thumbnailMaxHeight: config.thumbnailMaxHeight,
      thumbnailRetryCount: config.thumbnailRetryCount,
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
      await fs.access(documentsRouter.getDocumentRoot(req));
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
    const staticallySupported = Object.keys(require('../lib/documentStore').SUPPORTED_MIME_TYPES).sort((a, b) => a.localeCompare(b));
    res.json({
      discoveryExtensions: discoveryExtensions,
      staticExtensions: staticallySupported
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
