'use strict';

const fs = require('node:fs/promises');
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

async function startIsolatedServer() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-auth-flow-'));
	const documentRoot = path.join(tempRoot, 'storage');
	const stateRoot = path.join(tempRoot, 'state');
	await fs.mkdir(documentRoot, { recursive: true });
	await fs.mkdir(stateRoot, { recursive: true });

	process.env.DOCUMENT_ROOT = documentRoot;
	process.env.WOPI_STATE_ROOT = stateRoot;
	process.env.SESSION_SECRET = 'test-session-secret';
	process.env.ACCESS_TOKEN_SECRET = 'test-access-token-secret';

	clearRepositoryModules();
	const app = require('../app');
	const server = app.listen(0);
	await new Promise((resolve) => server.once('listening', resolve));
	const address = server.address();
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		server,
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
		assert.equal(requestResult.response.status, 200);

		requestResult = await userAClient.request('/api/auth/storage-context', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ context: 'shared' })
		});
		assert.equal(requestResult.response.status, 200);

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
		await fs.rm(instance.tempRoot, { recursive: true, force: true });
	}
});
