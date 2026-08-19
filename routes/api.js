'use strict';

const fs = require('node:fs/promises');
const express = require('express');

const config = require('../lib/config');
const { getSupportedFormats } = require('../lib/discovery');
const documentsRouter = require('./apiDocuments');

const router = express.Router();

router.use(documentsRouter);

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
