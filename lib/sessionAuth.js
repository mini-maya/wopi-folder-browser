'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const session = require('express-session');
const createFileStore = require('session-file-store');

const { createHttpError } = require('./errors');
const { getCommonStateRoot } = require('./statePaths');

function createSessionMiddleware(config) {
	const FileStore = createFileStore(session);
	const storePath = path.join(getCommonStateRoot(config.documentRoot), 'sessions');
	const maxAgeMs = Number.parseInt(process.env.SESSION_MAX_AGE_MS, 10) || (8 * 60 * 60 * 1000);
	fs.mkdir(storePath, { recursive: true }).catch(() => {});

	return session({
		store: new FileStore({
			path: storePath,
			retries: 1
		}),
		secret: config.sessionSecret,
		name: 'wopi.sid',
		resave: false,
		saveUninitialized: false,
		rolling: true,
		unset: 'destroy',
		cookie: {
			httpOnly: true,
			sameSite: 'lax',
			secure: 'auto',
			maxAge: maxAgeMs
		}
	});
}

function attachAuthContext(config, userStore) {
	return async function(req, res, next) {
		const userId = req.session?.userId;
		if (!userId) {
			req.auth = { authenticated: false, user: null };
			next();
			return;
		}

		try {
			const user = await userStore.getUserById(config.documentRoot, userId);
			if (!user || !user.active) {
				req.session.destroy(() => {
					req.auth = { authenticated: false, user: null };
					next();
				});
				return;
			}
			req.auth = { authenticated: true, user: user };
			next();
		} catch (error) {
			next(error);
		}
	};
}

function requireAuth(req, res, next) {
	if (!req.auth?.authenticated) {
		next(createHttpError(401, 'Authentication required.'));
		return;
	}
	next();
}

function requireAdmin(req, res, next) {
	if (!req.auth?.authenticated) {
		next(createHttpError(401, 'Authentication required.'));
		return;
	}
	if (req.auth.user.role !== 'admin') {
		next(createHttpError(403, 'Admin privileges are required.'));
		return;
	}
	next();
}

function regenerateSession(req) {
	return new Promise((resolve, reject) => {
		req.session.regenerate((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

function destroySession(req) {
	return new Promise((resolve, reject) => {
		if (!req.session) {
			resolve();
			return;
		}
		req.session.destroy((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

module.exports = {
	attachAuthContext: attachAuthContext,
	createSessionMiddleware: createSessionMiddleware,
	destroySession: destroySession,
	regenerateSession: regenerateSession,
	requireAdmin: requireAdmin,
	requireAuth: requireAuth
};
