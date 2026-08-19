'use strict';

const path = require('node:path');

const { getContextStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('./statePaths');

const EDIT_AGGREGATION_WINDOW_MS = 2 * 60 * 1000;

function getActivityPath(documentRoot) {
	return path.join(getContextStateRoot(documentRoot), 'activities.json');
}

async function loadActivity(documentRoot) {
	await ensureDirectory(getContextStateRoot(documentRoot));
	const data = await readJson(getActivityPath(documentRoot), []);
	return Array.isArray(data) ? data : [];
}

async function saveActivity(documentRoot, activityItems) {
	await writeJsonAtomic(getActivityPath(documentRoot), activityItems.slice(-500));
}

async function appendActivity(documentRoot, entry) {
	const items = await loadActivity(documentRoot);
	items.push({
		id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
		createdAt: new Date().toISOString(),
		...entry
	});
	await saveActivity(documentRoot, items);
}

async function recordEditActivity(documentRoot, entry) {
	const items = await loadActivity(documentRoot);
	const now = Date.now();
	const last = items.length > 0 ? items.at(-1) : null;
	if (
		last?.type === 'edit' &&
		last.fileId === entry.fileId &&
		last.userId === entry.userId &&
		now - Date.parse(last.createdAt) < EDIT_AGGREGATION_WINDOW_MS
	) {
		last.createdAt = new Date(now).toISOString();
		last.count = (last.count || 1) + 1;
		await saveActivity(documentRoot, items);
		return;
	}

	items.push({
		id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
		type: 'edit',
		fileId: entry.fileId,
		fileName: entry.fileName,
		userId: entry.userId,
		userName: entry.userName,
		count: 1,
		createdAt: new Date(now).toISOString()
	});
	await saveActivity(documentRoot, items);
}

async function listActivity(documentRoot, limit = 50) {
	const items = await loadActivity(documentRoot);
	return items.slice(-Math.max(1, Math.min(limit, 200))).reverse();
}

module.exports = {
	appendActivity: appendActivity,
	listActivity: listActivity,
	recordEditActivity: recordEditActivity
};
