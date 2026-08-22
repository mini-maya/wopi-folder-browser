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
const userStore = require('./lib/userStore');
const MountRegistry = require('./lib/mountRegistry');

const app = express();
const mountRegistry = new MountRegistry(config);
app.locals.mountRegistry = mountRegistry;

function isPublicSharedAllowed() {
	return false;
}

function isAuthenticatedUser(req) {
	return Boolean(req.auth?.authenticated && req.auth?.user);
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

// Initialize mounts on first request
app.use(async function(req, res, next) {
	try {
		if (mountRegistry.getAll().length === 0) {
			await mountRegistry.discover();
		}
		next();
	} catch (error) {
		next(error);
	}
});

app.use(async function(req, res, next) {
	try {
		if (!req.auth?.authenticated || !req.auth?.user) {
			next();
			return;
		}

		const pathMatch = String(req.path || '').match(/^\/mount\/([^/]+)/);
		const explicitRequestedMountId = pathMatch?.[1] || req.get('X-Mount-Id') || req.query?.mountId || null;
		const persistedMountId = req.session?.selectedMountId || null;
		const requestedMountId = explicitRequestedMountId || persistedMountId || null;
		const userMountIds = await userStore.getUserMounts(config.stateRoot, req.auth.user.id);
		const accessibleMounts = mountRegistry.getUserMounts(req.auth.user.id, userMountIds);

		let selectedMount = null;
		if (requestedMountId) {
			selectedMount = accessibleMounts.find((mount) => mount.id === String(requestedMountId)) || null;
			if (!selectedMount && !explicitRequestedMountId && persistedMountId === String(requestedMountId)) {
				delete req.session.selectedMountId;
			} else if (!selectedMount && requestedMountId) {
				throw createHttpError(403, 'Mount access is not allowed for this account.');
			}
		}

		if (!selectedMount && accessibleMounts.length > 0) {
			selectedMount = accessibleMounts[0];
		}
		if (!selectedMount && accessibleMounts.length === 0 && req.path.startsWith('/api')) {
			selectedMount = null;
		}
		if (!selectedMount && !req.path.startsWith('/api')) {
			selectedMount = {
				id: `personal-${req.auth.user.id}`,
				name: 'Personal',
				root: path.join(config.mountRoot, 'users', String(req.auth.user.id)),
				available: true,
				personal: true
			};
		}

		if (selectedMount) {
			req.mount = selectedMount;
			req.mountId = selectedMount.id;
			if (!selectedMount.personal) {
				req.session.selectedMountId = selectedMount.id;
			}
		} else if (req.session?.selectedMountId) {
			delete req.session.selectedMountId;
		}

		next();
	} catch (error) {
		next(error);
	}
});

app.use(async function(req, res, next) {
	try {
		// API paths that don't require authentication
		const allowUnauthenticatedApi = req.path === '/api/config'
			|| req.path.startsWith('/api/auth/')
			|| req.path.startsWith('/api/shares/')
			|| req.path.startsWith('/api/admin/');
		
		// Require authentication for most API endpoints
		if (!req.auth?.authenticated && req.path.startsWith('/api') && !allowUnauthenticatedApi) {
			throw createHttpError(401, 'Authentication required.');
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

app.get('/mount/:mountId/thumbnails/:fileId/:version', resolveThumbnailRequest);

app.get('/mount/*', function(req, res) {
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
