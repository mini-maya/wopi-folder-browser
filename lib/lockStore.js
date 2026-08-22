'use strict';

const LOCK_TTL_MS = 30 * 60 * 1000;
const lockMap = new Map();

function getLockKey(fileId, mountId) {
	return `${String(mountId || 'documents')}:${String(fileId)}`;
}

function getLock(fileId, mountId) {
	const entry = lockMap.get(getLockKey(fileId, mountId));
	if (!entry) {
		return null;
	}

	if (entry.expiresAt <= Date.now()) {
		lockMap.delete(getLockKey(fileId, mountId));
		return null;
	}

	return entry;
}

function setLock(fileId, lockValue, mountId) {
	lockMap.set(getLockKey(fileId, mountId), {
		lock: lockValue,
		expiresAt: Date.now() + LOCK_TTL_MS
	});
}

function clearLock(fileId, mountId) {
	lockMap.delete(getLockKey(fileId, mountId));
}

function ensureLockMatches(fileId, lockValue, mountId) {
	const existingLock = getLock(fileId, mountId);
	if (!existingLock) {
		return true;
	}

	return existingLock.lock === lockValue;
}

module.exports = {
	clearLock: clearLock,
	ensureLockMatches: ensureLockMatches,
	getLock: getLock,
	setLock: setLock
};
