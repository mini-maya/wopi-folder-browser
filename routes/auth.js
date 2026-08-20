'use strict';

const express = require('express');

const config = require('../lib/config');
const { createHttpError } = require('../lib/errors');
const { createInitialAdmin } = require('../lib/initialAdminSetup');
const { loadInstallState } = require('../lib/installStore');
const { generatePassword, hashPassword, verifyPassword } = require('../lib/passwords');
const { destroySession, regenerateSession, requireAuth } = require('../lib/sessionAuth');
const { assertValidPassword, getUserByUsername, hasAdminUser, setUserPassword, toPublicUser } = require('../lib/userStore');

const router = express.Router();

function mapAuthResponse(req) {
	if (!req.auth?.authenticated) {
		return {
			authenticated: false,
			user: null,
			storageId: req.storage?.id || 'documents'
		};
	}

	return {
		authenticated: true,
		user: {
			id: req.auth.user.id,
			username: req.auth.user.username,
			role: req.auth.user.role,
			active: Boolean(req.auth.user.active),
			must_change_password: Boolean(req.auth.user.must_change_password)
		},
		storageId: req.storage?.id || 'documents'
	};
}

router.get('/setup-status', async function(req, res, next) {
	try {
		const [state, adminExists] = await Promise.all([
			loadInstallState(config.documentRoot),
			hasAdminUser(config.documentRoot)
		]);
		res.json({
			completed: state.completed || adminExists
		});
	} catch (error) {
		next(error);
	}
});

router.post('/setup-initial-admin', async function(req, res, next) {
	try {
		const user = await createInitialAdmin(config, {
			username: req.body.username,
			password: req.body.password
		});
		res.status(201).json({
			user: user
		});
	} catch (error) {
		next(error);
	}
});

router.post('/login', async function(req, res, next) {
	try {
		const username = String(req.body.username || '').trim();
		const password = String(req.body.password || '');
		if (!username || !password) {
			throw createHttpError(400, 'Username and password are required.');
		}

		const user = await getUserByUsername(config.documentRoot, username);
		if (!user || !user.active) {
			throw createHttpError(401, 'Invalid credentials.');
		}

		const validPassword = await verifyPassword(password, user.password_hash);
		if (!validPassword) {
			throw createHttpError(401, 'Invalid credentials.');
		}

		await regenerateSession(req);
		req.session.userId = user.id;
		req.auth = { authenticated: true, user: user };

		res.json({
			authenticated: true,
			user: toPublicUser(user),
			storageId: req.storage?.id || 'documents'
		});
	} catch (error) {
		next(error);
	}
});

router.post('/logout', async function(req, res, next) {
	try {
		await destroySession(req);
		res.clearCookie('wopi.sid');
		res.status(204).end();
	} catch (error) {
		next(error);
	}
});

router.get('/me', function(req, res) {
	res.json(mapAuthResponse(req));
});

router.post('/storage-context', requireAuth, async function(req, res, next) {
	try {
		const storageManager = req.app.locals.storageManager;
		const requestedStorageId = String(req.body.storageId || req.body.context || '').trim();
		const { storage } = storageManager.resolveOrHttpError(requestedStorageId || 'documents');
		req.session.selectedStorageId = storage.id;
		res.json({
			storageId: storage.id
		});
	} catch (error) {
		next(error);
	}
});

router.post('/storage', requireAuth, async function(req, res, next) {
	try {
		const storageManager = req.app.locals.storageManager;
		const requestedStorageId = String(req.body.storageId || '').trim();
		if (!requestedStorageId) {
			throw createHttpError(400, 'storageId is required.');
		}
		const { storage } = storageManager.resolveOrHttpError(requestedStorageId);
		req.session.selectedStorageId = storage.id;
		res.json({
			storageId: storage.id
		});
	} catch (error) {
		next(error);
	}
});

router.post('/change-password', requireAuth, async function(req, res, next) {
	try {
		const currentPassword = String(req.body.currentPassword || '');
		const newPassword = String(req.body.newPassword || '');
		if (!currentPassword || !newPassword) {
			throw createHttpError(400, 'Current and new password are required.');
		}

		const validPassword = await verifyPassword(currentPassword, req.auth.user.password_hash);
		if (!validPassword) {
			throw createHttpError(401, 'Current password is invalid.');
		}
		assertValidPassword(newPassword);

		const nextHash = await hashPassword(newPassword);
		const updated = await setUserPassword(config.documentRoot, req.auth.user.id, nextHash, false);
		req.auth = { authenticated: true, user: updated };
		res.status(204).end();
	} catch (error) {
		next(error);
	}
});

router.post('/generate-password', requireAuth, function(req, res) {
	res.json({ password: generatePassword() });
});

module.exports = router;
