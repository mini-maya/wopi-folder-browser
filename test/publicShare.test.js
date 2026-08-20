'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	consumePublicShareAccess,
	createPublicShare,
	deletePublicShare,
	getPublicShareById,
	listPublicSharesByFile,
	updatePublicShare,
	validatePublicShareAccess
} = require('../lib/shareStore');

test('createPublicShare persists defaults and listPublicSharesByFile returns matching links', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-public-share-'));
	const share = await createPublicShare(tempRoot, {
		resourceId: 'file-1',
		storageId: 'documents',
		permission: 'read',
		createdBy: 'user-1',
		ownerUserId: 'user-1'
	});

	assert.equal(share.resourceId, 'file-1');
	assert.equal(share.permission, 'read');
	assert.equal(share.passwordEnabled, false);
	assert.equal(share.downloadEnabled, true);
	assert.equal(share.status, 'active');
	assert.equal(typeof share.token, 'string');
	assert.ok(share.token.length >= 20);

	const listed = await listPublicSharesByFile(tempRoot, 'file-1');
	assert.equal(listed.length, 1);
	assert.equal(listed[0].id, share.id);
});

test('validatePublicShareAccess enforces password and consumePublicShareAccess increments on success', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-public-share-'));
	const share = await createPublicShare(tempRoot, {
		resourceId: 'file-2',
		storageId: 'shared',
		permission: 'read_write',
		password: 'SecretPass123!',
		createdBy: 'user-2'
	});

	await assert.rejects(
		() => validatePublicShareAccess(tempRoot, share.token),
		(error) => error && error.code === 'SHARE_PASSWORD_REQUIRED'
	);
	await assert.rejects(
		() => validatePublicShareAccess(tempRoot, share.token, { password: 'wrong' }),
		(error) => error && error.code === 'INVALID_SHARE_PASSWORD'
	);

	const afterFailedAttempts = await getPublicShareById(tempRoot, share.id);
	assert.equal(afterFailedAttempts.accessCount, 0);

	const granted = await validatePublicShareAccess(tempRoot, share.token, { password: 'SecretPass123!' });
	assert.equal(granted.id, share.id);
	await consumePublicShareAccess(tempRoot, share.id);
	const reloaded = await getPublicShareById(tempRoot, share.id);
	assert.equal(reloaded.accessCount, 1);
});

test('validatePublicShareAccess enforces maxAccessCount and transitions to exhausted', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-public-share-'));
	const share = await createPublicShare(tempRoot, {
		resourceId: 'file-3',
		storageId: 'external',
		permission: 'read',
		maxAccessCount: 2,
		createdBy: 'user-3'
	});

	await validatePublicShareAccess(tempRoot, share.token);
	await consumePublicShareAccess(tempRoot, share.id);
	await validatePublicShareAccess(tempRoot, share.token);
	await consumePublicShareAccess(tempRoot, share.id);

	await assert.rejects(
		() => consumePublicShareAccess(tempRoot, share.id),
		/has reached its access limit/
	);

	const exhausted = await getPublicShareById(tempRoot, share.id);
	assert.equal(exhausted.status, 'exhausted');
	assert.equal(exhausted.accessCount, 2);
});

test('updatePublicShare updates mutable fields and deletePublicShare removes link', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-public-share-'));
	const share = await createPublicShare(tempRoot, {
		resourceId: 'file-4',
		storageId: 'documents',
		permission: 'read',
		createdBy: 'user-4',
		ownerUserId: 'user-4'
	});

	const updated = await updatePublicShare(tempRoot, share.id, {
		permission: 'read_write',
		password: 'AnotherSecret123!',
		downloadEnabled: false,
		expiresAt: '2030-01-01T00:00:00Z',
		maxAccessCount: 5,
		note: 'customer draft'
	});

	assert.equal(updated.permission, 'read_write');
	assert.equal(updated.passwordEnabled, true);
	assert.equal(Boolean(updated.passwordHash), true);
	assert.equal(updated.downloadEnabled, false);
	assert.equal(updated.maxAccessCount, 5);
	assert.equal(updated.note, 'customer draft');
	assert.equal(updated.expiresAt, '2030-01-01T00:00:00.000Z');

	const deleted = await deletePublicShare(tempRoot, share.id);
	assert.equal(deleted, true);
	await assert.rejects(() => getPublicShareById(tempRoot, share.id), /Share link not found/);
});
