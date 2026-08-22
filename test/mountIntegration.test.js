'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function clearRepositoryModules() {
	for (const cacheKey of Object.keys(require.cache)) {
		if (cacheKey.includes(`${path.sep}wopi-folder-browser${path.sep}`)) {
			delete require.cache[cacheKey];
		}
	}
}

function createClient(baseUrl) {
	const clientState = { cookie: '' };
	return {
		async request(endpoint, options = {}) {
			const headers = {
				'Content-Type': 'application/json',
				...(options.headers || {})
			};
			if (clientState.cookie) {
				headers.Cookie = clientState.cookie;
			}
			const response = await fetch(`${baseUrl}${endpoint}`, {
				method: options.method || 'GET',
				headers: headers,
				body: options.body ? JSON.stringify(options.body) : undefined
			});
			const setCookieHeader = response.headers.get('set-cookie');
			if (setCookieHeader) {
				clientState.cookie = setCookieHeader.split(';')[0];
			}
			let payload = null;
			try {
				payload = await response.json();
			} catch (error) {
				payload = null;
			}
			return { response, payload };
		}
	};
}

async function startIsolatedServer() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-mount-integration-'));
	const mountRoot = path.join(tempRoot, 'mounts');
	const stateRoot = path.join(tempRoot, 'state');
	await fs.mkdir(path.join(mountRoot, 'documents'), { recursive: true });
	await fs.mkdir(path.join(mountRoot, 'archive'), { recursive: true });
	await fs.mkdir(stateRoot, { recursive: true });

	const collaboraServer = http.createServer(function(req, res) {
		if (req.url === '/hosting/discovery') {
			res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
			res.end(`<?xml version="1.0" encoding="UTF-8"?>
<wopi-discovery>
  <net-zone>
    <app name="writer">
      <action ext="odt" name="edit" urlsrc="http://127.0.0.1/cool/edit.html?"/>
      <action ext="odt" name="view" urlsrc="http://127.0.0.1/cool/view.html?"/>
    </app>
  </net-zone>
</wopi-discovery>`);
			return;
		}
		res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end('not found');
	});
	await new Promise((resolve) => collaboraServer.listen(0, resolve));

	process.env.MOUNT_ROOT = mountRoot;
	process.env.WOPI_STATE_ROOT = stateRoot;
	process.env.SESSION_SECRET = 'test-session-secret';
	process.env.ACCESS_TOKEN_SECRET = 'test-access-token-secret';
	process.env.COLLABORA_INTERNAL_URL = `http://127.0.0.1:${collaboraServer.address().port}`;
	process.env.COLLABORA_PUBLIC_URL = `http://127.0.0.1:${collaboraServer.address().port}`;
	clearRepositoryModules();
	const app = require('../app');
	const server = app.listen(0);
	await new Promise((resolve) => server.once('listening', resolve));

	return {
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		server,
		collaboraServer,
		mountRoot,
		tempRoot
	};
}

async function setupInitialAdmin(client) {
	const response = await client.request('/api/auth/setup-initial-admin', {
		method: 'POST',
		body: { username: 'admin', password: 'AdminPassword123' }
	});
	assert.equal(response.response.status, 201);
	return response.payload.user.id;
}

async function login(client, username, password) {
	const response = await client.request('/api/auth/login', {
		method: 'POST',
		body: { username, password }
	});
	assert.equal(response.response.status, 200);
	return response.payload.user.id;
}

async function assignMounts(client, userId, mounts) {
	const response = await client.request(`/api/admin/users/${encodeURIComponent(userId)}/mounts`, {
		method: 'PUT',
		body: { mounts }
	});
	assert.equal(response.response.status, 200);
	return response.payload;
}

test('auth and mount permissions expose only assigned mounts', async function() {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const aliceClient = createClient(instance.baseUrl);
	const bobClient = createClient(instance.baseUrl);

	try {
		const adminId = await setupInitialAdmin(adminClient);
		await login(adminClient, 'admin', 'AdminPassword123');
		await assignMounts(adminClient, adminId, ['documents', 'archive']);

		const aliceId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'alice', password: 'AlicePassword123', role: 'user', generatePassword: false }
		})).payload.user.id;
		const bobId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'bob', password: 'BobPassword12345', role: 'user', generatePassword: false }
		})).payload.user.id;
		await assignMounts(adminClient, aliceId, ['documents']);
		await assignMounts(adminClient, bobId, ['archive']);

		await login(aliceClient, 'alice', 'AlicePassword123');
		const aliceMounts = await aliceClient.request('/api/mounts');
		assert.deepEqual(aliceMounts.payload.map((mount) => mount.id), ['documents']);
		assert.equal((await aliceClient.request('/api/files?mountId=documents')).response.status, 200);
		assert.equal((await aliceClient.request('/api/files?mountId=archive')).response.status, 403);

		await login(bobClient, 'bob', 'BobPassword12345');
		const bobMounts = await bobClient.request('/api/mounts');
		assert.deepEqual(bobMounts.payload.map((mount) => mount.id), ['archive']);
		assert.equal((await bobClient.request('/api/files?mountId=archive')).response.status, 200);
		assert.equal((await bobClient.request('/api/files?mountId=documents')).response.status, 403);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});

test('mount access control rejects unauthorized mounts and preserves isolation', async function() {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const aliceClient = createClient(instance.baseUrl);
	const bobClient = createClient(instance.baseUrl);

	try {
		const adminId = await setupInitialAdmin(adminClient);
		await login(adminClient, 'admin', 'AdminPassword123');
		await assignMounts(adminClient, adminId, ['documents', 'archive']);

		const aliceId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'alice', password: 'AlicePassword123', role: 'user', generatePassword: false }
		})).payload.user.id;
		const bobId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'bob', password: 'BobPassword12345', role: 'user', generatePassword: false }
		})).payload.user.id;
		await assignMounts(adminClient, aliceId, ['documents']);
		await assignMounts(adminClient, bobId, ['archive']);

		await login(adminClient, 'admin', 'AdminPassword123');
		const docFile = (await adminClient.request('/api/files?mountId=documents', {
			method: 'POST',
			body: { type: 'text', fileName: 'shared-name' }
		})).payload.file.id;
		const archiveFile = (await adminClient.request('/api/files?mountId=archive', {
			method: 'POST',
			body: { type: 'text', fileName: 'shared-name' }
		})).payload.file.id;

		await login(aliceClient, 'alice', 'AlicePassword123');
		assert.equal((await aliceClient.request(`/api/files/${encodeURIComponent(docFile)}`)).response.status, 200);
		assert.equal((await aliceClient.request(`/api/files/${encodeURIComponent(archiveFile)}`)).response.status, 404);
		assert.equal((await aliceClient.request('/api/files?mountId=archive')).response.status, 403);

		await login(bobClient, 'bob', 'BobPassword12345');
		assert.equal((await bobClient.request(`/api/files/${encodeURIComponent(archiveFile)}`)).response.status, 200);
		assert.equal((await bobClient.request(`/api/files/${encodeURIComponent(docFile)}`)).response.status, 404);
		assert.equal((await bobClient.request('/api/files?mountId=documents')).response.status, 403);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});

test('WOPI workflows stay isolated per mount', async function() {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const aliceClient = createClient(instance.baseUrl);
	const bobClient = createClient(instance.baseUrl);

	try {
		const adminId = await setupInitialAdmin(adminClient);
		await login(adminClient, 'admin', 'AdminPassword123');
		await assignMounts(adminClient, adminId, ['documents', 'archive']);

		const aliceId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'alice', password: 'AlicePassword123', role: 'user', generatePassword: false }
		})).payload.user.id;
		const bobId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'bob', password: 'BobPassword12345', role: 'user', generatePassword: false }
		})).payload.user.id;
		await assignMounts(adminClient, aliceId, ['documents']);
		await assignMounts(adminClient, bobId, ['archive']);

		await login(adminClient, 'admin', 'AdminPassword123');
		const docFile = (await adminClient.request('/api/files?mountId=documents', {
			method: 'POST',
			body: { type: 'text', fileName: 'wopi-shared.odt' }
		})).payload.file;
		const archiveFile = (await adminClient.request('/api/files?mountId=archive', {
			method: 'POST',
			body: { type: 'text', fileName: 'wopi-shared.odt' }
		})).payload.file;

		await login(aliceClient, 'alice', 'AlicePassword123');
		const launch = await aliceClient.request(`/api/files/${encodeURIComponent(docFile.id)}/launch?mode=edit&mountId=documents`);
		assert.equal(launch.response.status, 200);
		assert.equal(launch.payload.file.id, docFile.id);
		assert.match(launch.payload.accessToken, /^[A-Za-z0-9._~-]+$/);

		const wopiInfo = await fetch(`${instance.baseUrl}/wopi/files/${encodeURIComponent(docFile.id)}?access_token=${encodeURIComponent(launch.payload.accessToken)}`);
		assert.equal(wopiInfo.status, 200);
		const wopiPayload = await wopiInfo.json();
		assert.equal(wopiPayload.UserCanWrite, true);

		const lockResponse = await fetch(`${instance.baseUrl}/wopi/files/${encodeURIComponent(docFile.id)}?access_token=${encodeURIComponent(launch.payload.accessToken)}`, {
			method: 'POST',
			headers: {
				'X-WOPI-Override': 'LOCK',
				'X-WOPI-Lock': 'alice-lock'
			}
		});
		assert.equal(lockResponse.status, 200);

		const saveResponse = await fetch(`${instance.baseUrl}/wopi/files/${encodeURIComponent(docFile.id)}/contents?access_token=${encodeURIComponent(launch.payload.accessToken)}`, {
			method: 'POST',
			headers: {
				'X-WOPI-Lock': 'alice-lock',
				'Content-Type': 'application/octet-stream'
			},
			body: Buffer.from('updated by alice')
		});
		assert.equal(saveResponse.status, 200);
		assert.equal(await fs.readFile(path.join(instance.mountRoot, 'documents', 'wopi-shared.odt'), 'utf8'), 'updated by alice');

		const crossMountResponse = await fetch(`${instance.baseUrl}/wopi/files/${encodeURIComponent(archiveFile.id)}?access_token=${encodeURIComponent(launch.payload.accessToken)}`);
		assert.equal(crossMountResponse.status, 403);

		await login(bobClient, 'bob', 'BobPassword12345');
		const bobLaunch = await bobClient.request(`/api/files/${encodeURIComponent(archiveFile.id)}/launch?mode=view&mountId=archive`);
		assert.equal(bobLaunch.response.status, 200);
		const bobInfo = await fetch(`${instance.baseUrl}/wopi/files/${encodeURIComponent(archiveFile.id)}?access_token=${encodeURIComponent(bobLaunch.payload.accessToken)}`);
		assert.equal(bobInfo.status, 200);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});
