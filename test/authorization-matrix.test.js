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
			const method = options.method || 'GET';
			const headers = {
				'Content-Type': 'application/json',
				...(options.headers || {})
			};
			if (clientState.cookie) {
				headers.Cookie = clientState.cookie;
			}
			const response = await fetch(`${baseUrl}${endpoint}`, {
				method: method,
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
			return { status: response.status, payload };
		}
	};
}

async function startIsolatedServer(options = {}) {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-auth-'));
	const documentRoot = path.join(tempRoot, 'storage');
	const stateRoot = path.join(tempRoot, 'state');
	await fs.mkdir(documentRoot, { recursive: true });
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
	const collaboraAddress = collaboraServer.address();

	process.env.DOCUMENT_ROOT = documentRoot;
	process.env.WOPI_STATE_ROOT = stateRoot;
	process.env.SESSION_SECRET = 'test-session-secret';
	process.env.ACCESS_TOKEN_SECRET = 'test-access-token-secret';
	process.env.COLLABORA_INTERNAL_URL = `http://127.0.0.1:${collaboraAddress.port}`;
	process.env.COLLABORA_PUBLIC_URL = `http://127.0.0.1:${collaboraAddress.port}`;
	clearRepositoryModules();
	const app = require('../app');
	const server = app.listen(0);
	await new Promise((resolve) => server.once('listening', resolve));
	const address = server.address();
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		server,
		collaboraServer,
		tempRoot
	};
}

async function setupInitialAdmin(client, username = 'admin', password = 'password12345') {
	return client.request('/api/auth/setup-initial-admin', {
		method: 'POST',
		body: { username, password }
	});
}

async function login(client, username, password) {
	return client.request('/api/auth/login', {
		method: 'POST',
		body: { username, password }
	});
}

test('anonymous access matrix: documents storage not visible', async () => {
	const instance = await startIsolatedServer();
	const anonClient = createClient(instance.baseUrl);

	try {
		const storagesResponse = await anonClient.request('/api/storages');
		const storages = Array.isArray(storagesResponse.payload) ? storagesResponse.payload : [];
		const documentsStorage = storages.find((s) => s.id === 'documents');
		assert.strictEqual(documentsStorage, undefined, 'anonymous users should not see documents storage');
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('shared storage mode disabled: not visible to anonymous', async () => {
	const instance = await startIsolatedServer();
	const anonClient = createClient(instance.baseUrl);

	try {
		process.env.SHARED_STORAGE_MODE = 'disabled';
		clearRepositoryModules();

		const storagesResponse = await anonClient.request('/api/storages');
		const storages = Array.isArray(storagesResponse.payload) ? storagesResponse.payload : [];
		const sharedStorage = storages.find((s) => s.id === 'shared');
		assert.strictEqual(sharedStorage, undefined, 'shared storage should not be visible when disabled');
	} finally {
		delete process.env.SHARED_STORAGE_MODE;
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('documents storage is visible to authenticated users only', async () => {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const anonClient = createClient(instance.baseUrl);

	try {
		await setupInitialAdmin(adminClient, 'admin', 'password12345');
		await login(adminClient, 'admin', 'password12345');

		// Admin should see documents
		const adminStorages = await adminClient.request('/api/storages');
		assert.ok(adminStorages.payload.some((s) => s.id === 'documents'));

		// Anonymous should not
		const anonStorages = await anonClient.request('/api/storages');
		assert.strictEqual(anonStorages.payload.some((s) => s.id === 'documents'), false);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('external storage ACL: empty ACL denies all authenticated users', async () => {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const aliceClient = createClient(instance.baseUrl);
	const bobClient = createClient(instance.baseUrl);

	try {
		await setupInitialAdmin(adminClient, 'admin', 'password12345');
		await login(adminClient, 'admin', 'password12345');

		await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'alice', password: 'password12345' }
		});
		await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'bob', password: 'password12345' }
		});

		await login(aliceClient, 'alice', 'password12345');
		const aliceStorages = await aliceClient.request('/api/storages');
		assert.ok(!aliceStorages.payload.some((s) => s.id === 'external'), 'alice should not see external with empty ACL');

		await login(bobClient, 'bob', 'password12345');
		const bobStorages = await bobClient.request('/api/storages');
		assert.ok(!bobStorages.payload.some((s) => s.id === 'external'), 'bob should not see external with empty ACL');
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('external storage ACL: allowlist grants access to selected user ids', async () => {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const aliceClient = createClient(instance.baseUrl);
	const bobClient = createClient(instance.baseUrl);

	try {
		await setupInitialAdmin(adminClient, 'admin', 'password12345');
		await login(adminClient, 'admin', 'password12345');

		const aliceId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'alice', password: 'password12345' }
		})).payload.user.id;
		const bobId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'bob', password: 'password12345' }
		})).payload.user.id;

		const updateResponse = await adminClient.request('/api/admin/external-acl', {
			method: 'POST',
			body: { allowedUserIds: [aliceId] }
		});
		assert.strictEqual(updateResponse.status, 200);

		await login(aliceClient, 'alice', 'password12345');
		const aliceStorages = await aliceClient.request('/api/storages');
		assert.ok(aliceStorages.payload.some((s) => s.id === 'external'), 'alice should see external when allowlisted');

		await login(bobClient, 'bob', 'password12345');
		const bobStorages = await bobClient.request('/api/storages');
		assert.ok(!bobStorages.payload.some((s) => s.id === 'external'), 'bob should not see external when not allowlisted');
		assert.notEqual(aliceId, bobId);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('user documents isolation: users cannot access each other files', async () => {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const userAClient = createClient(instance.baseUrl);
	const userBClient = createClient(instance.baseUrl);

	try {
		await setupInitialAdmin(adminClient, 'admin', 'password12345');
		await login(adminClient, 'admin', 'password12345');

		const userAId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'alice', password: 'password12345' }
		})).payload.user.id;

		const userBId = (await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'bob', password: 'password12345' }
		})).payload.user.id;

		// Alice logs in and creates files
		await login(userAClient, 'alice', 'password12345');
		const aliceFilesResponse = await userAClient.request('/api/files');
		const aliceFiles = aliceFilesResponse.payload?.documents || [];

		// Bob logs in and should not see alice's files
		await login(userBClient, 'bob', 'password12345');
		const bobFilesResponse = await userBClient.request('/api/files');
		const bobFiles = bobFilesResponse.payload?.documents || [];

		// Bob should not see alice's files
		const bobFileIds = bobFiles.map((f) => f.id);
		const aliceFileIds = aliceFiles.map((f) => f.id);
		const overlap = aliceFileIds.filter((id) => bobFileIds.includes(id));
		assert.strictEqual(overlap.length, 0, 'bob should not see alice files');
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('read-only shared storage is marked correctly', async () => {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-readonly-'));
	const documentRoot = path.join(tempRoot, 'storage');
	const stateRoot = path.join(tempRoot, 'state');
	const sharedRoot = path.join(tempRoot, 'shared');
	await fs.mkdir(documentRoot, { recursive: true });
	await fs.mkdir(stateRoot, { recursive: true });
	await fs.mkdir(sharedRoot, { recursive: true });

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
	const collaboraAddress = collaboraServer.address();

	process.env.DOCUMENT_ROOT = documentRoot;
	process.env.WOPI_STATE_ROOT = stateRoot;
	process.env.SESSION_SECRET = 'test-session-secret';
	process.env.ACCESS_TOKEN_SECRET = 'test-access-token-secret';
	process.env.COLLABORA_INTERNAL_URL = `http://127.0.0.1:${collaboraAddress.port}`;
	process.env.COLLABORA_PUBLIC_URL = `http://127.0.0.1:${collaboraAddress.port}`;
	process.env.SHARED_STORAGE_MODE = 'readonly';
	process.env.SHARED_STORAGE_ROOT = sharedRoot;
	clearRepositoryModules();
	const app = require('../app');
	const server = app.listen(0);
	await new Promise((resolve) => server.once('listening', resolve));
	const address = server.address();
	const baseUrl = `http://127.0.0.1:${address.port}`;

	const adminClient = createClient(baseUrl);
	const userClient = createClient(baseUrl);

	try {
		await setupInitialAdmin(adminClient, 'admin', 'password12345');
		await login(adminClient, 'admin', 'password12345');

		await adminClient.request('/api/admin/users', {
			method: 'POST',
			body: { username: 'user', password: 'password12345' }
		});

		await login(userClient, 'user', 'password12345');

		// User should see shared storage as read-only
		const storages = await userClient.request('/api/storages');
		const sharedStorage = storages.payload.find((s) => s.id === 'shared');
		assert.ok(sharedStorage, 'user should see read-only shared storage');
		assert.strictEqual(sharedStorage.readOnly, true);
	} finally {
		delete process.env.SHARED_STORAGE_MODE;
		delete process.env.SHARED_STORAGE_ROOT;
		server.close();
		collaboraServer.close();
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});
