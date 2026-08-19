'use strict';

const path = require('node:path');

const { getCommonUsersDirectory, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

function getUsersDirectory(documentRoot) {
	return getCommonUsersDirectory(documentRoot);
}

function getUserStatePath(documentRoot, userId) {
	return path.join(getUsersDirectory(documentRoot), `${userId}.json`);
}

async function loadUserState(documentRoot, userId) {
	await ensureDirectory(getUsersDirectory(documentRoot));
	const state = await readJson(getUserStatePath(documentRoot, userId), {
		favorites: [],
		recent: []
	});
	return {
		favorites: Array.isArray(state.favorites) ? state.favorites : [],
		recent: Array.isArray(state.recent) ? state.recent : []
	};
}

async function saveUserState(documentRoot, userId, state) {
	await writeJsonAtomic(getUserStatePath(documentRoot, userId), state);
}

async function setFavorite(documentRoot, userId, fileId, favorite) {
	const state = await loadUserState(documentRoot, userId);
	const nextFavorites = new Set(state.favorites);
	if (favorite) {
		nextFavorites.add(fileId);
	} else {
		nextFavorites.delete(fileId);
	}

	state.favorites = Array.from(nextFavorites);
	await saveUserState(documentRoot, userId, state);
	return state.favorites;
}

async function addRecent(documentRoot, userId, fileId) {
	const state = await loadUserState(documentRoot, userId);
	const now = new Date().toISOString();
	state.recent = state.recent.filter((entry) => entry.fileId !== fileId);
	state.recent.unshift({ fileId: fileId, openedAt: now });
	state.recent = state.recent.slice(0, 50);
	await saveUserState(documentRoot, userId, state);
	return state.recent;
}

module.exports = {
	addRecent: addRecent,
	loadUserState: loadUserState,
	setFavorite: setFavorite
};
