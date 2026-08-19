'use strict';

const fs = require('node:fs/promises');
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

async function removeDocumentReferences(documentRoot, fileId) {
	const normalizedFileId = String(fileId);
	const usersDirectory = getUsersDirectory(documentRoot);
	await ensureDirectory(usersDirectory);

	let changed = false;
	const userStateFiles = await fs.readdir(usersDirectory, { withFileTypes: true });
	for (const entry of userStateFiles) {
		if (!entry.isFile() || !entry.name.endsWith('.json')) {
			continue;
		}
		const userStatePath = path.join(usersDirectory, entry.name);
		const state = await readJson(userStatePath, { favorites: [], recent: [] });
		const previousFavorites = Array.isArray(state.favorites) ? state.favorites : [];
		const previousRecent = Array.isArray(state.recent) ? state.recent : [];
		const nextFavorites = previousFavorites.filter((favoriteId) => String(favoriteId) !== normalizedFileId);
		const nextRecent = previousRecent.filter((recentEntry) => {
			if (!recentEntry || typeof recentEntry !== 'object') {
				return true;
			}
			return String(recentEntry.fileId || '') !== normalizedFileId;
		});
		if (previousFavorites.length !== nextFavorites.length || previousRecent.length !== nextRecent.length) {
			await writeJsonAtomic(userStatePath, { ...state, favorites: nextFavorites, recent: nextRecent });
			changed = true;
		}
	}
	return changed;
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
	removeDocumentReferences: removeDocumentReferences,
	setFavorite: setFavorite
};
