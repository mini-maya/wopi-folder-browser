'use strict';

const express = require('express');
const path = require('node:path');
const logger = require('morgan');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const config = require('./lib/config');
const adminRouter = require('./routes/admin');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const { resolveThumbnailRequest } = require('./routes/apiDocuments');
const wopiRouter = require('./routes/wopi');
const { attachAuthContext, createSessionMiddleware } = require('./lib/sessionAuth');
const { createHttpError } = require('./lib/errors');
const { StorageManager } = require('./lib/storage/storageManager');
const { DEFAULT_DOCUMENTS_STORAGE_ID, DEFAULT_SHARED_STORAGE_ID } = require('./lib/storage/storageRegistry');
const userStore = require('./lib/userStore');

const app = express();
const storageManager = new StorageManager(config);
app.locals.storageManager = storageManager;

function isPublicSharedAllowed() {
	const mode = String(config.sharedStorageMode || 'disabled').trim().toLowerCase();
	return mode === 'readonly' || mode === 'readwrite';
}

function isAuthenticatedUser(req) {
	return Boolean(req.auth?.authenticated && req.auth?.user);
}

function isStorageAllowedForRequest(req, storageId) {
	if (!storageId) {
		return false;
	}
	if (storageId === DEFAULT_DOCUMENTS_STORAGE_ID) {
		return isAuthenticatedUser(req);
	}
	if (storageId === DEFAULT_SHARED_STORAGE_ID) {
		if (!['auth', 'readonly', 'readwrite'].includes(String(config.sharedStorageMode || 'disabled').trim().toLowerCase())) {
			return false;
		}
		if (config.sharedStorageMode === 'auth') {
			return isAuthenticatedUser(req);
		}
		return true;
	}
	if (storageId === 'external') {
		if (!isAuthenticatedUser(req)) {
			return false;
		}
		const storageManager = req.app.locals?.storageManager;
		if (!storageManager) {
			return false;
		}
		try {
			const externalStorage = storageManager.storages?.find?.((s) => s.id === 'external');
			const allowedUsers = Array.isArray(externalStorage?.allowedUserIds) ? externalStorage.allowedUserIds.map((id) => String(id)) : [];
			return allowedUsers.length > 0 && allowedUsers.includes(String(req.auth.user.id));
		} catch (error) {
			return false;
		}
	}
	return true;
}

function getSafeRequestUrl(req) {
	try {
		const parsed = new URL(req.originalUrl || req.url, 'http://localhost');
		if (parsed.searchParams.has('access_token')) {
			parsed.searchParams.set('access_token', 'REDACTED');
		}
		return `${parsed.pathname}${parsed.search}`;
	} catch (error) {
		return req.originalUrl || req.url || '/';
	}
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
logger.token('safe-url', getSafeRequestUrl);
app.use(logger(':method :safe-url :status :response-time ms - :res[content-length]'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(createSessionMiddleware(config));
app.use(attachAuthContext(config, userStore));
app.use(async function(req, res, next) {
	try {
		await storageManager.ensureInitialized();
		const pathMatch = String(req.path || '').match(/^\/storage\/([^/]+)/);
		const requestedStorageId = pathMatch?.[1]
			|| req.get('X-Storage-Id')
			|| req.query?.storageId
			|| req.session?.selectedStorageId
			|| null;
		const allowUnauthenticatedApi = req.path === '/api/config'
			|| req.path === '/api/storages'
			|| req.path.startsWith('/api/auth/')
			|| req.path.startsWith('/api/shares/')
			|| req.path.startsWith('/api/admin/');
		if (!requestedStorageId && !req.auth?.authenticated && req.path.startsWith('/api') && !allowUnauthenticatedApi) {
			throw createHttpError(401, 'Authentication required.');
		}
		if (requestedStorageId && !allowUnauthenticatedApi && !isStorageAllowedForRequest(req, requestedStorageId)) {
			if (req.path.startsWith('/api') || req.path.startsWith('/wopi')) {
				throw createHttpError(403, 'Storage access is not allowed for this account.');
			}
			req.storage = null;
			req.requestedStorageId = requestedStorageId;
			next();
			return;
		}
		if (!requestedStorageId) {
			if (!req.auth?.authenticated) {
				req.storage = null;
				req.requestedStorageId = null;
				next();
				return;
			}
			req.storage = storageManager.get(DEFAULT_DOCUMENTS_STORAGE_ID);
			req.requestedStorageId = DEFAULT_DOCUMENTS_STORAGE_ID;
			next();
			return;
		}
		try {
			const { storage } = storageManager.resolveOrHttpError(requestedStorageId);
			req.storage = storage;
			req.requestedStorageId = storage.id;
		} catch (error) {
			const allowApiFallback = req.path === '/api/config'
				|| req.path === '/api/storages'
				|| req.path.startsWith('/api/auth/')
				|| req.path.startsWith('/api/shares/')
				|| req.path.startsWith('/api/admin/');
			if ((!req.path.startsWith('/api') && !req.path.startsWith('/wopi')) || allowApiFallback) {
				req.storage = null;
				req.requestedStorageId = requestedStorageId;
			} else {
				throw error;
			}
		}
		next();
	} catch (error) {
		next(error);
	}
});

app.get('/health', function(req, res) {
	res.json({ status: 'ok' });
});

app.get('/', function(req, res) {
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.get('/storage/:storageId/thumbnails/:fileId/:version', resolveThumbnailRequest);

app.get('/storage/*', function(req, res) {
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.get('/share/:shareId', function(req, res) {
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.get('/auth', function(req, res) {
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', apiRouter);
app.use('/wopi', bodyParser.raw({ type: '*/*', limit: config.maxDocumentSize }), wopiRouter);
app.use(express.static(path.join(__dirname, 'html')));

app.use(function(err, req, res, next) {
	console.error(err);
	const status = err.status || 500;
	const message = err.message || 'Internal Server Error';
	if (req.path.startsWith('/api') || req.path.startsWith('/wopi')) {
		const payload = { error: err.code || message };
		if (err.details && typeof err.details === 'object') {
			Object.assign(payload, err.details);
		}
		if (!payload.message) {
			payload.message = message;
		}
		res.status(status).json(payload);
		return;
	}

	res.status(status).send(message);
});

module.exports = app;
