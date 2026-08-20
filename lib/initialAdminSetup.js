'use strict';

const { createHttpError } = require('./errors');
const { loadInstallState, markInstallCompleted } = require('./installStore');
const { hashPassword } = require('./passwords');
const { createUser, hasAdminUser, toPublicUser } = require('./userStore');

async function createInitialAdmin(config, options) {
	const [state, adminExists] = await Promise.all([
		loadInstallState(config.documentRoot),
		hasAdminUser(config.documentRoot)
	]);
	if (state.completed || adminExists) {
		throw createHttpError(409, 'Initial setup has already been completed.');
	}

	const username = String(options.username || '').trim();
	const password = String(options.password || '');
	if (!username || !password) {
		throw createHttpError(400, 'Username and password are required.');
	}

	const passwordHash = await hashPassword(password);
	const user = await createUser(config.documentRoot, {
		username: username,
		password: password,
		passwordHash: passwordHash,
		role: 'admin',
		active: true,
		mustChangePassword: false
	});
	await markInstallCompleted(config.documentRoot);
	return toPublicUser(user);
}

module.exports = {
	createInitialAdmin: createInitialAdmin
};
