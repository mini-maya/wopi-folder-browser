'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');

const config = require('../lib/config');
const { createHttpError } = require('../lib/errors');
const { generatePassword, hashPassword } = require('../lib/passwords');
const { requireAdmin } = require('../lib/sessionAuth');
const { ensureUserStorageRoot, getSharedStorageRoot } = require('../lib/storageContext');
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
const { checkDocumentConsistency } = require('../lib/consistencyCheck');
const { cleanupStaleDocumentEntry } = require('../lib/documentStore');

const router = express.Router();

function mergeContextReports(contextReports) {
	const allIssues = [];
	const summary = {
		totalFiles: 0,
		totalRegistryEntries: 0,
		totalRecycledEntries: 0,
		totalPreviewEntries: 0,
		totalActivityEntries: 0,
		issueCount: 0,
		errorCount: 0,
		warningCount: 0,
		infoCount: 0
	};
	const contexts = [];

	for (const report of contextReports) {
		const contextName = String(report.context || 'current');
		contexts.push({
			name: contextName,
			status: report.status || 'ok',
			summary: report.summary || {}
		});
		allIssues.push(...(Array.isArray(report.issues) ? report.issues : []));
		summary.totalFiles += Number(report.summary?.totalFiles || 0);
		summary.totalRegistryEntries += Number(report.summary?.totalRegistryEntries || 0);
		summary.totalRecycledEntries += Number(report.summary?.totalRecycledEntries || 0);
		summary.totalPreviewEntries += Number(report.summary?.totalPreviewEntries || 0);
		summary.totalActivityEntries += Number(report.summary?.totalActivityEntries || 0);
	}

	allIssues.sort((left, right) => {
		if ((left.severity || 'warning') !== (right.severity || 'warning')) {
			return (left.severity || 'warning') === 'error' ? -1 : 1;
		}
		return String(left.type || '').localeCompare(String(right.type || ''));
	});
	summary.issueCount = allIssues.filter((issue) => (issue.severity || 'warning') === 'error' || (issue.severity || 'warning') === 'warning').length;
	summary.errorCount = allIssues.filter((issue) => (issue.severity || 'warning') === 'error').length;
	summary.warningCount = allIssues.filter((issue) => (issue.severity || 'warning') === 'warning').length;
	summary.infoCount = allIssues.filter((issue) => (issue.severity || 'warning') === 'info').length;

	return {
		status: summary.errorCount + summary.warningCount === 0 ? 'ok' : 'inconsistent',
		checkedAt: new Date().toISOString(),
		scope: 'all',
		summary: summary,
		issues: allIssues,
		contexts: contexts,
		actions: [
			{ id: 'download-report', label: 'Download report', type: 'download' }
		]
	};
}

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
		await ensureUserStorageRoot(config, user.id);

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

router.post('/state-consistency', async function(req, res, next) {
	try {
		const allContexts = req.body && req.body.allContexts === true;
		if (!allContexts) {
			const report = await checkDocumentConsistency(req.storageContext?.documentRoot || config.documentRoot);
			report.scope = 'current';
			res.json(report);
			return;
		}

		const roots = [getSharedStorageRoot(config)];
		const usersRoot = path.join(config.documentRoot, 'users');
		try {
			const userEntries = await fs.readdir(usersRoot, { withFileTypes: true });
			for (const entry of userEntries) {
				if (!entry.isDirectory()) {
					continue;
				}
				roots.push(path.join(usersRoot, entry.name));
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}

		const contextReports = [];
		for (const root of roots) {
			const report = await checkDocumentConsistency(root);
			report.context = root === getSharedStorageRoot(config) ? 'shared' : path.basename(root);
			contextReports.push(report);
		}

		res.json(mergeContextReports(contextReports));
	} catch (error) {
		next(error);
	}
});

router.post('/state-consistency/cleanup', async function(req, res, next) {
	try {
		const documentRoot = req.storageContext?.documentRoot || config.documentRoot;
		const fileId = req.body && req.body.fileId ? String(req.body.fileId) : null;
		const relativePath = req.body && req.body.relativePath ? String(req.body.relativePath) : null;
		if (!fileId && !relativePath) {
			throw createHttpError(400, 'A file id or file path is required to clean up stale state.');
		}
		const result = await cleanupStaleDocumentEntry(documentRoot, { fileId: fileId || null, relativePath: relativePath || null });
		res.json({
			ok: true,
			removed: result.removed,
			fileIds: result.fileIds || []
		});
	} catch (error) {
		next(error);
	}
});

module.exports = router;
