'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const config = require('./config');
const { createHttpError } = require('./errors');
const { getCommonStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

function getUsersFilePath(documentRoot) {
	return path.join(getCommonStateRoot(documentRoot), 'users.json');
}

async function loadUsers(documentRoot) {
	await ensureDirectory(getCommonStateRoot(documentRoot));
	const payload = await readJson(getUsersFilePath(documentRoot), { users: [] });
	if (!payload || typeof payload !== 'object' || !Array.isArray(payload.users)) {
		return { users: [] };
	}
	return payload;
}

async function saveUsers(documentRoot, usersPayload) {
	await writeJsonAtomic(getUsersFilePath(documentRoot), usersPayload);
}

function normalizeUsername(username) {
	return String(username || '').trim();
}

function validateRole(role) {
	return role === 'admin' ? 'admin' : 'user';
}

function toPublicUser(user) {
	return {
		id: user.id,
		username: user.username,
		role: user.role,
		active: Boolean(user.active),
		must_change_password: Boolean(user.must_change_password),
		created_at: user.created_at,
		updated_at: user.updated_at
	};
}

function assertValidUsername(username) {
	if (!username || username.length < 3 || username.length > 64) {
		throw createHttpError(400, 'Username must be between 3 and 64 characters.');
	}
	if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
		throw createHttpError(400, 'Username contains unsupported characters.');
	}
}

function assertValidPassword(password, minimumLength = config.passwordMinLength) {
	const length = String(password || '').length;
	if (length < minimumLength) {
		throw createHttpError(400, `Password must have at least ${minimumLength} characters.`);
	}
}

async function createUser(documentRoot, options) {
	const usersPayload = await loadUsers(documentRoot);
	const username = normalizeUsername(options.username);
	assertValidUsername(username);
	assertValidPassword(options.password);
	if (!options.passwordHash) {
		throw createHttpError(500, 'Missing password hash.');
	}

	const usernameExists = usersPayload.users.some((entry) => entry.username.toLowerCase() === username.toLowerCase());
	if (usernameExists) {
		throw createHttpError(409, 'Username already exists.');
	}

	const now = new Date().toISOString();
	const user = {
		id: crypto.randomUUID(),
		username: username,
		password_hash: options.passwordHash,
		role: validateRole(options.role),
		active: options.active !== false,
		must_change_password: options.mustChangePassword === true,
		created_at: now,
		updated_at: now
	};
	usersPayload.users.push(user);
	await saveUsers(documentRoot, usersPayload);
	return user;
}

async function getUserById(documentRoot, userId) {
	const usersPayload = await loadUsers(documentRoot);
	return usersPayload.users.find((entry) => entry.id === userId) || null;
}

async function getUserByUsername(documentRoot, username) {
	const usersPayload = await loadUsers(documentRoot);
	const normalized = normalizeUsername(username).toLowerCase();
	return usersPayload.users.find((entry) => entry.username.toLowerCase() === normalized) || null;
}

async function listUsers(documentRoot) {
	const usersPayload = await loadUsers(documentRoot);
	return usersPayload.users
		.slice()
		.sort((left, right) => left.created_at.localeCompare(right.created_at));
}

async function updateUser(documentRoot, userId, updateFn) {
	const usersPayload = await loadUsers(documentRoot);
	const userIndex = usersPayload.users.findIndex((entry) => entry.id === userId);
	if (userIndex === -1) {
		throw createHttpError(404, 'User not found.');
	}

	const updated = updateFn({ ...usersPayload.users[userIndex] });
	updated.updated_at = new Date().toISOString();
	usersPayload.users[userIndex] = updated;
	await saveUsers(documentRoot, usersPayload);
	return updated;
}

async function setUserActive(documentRoot, userId, active) {
	return updateUser(documentRoot, userId, (entry) => ({
		...entry,
		active: Boolean(active)
	}));
}

async function setUserRole(documentRoot, userId, role) {
	return updateUser(documentRoot, userId, (entry) => ({
		...entry,
		role: validateRole(role)
	}));
}

async function setUserPassword(documentRoot, userId, passwordHash, mustChangePassword) {
	return updateUser(documentRoot, userId, (entry) => ({
		...entry,
		password_hash: String(passwordHash),
		must_change_password: Boolean(mustChangePassword)
	}));
}

async function deleteUser(documentRoot, userId) {
	const usersPayload = await loadUsers(documentRoot);
	const userIndex = usersPayload.users.findIndex((entry) => entry.id === userId);
	if (userIndex === -1) {
		throw createHttpError(404, 'User not found.');
	}
	const [removed] = usersPayload.users.splice(userIndex, 1);
	await saveUsers(documentRoot, usersPayload);
	return removed;
}

async function hasAdminUser(documentRoot) {
	const users = await listUsers(documentRoot);
	return users.some((entry) => entry.role === 'admin');
}

module.exports = {
	createUser: createUser,
	deleteUser: deleteUser,
	getUserById: getUserById,
	getUserByUsername: getUserByUsername,
	hasAdminUser: hasAdminUser,
	listUsers: listUsers,
	setUserActive: setUserActive,
	assertValidPassword: assertValidPassword,
	setUserPassword: setUserPassword,
	setUserRole: setUserRole,
	toPublicUser: toPublicUser
};
