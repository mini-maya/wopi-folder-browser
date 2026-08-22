'use strict';

const { createHttpError } = require('./errors');

/**
 * Mount Authorization Middleware
 * Validates that the authenticated user has access to the requested mount.
 * 
 * Usage:
 *   app.use('/api/mounts/:mountId', mountAuthMiddleware(mountRegistry, userStore, config));
 * 
 * The middleware checks:
 * 1. User is authenticated
 * 2. Mount exists and is accessible
 * 3. User has permissions for that mount
 * 
 * If any check fails, returns 403 Forbidden.
 */

function createMountAuthMiddleware(mountRegistry, userStore, config) {
	return async function mountAuthMiddleware(req, res, next) {
		try {
			// Mount ID should be in the URL parameters
			const mountId = req.params.mountId || req.query.mountId || null;

			// Some endpoints (like /api/mounts) don't require a specific mount
			if (!mountId) {
				return next();
			}

			// Require authentication
			if (!req.auth?.authenticated || !req.auth?.user) {
				throw createHttpError(401, 'Authentication required.');
			}

			// Validate the mount exists and is accessible
			const validation = mountRegistry.validateMount(mountId);
			if (!validation.valid) {
				throw createHttpError(403, validation.reason);
			}

			// Get user's permitted mounts
			const userMounts = await userStore.getUserMounts(config.documentRoot, req.auth.user.id);

			// Check if user has access to this mount
			const hasAccess = userMounts.includes(String(mountId));
			if (!hasAccess) {
				throw createHttpError(403, `Mount access denied: ${mountId}`);
			}

			// Attach mount to request for downstream handlers
			req.mount = validation.mount;
			req.mountId = mountId;

			next();
		} catch (error) {
			next(error);
		}
	};
}

module.exports = {
	createMountAuthMiddleware
};
