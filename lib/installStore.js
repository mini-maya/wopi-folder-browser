'use strict';

const path = require('node:path');

const { getStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

function getInstallStatePath(documentRoot) {
	return path.join(getStateRoot(documentRoot), 'install-state.json');
}

async function loadInstallState(documentRoot) {
	await ensureDirectory(getStateRoot(documentRoot));
	const state = await readJson(getInstallStatePath(documentRoot), {
		completed: false,
		completed_at: null
	});
	if (!state || typeof state !== 'object') {
		return { completed: false, completed_at: null };
	}
	return {
		completed: Boolean(state.completed),
		completed_at: state.completed_at || null
	};
}

async function markInstallCompleted(documentRoot) {
	const state = {
		completed: true,
		completed_at: new Date().toISOString()
	};
	await writeJsonAtomic(getInstallStatePath(documentRoot), state);
	return state;
}

module.exports = {
	loadInstallState: loadInstallState,
	markInstallCompleted: markInstallCompleted
};
