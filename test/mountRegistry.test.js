'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MountRegistry = require('../lib/mountRegistry');

test('mountRegistry discovers visible mount directories only', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-mount-registry-'));
	await fs.mkdir(path.join(tempRoot, 'documents'));
	await fs.mkdir(path.join(tempRoot, 'projects'));
	await fs.mkdir(path.join(tempRoot, '.hidden'));
	await fs.writeFile(path.join(tempRoot, 'readme.txt'), 'ignore');

	const registry = new MountRegistry({ mountRoot: tempRoot });
	const mounts = await registry.discover();

	assert.deepEqual(mounts.map((mount) => mount.id), ['documents', 'projects']);
	assert.equal(registry.get('documents')?.root, path.join(tempRoot, 'documents'));
	assert.deepEqual(registry.getUserMounts('user-1', ['projects', 'missing', 'documents']).map((mount) => mount.id), ['projects', 'documents']);
	assert.deepEqual(registry.validateMount('documents').mount.id, 'documents');
	assert.equal(registry.validateMount('missing').valid, false);
});
