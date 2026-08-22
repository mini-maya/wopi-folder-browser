'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createUser, getUserMounts, setUserMounts, toPublicUser } = require('../lib/userStore');

test('userStore persists mount permissions and exposes them publicly', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-user-store-mounts-'));
	const user = await createUser(tempRoot, {
		username: 'alice',
		password: 'long-enough-password',
		passwordHash: 'hash-value',
		role: 'user'
	});

	await setUserMounts(tempRoot, user.id, ['documents', ' projects ', '', null, 'archive']);

	const mounts = await getUserMounts(tempRoot, user.id);
	assert.deepEqual(mounts, ['documents', 'projects', 'archive']);

	const publicUser = toPublicUser({ ...user, mounts });
	assert.deepEqual(publicUser.mounts, ['documents', 'projects', 'archive']);
});
