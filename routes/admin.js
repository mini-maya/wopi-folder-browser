'use strict';

const express = require('express');

const config = require('../lib/config');
const { createHttpError } = require('../lib/errors');
const { generatePassword, hashPassword } = require('../lib/passwords');
const { requireAdmin } = require('../lib/sessionAuth');
const {
	createUser,
	deleteUser,
	getUserById,
	listUsers,
	assertValidPassword,
	setUserActive,
	setUserPassword,
	setUserRole,
	toPublicUser
} = require('../lib/userStore');

const router = express.Router();

router.use(requireAdmin);

router.get('/users', async function(req, res, next) {
	try {
		const users = await listUsers(config.documentRoot);
		res.json({
			users: users.map(toPublicUser)
		});
	} catch (error) {
		next(error);
	}
});

router.post('/users', async function(req, res, next) {
	try {
		const username = String(req.body.username || '').trim();
		const requestedRole = req.body.role === 'admin' ? 'admin' : 'user';
		const generateInitialPassword = req.body.generatePassword === true;
		const plainPassword = generateInitialPassword
			? generatePassword()
			: String(req.body.password || '');

		if (!plainPassword) {
			throw createHttpError(400, 'Password is required when generation is disabled.');
		}

		const passwordHash = await hashPassword(plainPassword);
		const user = await createUser(config.documentRoot, {
			username: username,
			password: plainPassword,
			passwordHash: passwordHash,
			role: requestedRole,
			active: true,
			mustChangePassword: generateInitialPassword
		});

		res.status(201).json({
			user: toPublicUser(user),
			generatedPassword: generateInitialPassword ? plainPassword : null
		});
	} catch (error) {
		next(error);
	}
});

router.patch('/users/:userId', async function(req, res, next) {
	try {
		const targetUserId = req.params.userId;
		const existing = await getUserById(config.documentRoot, targetUserId);
		if (!existing) {
			throw createHttpError(404, 'User not found.');
		}

		let updated = existing;
		if (req.body.active !== undefined) {
			updated = await setUserActive(config.documentRoot, targetUserId, req.body.active);
		}
		if (req.body.role !== undefined) {
			updated = await setUserRole(config.documentRoot, targetUserId, req.body.role);
		}

		res.json({
			user: toPublicUser(updated)
		});
	} catch (error) {
		next(error);
	}
});

router.delete('/users/:userId', async function(req, res, next) {
	try {
		if (req.params.userId === req.auth.user.id) {
			throw createHttpError(400, 'You cannot delete your own account.');
		}
		await deleteUser(config.documentRoot, req.params.userId);
		res.status(204).end();
	} catch (error) {
		next(error);
	}
});

router.post('/users/:userId/reset-password', async function(req, res, next) {
	try {
		const targetUserId = req.params.userId;
		const existing = await getUserById(config.documentRoot, targetUserId);
		if (!existing) {
			throw createHttpError(404, 'User not found.');
		}

		const useGeneratedPassword = req.body.generatePassword !== false;
		const plainPassword = useGeneratedPassword
			? generatePassword()
			: String(req.body.password || '');
		if (!plainPassword) {
			throw createHttpError(400, 'Password is required when generation is disabled.');
		}
		assertValidPassword(plainPassword);
		const passwordHash = await hashPassword(plainPassword);
		await setUserPassword(config.documentRoot, targetUserId, passwordHash, true);
		res.json({
			generatedPassword: useGeneratedPassword ? plainPassword : null
		});
	} catch (error) {
		next(error);
	}
});

router.get('/external-acl', async function(req, res, next) {
	try {
		const storageManager = req.app.locals.storageManager;
		await storageManager.ensureInitialized();
		const externalStorage = storageManager.storages.find((s) => s.id === 'external');
		res.json({
			allowedUserIds: Array.isArray(externalStorage?.allowedUserIds) ? externalStorage.allowedUserIds : []
		});
	} catch (error) {
		next(error);
	}
});

router.post('/external-acl', async function(req, res, next) {
	try {
		const storageManager = req.app.locals.storageManager;
		await storageManager.ensureInitialized();
		const allowedUserIds = Array.isArray(req.body.allowedUserIds)
			? req.body.allowedUserIds.map((id) => String(id).trim()).filter(Boolean)
			: [];
		await storageManager.updateExternalAcl(allowedUserIds);
		res.json({
			allowedUserIds: allowedUserIds
		});
	} catch (error) {
		next(error);
	}
});

module.exports = router;
