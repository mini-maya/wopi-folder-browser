'use strict';

const path = require('node:path');

const config = require('./config');
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

// Keeps activity history bounded by age and count while always preserving the newest entry,
// even if it is older than the configured retention window (e.g. a long-idle document).
function pruneActivity(activityItems) {
	if (activityItems.length === 0) {
		return activityItems;
	}

	const maxAgeMs = config.activityMaxAgeDays * 24 * 60 * 60 * 1000;
	const cutoff = Date.now() - maxAgeMs;
	const newest = activityItems.at(-1);

	let pruned = activityItems.filter((entry) => {
		const createdAt = Date.parse(entry?.createdAt);
		return !Number.isFinite(createdAt) || createdAt >= cutoff;
	});

	if (pruned.length > config.activityMaxCount) {
		pruned = pruned.slice(-config.activityMaxCount);
	}

	if (!pruned.includes(newest)) {
		pruned.push(newest);
	}

	return pruned;
}

async function saveActivity(documentRoot, activityItems) {
	await writeJsonAtomic(getActivityPath(documentRoot), pruneActivity(activityItems));
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

async function removeActivityEntriesForFile(documentRoot, fileId) {
	const items = await loadActivity(documentRoot);
	const normalizedFileId = String(fileId);
	const nextItems = items.filter((entry) => !(entry && typeof entry === 'object' && String(entry.fileId || '') === normalizedFileId));
	if (nextItems.length !== items.length) {
	  await saveActivity(documentRoot, nextItems);
	  return true;
	}
	return false;
}

module.exports = {
	appendActivity: appendActivity,
	listActivity: listActivity,
	recordEditActivity: recordEditActivity,
	removeActivityEntriesForFile: removeActivityEntriesForFile
};
