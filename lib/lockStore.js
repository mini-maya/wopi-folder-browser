'use strict';

const LOCK_TTL_MS = 30 * 60 * 1000;
const lockMap = new Map();

function getLock(fileId) {
	const entry = lockMap.get(fileId);
	if (!entry) {
		return null;
	}

	if (entry.expiresAt <= Date.now()) {
		lockMap.delete(fileId);
		return null;
	}

	return entry;
}

function setLock(fileId, lockValue) {
	lockMap.set(fileId, {
		lock: lockValue,
		expiresAt: Date.now() + LOCK_TTL_MS
	});
}

function clearLock(fileId) {
	lockMap.delete(fileId);
}

function ensureLockMatches(fileId, lockValue) {
	const existingLock = getLock(fileId);
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
