'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { clearLock, ensureLockMatches, getLock, setLock } = require('../lib/lockStore');

test('lock entries are isolated per mount', function() {
	setLock('file-1', 'lock-a', 'documents');
	setLock('file-1', 'lock-b', 'archive');

	assert.equal(getLock('file-1', 'documents')?.lock, 'lock-a');
	assert.equal(getLock('file-1', 'archive')?.lock, 'lock-b');
	assert.equal(ensureLockMatches('file-1', 'lock-a', 'documents'), true);
	assert.equal(ensureLockMatches('file-1', 'lock-a', 'archive'), false);

	clearLock('file-1', 'documents');

	assert.equal(getLock('file-1', 'documents'), null);
	assert.equal(getLock('file-1', 'archive')?.lock, 'lock-b');
});
