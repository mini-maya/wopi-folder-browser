'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAccessToken, verifyAccessToken } = require('../lib/accessToken');

test('createAccessToken and verifyAccessToken accept a matching file id', function() {
	const secret = 'unit-test-secret';
	const result = createAccessToken({
		fileId: 'sample-file',
		secret: secret,
		ttlMs: 5_000,
		claims: {
			canWrite: true
		}
	});

	const payload = verifyAccessToken(result.token, {
		fileId: 'sample-file',
		secret: secret
	});

	assert.equal(payload.fileId, 'sample-file');
	assert.equal(payload.canWrite, true);
	assert.ok(payload.exp > Date.now());
});

test('verifyAccessToken rejects mismatched file ids', function() {
	const secret = 'unit-test-secret';
	const result = createAccessToken({
		fileId: 'sample-file',
		secret: secret,
		ttlMs: 5_000
	});

	assert.throws(function() {
		verifyAccessToken(result.token, {
			fileId: 'another-file',
			secret: secret
		});
	}, /does not match/);
});

test('verifyAccessToken runs payload validation callback', function() {
	const secret = 'unit-test-secret';
	const result = createAccessToken({
		fileId: 'sample-file',
		secret: secret,
		ttlMs: 5_000,
		claims: {
			mode: 'view'
		}
	});

	assert.throws(function() {
		verifyAccessToken(result.token, {
			fileId: 'sample-file',
			secret: secret,
			validate: function(payload) {
				if (payload.mode !== 'edit') {
					throw new Error('mode mismatch');
				}
			}
		});
	}, /mode mismatch/);
});
