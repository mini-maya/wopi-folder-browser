'use strict';

const express = require('express');
const fs = require('node:fs');
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
const { getPublicShareByToken } = require('./lib/shareStore');

const app = express();
const mountRegistry = new MountRegistry(config);
app.locals.mountRegistry = mountRegistry;

const SENSITIVE_QUERY_PARAMS = ['access_token', 'password'];

function getSafeRequestUrl(req) {
	try {
		const parsed = new URL(req.originalUrl || req.url, 'http://localhost');
		for (const paramName of SENSITIVE_QUERY_PARAMS) {
			if (parsed.searchParams.has(paramName)) {
				parsed.searchParams.set(paramName, 'REDACTED');
			}
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
		// A mount id embedded in the URL path or an explicit ?mountId= query
		// parameter is a deliberate, API-contract level mount selection (e.g.
		// GET /api/files?mountId=archive): reject the request outright below
		// if the account cannot access that mount.
		const strictRequestedMountId = pathMatch?.[1] || req.query?.mountId || null;
		// The X-Mount-Id header is only a best-effort client-side hint (the
		// browser's "currently selected mount"), sent automatically on every
		// request by html/javascripts/api/requestJson.mjs. It can go stale -
		// e.g. right after a different user logs in in the same browser tab -
		// so it must not fail the whole request when it no longer resolves to
		// an accessible mount; just fall through to another mount instead.
		const hintMountId = req.get('X-Mount-Id') || null;
		const persistedMountId = req.session?.selectedMountId || null;
		const userMountIds = await userStore.getUserMounts(config.stateRoot, req.auth.user.id);
		const accessibleMounts = mountRegistry.getUserMounts(req.auth.user.id, userMountIds);

		let selectedMount = null;
		if (strictRequestedMountId) {
			selectedMount = accessibleMounts.find((mount) => mount.id === String(strictRequestedMountId)) || null;
			if (!selectedMount) {
				throw createHttpError(403, 'Mount access is not allowed for this account.');
			}
		}

		if (!selectedMount && hintMountId) {
			selectedMount = accessibleMounts.find((mount) => mount.id === String(hintMountId)) || null;
		}

		if (!selectedMount && persistedMountId) {
			selectedMount = accessibleMounts.find((mount) => mount.id === String(persistedMountId)) || null;
			if (!selectedMount) {
				delete req.session.selectedMountId;
			}
		}

		if (!selectedMount && accessibleMounts.length > 0) {
			selectedMount = accessibleMounts[0];
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

const indexHtmlPath = path.join(__dirname, 'html/index.html');
let cachedIndexHtml = null;
let cachedLoginIndexHtml = null;
let cachedHiddenLayoutIndexHtml = null;
let cachedSharePasswordIndexHtml = null;

function getBaseIndexHtml() {
	if (!cachedIndexHtml) {
		cachedIndexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
	}
	return cachedIndexHtml;
}

// html/index.html ships with the app layout visible and the login form hidden
// by default. Serving that markup unchanged to an unauthenticated visitor on
// /auth causes the app layout to flash on screen before client-side JS can
// swap in the login form once it learns (asynchronously) that the user is
// not authenticated. Since the /auth route only ever serves unauthenticated
// requests (authenticated visitors are redirected to /), we can pre-swap the
// visibility of #login-page and #app-layout so the login form is already the
// visible element in the very first HTML response, avoiding the flash.
function getLoginIndexHtml() {
	if (!cachedLoginIndexHtml) {
		cachedLoginIndexHtml = getBaseIndexHtml()
			.replace(
				'<section id="login-page" class="login-page hidden" aria-hidden="true">',
				'<section id="login-page" class="login-page" aria-hidden="false">'
			)
			.replace(
				'<div id="app-layout" class="layout">',
				'<div id="app-layout" class="layout hidden">'
			);
	}
	return cachedLoginIndexHtml;
}

// Public share links (/share/:token) never populate or show the folder
// browser sidebar/table (client JS skips loadPage() for share paths), so the
// app layout should start hidden rather than flashing the empty shell before
// client JS hides it.
function getHiddenLayoutIndexHtml() {
	if (!cachedHiddenLayoutIndexHtml) {
		cachedHiddenLayoutIndexHtml = getBaseIndexHtml().replace(
			'<div id="app-layout" class="layout">',
			'<div id="app-layout" class="layout hidden">'
		);
	}
	return cachedHiddenLayoutIndexHtml;
}

// When we already know (cheaply, server-side) that a share link is
// password-protected, pre-render the password page as visible so it is
// present in the very first HTML response instead of flashing in afterwards.
function getSharePasswordIndexHtml() {
	if (!cachedSharePasswordIndexHtml) {
		cachedSharePasswordIndexHtml = getHiddenLayoutIndexHtml().replace(
			'<section id="share-password-page" class="login-page hidden" aria-hidden="true">',
			'<section id="share-password-page" class="login-page" aria-hidden="false">'
		);
	}
	return cachedSharePasswordIndexHtml;
}

function isSafeRedirectTarget(target) {
	// Only allow same-origin relative paths (single leading slash) to avoid open redirects.
	return typeof target === 'string' && /^\/(?!\/)/.test(target);
}

function redirectToLogin(req, res) {
	const redirectTarget = req.originalUrl || req.path || '/';
	const query = isSafeRedirectTarget(redirectTarget) && redirectTarget !== '/'
		? `?redirect=${encodeURIComponent(redirectTarget)}`
		: '';
	res.redirect(`/auth${query}`);
}

app.get('/', function(req, res) {
	if (!req.auth?.authenticated) {
		redirectToLogin(req, res);
		return;
	}
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.get('/mount/:mountId/thumbnails/:fileId/:version', resolveThumbnailRequest);

// Legacy mount deep-links are no longer supported; redirect to the app root
// instead of remembering/serving a specific mount from the URL.
app.get('/mount/*', function(req, res) {
	res.redirect(req.auth?.authenticated ? '/' : '/auth');
});

app.get('/share/:shareId', async function(req, res) {
	try {
		const share = await getPublicShareByToken(config.stateRoot, req.params.shareId);
		if (share.passwordEnabled) {
			res.type('html').send(getSharePasswordIndexHtml());
			return;
		}
	} catch (error) {
		// Unknown/expired/invalid tokens fall through to the default hidden-layout
		// variant; client JS calls the launch API and surfaces the specific
		// error (not-found, expired, disabled, ...) on the share-password page.
	}
	res.type('html').send(getHiddenLayoutIndexHtml());
});

app.get('/auth', function(req, res) {
	if (req.auth?.authenticated) {
		const requestedRedirect = typeof req.query?.redirect === 'string' ? req.query.redirect : '';
		res.redirect(isSafeRedirectTarget(requestedRedirect) ? requestedRedirect : '/');
		return;
	}
	res.type('html').send(getLoginIndexHtml());
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
