'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { getContextStateRoot } = require('../lib/statePaths');

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
			const headers = { ...(options.headers || {}) };
			if (clientState.cookie) {
				headers.Cookie = clientState.cookie;
			}
			const response = await fetch(`${baseUrl}${endpoint}`, {
				method: method,
				headers: headers,
				body: options.body
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

async function startIsolatedServer(options = {}) {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-auth-flow-'));
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

test('setup, authentication, authorization and storage isolation flow', async function() {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const userAClient = createClient(instance.baseUrl);
	const userBClient = createClient(instance.baseUrl);
	const anonymousClient = createClient(instance.baseUrl);

	try {
		let requestResult = await anonymousClient.request('/api/auth/setup-initial-admin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 201);
		assert.equal(requestResult.payload.user.role, 'admin');

		requestResult = await anonymousClient.request('/api/auth/setup-initial-admin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin2', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 409);

		requestResult = await adminClient.request('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 200);

		requestResult = await adminClient.request('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'alice', role: 'user', password: 'AlicePassword123', generatePassword: false })
		});
		assert.equal(requestResult.response.status, 201);
		const userAId = requestResult.payload.user.id;

		requestResult = await adminClient.request('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'too-short', role: 'user', password: 'shortpwd', generatePassword: false })
		});
		assert.equal(requestResult.response.status, 400);
		assert.match(String(requestResult.payload.error || ''), /at least 12 characters/);

		requestResult = await adminClient.request('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'bob', role: 'user', password: 'BobPassword12345', generatePassword: false })
		});
		assert.equal(requestResult.response.status, 201);
		const userBId = requestResult.payload.user.id;

		requestResult = await userAClient.request('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'alice', password: 'AlicePassword123' })
		});
		assert.equal(requestResult.response.status, 200);

		requestResult = await userAClient.request('/api/files', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'text', fileName: 'alice-private' })
		});
		assert.equal(requestResult.response.status, 201);
		const aliceFileId = requestResult.payload.file.id;

		requestResult = await userBClient.request('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'bob', password: 'BobPassword12345' })
		});
		assert.equal(requestResult.response.status, 200);

		requestResult = await userBClient.request(`/api/files/${encodeURIComponent(aliceFileId)}`);
		assert.equal(requestResult.response.status, 404);

		requestResult = await userBClient.request('/api/admin/users');
		assert.equal(requestResult.response.status, 403);

		requestResult = await anonymousClient.request('/api/files');
		assert.equal(requestResult.response.status, 401);

		requestResult = await userAClient.request('/api/files');
		assert.equal(requestResult.response.status, 200);

		requestResult = await userAClient.request('/api/auth/logout', { method: 'POST' });
		assert.equal(requestResult.response.status, 204);

		requestResult = await userAClient.request('/api/auth/me');
		assert.equal(requestResult.response.status, 200);
		assert.equal(requestResult.payload.authenticated, false);

		requestResult = await adminClient.request(`/api/admin/users/${encodeURIComponent(userBId)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ active: false })
		});
		assert.equal(requestResult.response.status, 200);

		const disabledUserClient = createClient(instance.baseUrl);
		requestResult = await disabledUserClient.request('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'bob', password: 'BobPassword12345' })
		});
		assert.equal(requestResult.response.status, 401);

		requestResult = await adminClient.request(`/api/admin/users/${encodeURIComponent(userAId)}/reset-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ generatePassword: true })
		});
		assert.equal(requestResult.response.status, 200);
		assert.ok(typeof requestResult.payload.generatedPassword === 'string');
	} finally {
		await new Promise((resolve, reject) => instance.server.close((error) => (error ? reject(error) : resolve())));
		await new Promise((resolve, reject) => instance.collaboraServer.close((error) => (error ? reject(error) : resolve())));
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});

test('config endpoint exposes the app version', async function() {
	const instance = await startIsolatedServer();

	try {
		const client = createClient(instance.baseUrl);
		const requestResult = await client.request('/api/config');
		assert.equal(requestResult.response.status, 200);
		assert.equal(requestResult.payload.appVersion, require('../package.json').version);
	} finally {
		await new Promise((resolve, reject) => instance.server.close((error) => (error ? reject(error) : resolve())));
		await new Promise((resolve, reject) => instance.collaboraServer.close((error) => (error ? reject(error) : resolve())));
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});

test('prune-missing endpoint cleans only missing entries in current context', async function() {
	const instance = await startIsolatedServer();
	const client = createClient(instance.baseUrl);

	try {
		let requestResult = await client.request('/api/auth/setup-initial-admin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 201);

		requestResult = await client.request('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 200);
		const adminUserId = requestResult.payload.user.id;
		const userDocumentsRoot = path.join(instance.tempRoot, 'storage', 'users', adminUserId);
		await fs.mkdir(userDocumentsRoot, { recursive: true });
		await fs.writeFile(path.join(userDocumentsRoot, 'present.odt'), 'present');
		const contextStateRoot = getContextStateRoot(userDocumentsRoot);
		await fs.mkdir(contextStateRoot, { recursive: true });
		await fs.writeFile(path.join(contextStateRoot, 'file-registry.json'), JSON.stringify({
			entries: {
				'present-id': 'present.odt',
				'missing-id': 'missing-folder/missing.odt'
			}
		}, null, 2), 'utf8');

		requestResult = await client.request('/api/files/prune-missing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});
		assert.equal(requestResult.response.status, 200);
		assert.equal(requestResult.payload.ok, true);
		assert.equal(requestResult.payload.removed, true);
		assert.equal(requestResult.payload.missingEntryCount, 1);
		assert.deepEqual(requestResult.payload.removedFileIds, ['missing-id']);

		const registry = JSON.parse(await fs.readFile(path.join(contextStateRoot, 'file-registry.json'), 'utf8'));
		assert.deepEqual(registry.entries, { 'present-id': 'present.odt' });
	} finally {
		await new Promise((resolve, reject) => instance.server.close((error) => (error ? reject(error) : resolve())));
		await new Promise((resolve, reject) => instance.collaboraServer.close((error) => (error ? reject(error) : resolve())));
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});

test('launch activities distinguish open from view', async function() {
	const instance = await startIsolatedServer();
	const client = createClient(instance.baseUrl);

	try {
		let requestResult = await client.request('/api/auth/setup-initial-admin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 201);

		requestResult = await client.request('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 200);
		const adminUserId = requestResult.payload.user.id;
		const userDocumentsRoot = path.join(instance.tempRoot, 'storage', 'users', adminUserId);
		await fs.mkdir(userDocumentsRoot, { recursive: true });
		await fs.writeFile(path.join(userDocumentsRoot, 'launch-activity-demo.odt'), 'demo');
		requestResult = await client.request('/api/files');
		assert.equal(requestResult.response.status, 200);
		const fileEntry = (Array.isArray(requestResult.payload.documents) ? requestResult.payload.documents : [])
			.find((document) => document.relativePath === 'launch-activity-demo.odt');
		assert.ok(fileEntry);

		requestResult = await client.request(`/api/files/${encodeURIComponent(fileEntry.id)}/launch?mode=view`);
		assert.equal(requestResult.response.status, 200);

		requestResult = await client.request(`/api/files/${encodeURIComponent(fileEntry.id)}/launch?mode=edit`);
		assert.equal(requestResult.response.status, 200);

		requestResult = await client.request('/api/activities?limit=20');
		assert.equal(requestResult.response.status, 200);

		const launchActivities = (Array.isArray(requestResult.payload.activities) ? requestResult.payload.activities : [])
			.filter((activityEntry) => activityEntry.fileId === fileEntry.id && (activityEntry.type === 'open' || activityEntry.type === 'view'));
		assert.deepEqual(launchActivities.map((activityEntry) => activityEntry.type), ['open', 'view']);
		assert.deepEqual(launchActivities.map((activityEntry) => activityEntry.mode), ['edit', 'view']);
	} finally {
		await new Promise((resolve, reject) => instance.server.close((error) => (error ? reject(error) : resolve())));
		await new Promise((resolve, reject) => instance.collaboraServer.close((error) => (error ? reject(error) : resolve())));
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});

test('activity labels include a read-only view state', async function() {
	const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'html', 'javascripts', 'documents', 'activityLabels.mjs')).href;
	const { getActivityLabel } = await import(moduleUrl);

	assert.equal(getActivityLabel('open'), 'Opened');
	assert.equal(getActivityLabel('view'), 'Viewed');
	assert.equal(getActivityLabel('recycle'), 'Moved to recycle bin');
	assert.equal(getActivityLabel('restore'), 'Restored');
	assert.equal(getActivityLabel('delete'), 'Deleted');
	assert.equal(getActivityLabel('unknown-type'), 'unknown-type');
});

test('recycle flows record recycle, restore and final delete activities', async function() {
	const instance = await startIsolatedServer();
	const client = createClient(instance.baseUrl);

	try {
		let requestResult = await client.request('/api/auth/setup-initial-admin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 201);

		requestResult = await client.request('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'AdminPassword123' })
		});
		assert.equal(requestResult.response.status, 200);
		const adminUserId = requestResult.payload.user.id;
		const userDocumentsRoot = path.join(instance.tempRoot, 'storage', 'users', adminUserId);
		await fs.mkdir(userDocumentsRoot, { recursive: true });
		await fs.writeFile(path.join(userDocumentsRoot, 'recycle-activity-demo.odt'), 'demo');
		requestResult = await client.request('/api/files');
		assert.equal(requestResult.response.status, 200);
		const originalFile = (Array.isArray(requestResult.payload.documents) ? requestResult.payload.documents : [])
			.find((document) => document.relativePath === 'recycle-activity-demo.odt');
		assert.ok(originalFile);

		requestResult = await client.request(`/api/files/${encodeURIComponent(originalFile.id)}`, { method: 'DELETE' });
		assert.equal(requestResult.response.status, 204);

		requestResult = await client.request('/api/recycle');
		assert.equal(requestResult.response.status, 200);
		let recycledEntry = (Array.isArray(requestResult.payload.entries) ? requestResult.payload.entries : [])
			.find((entry) => entry.fileId === originalFile.id);
		assert.ok(recycledEntry);

		requestResult = await client.request(`/api/recycle/${encodeURIComponent(recycledEntry.id)}/restore`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});
		assert.equal(requestResult.response.status, 200);

		requestResult = await client.request(`/api/files/${encodeURIComponent(originalFile.id)}`, { method: 'DELETE' });
		assert.equal(requestResult.response.status, 204);

		requestResult = await client.request('/api/recycle');
		assert.equal(requestResult.response.status, 200);
		recycledEntry = (Array.isArray(requestResult.payload.entries) ? requestResult.payload.entries : [])
			.find((entry) => entry.fileId === originalFile.id);
		assert.ok(recycledEntry);

		requestResult = await client.request(`/api/recycle/${encodeURIComponent(recycledEntry.id)}`, { method: 'DELETE' });
		assert.equal(requestResult.response.status, 204);

		requestResult = await client.request('/api/activities?limit=20');
		assert.equal(requestResult.response.status, 200);
		const recycleActivities = (Array.isArray(requestResult.payload.activities) ? requestResult.payload.activities : [])
			.filter((activityEntry) => activityEntry.fileId === originalFile.id && ['recycle', 'restore', 'delete'].includes(activityEntry.type));
		assert.deepEqual(recycleActivities.map((activityEntry) => activityEntry.type), []);
	} finally {
		await new Promise((resolve, reject) => instance.server.close((error) => (error ? reject(error) : resolve())));
		await new Promise((resolve, reject) => instance.collaboraServer.close((error) => (error ? reject(error) : resolve())));
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});
