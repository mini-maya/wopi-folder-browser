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

async function startIsolatedServer() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-public-share-routes-'));
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
		collaboraServer
	};
}

async function setupAdminAndLogin(client) {
	let response = await client.request('/api/auth/setup-initial-admin', {
		method: 'POST',
		body: { username: 'admin', password: 'AdminPassword123' }
	});
	assert.equal(response.status, 201);

	response = await client.request('/api/auth/login', {
		method: 'POST',
		body: { username: 'admin', password: 'AdminPassword123' }
	});
	assert.equal(response.status, 200);
}

test('public share routes support create/list/launch and enforce password + maxAccessCount', async function() {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);
	const anonymousClient = createClient(instance.baseUrl);

	try {
		await setupAdminAndLogin(adminClient);

		let response = await adminClient.request('/api/files', {
			method: 'POST',
			body: { type: 'text', fileName: 'shared-public-doc' }
		});
		assert.equal(response.status, 201);
		const fileId = response.payload.file.id;

		response = await adminClient.request(`/api/files/${encodeURIComponent(fileId)}/public-share`, {
			method: 'POST',
			body: {
				permission: 'read',
				password: 'PublicPass123!',
				maxAccessCount: 1,
				note: 'test link'
			}
		});
		assert.equal(response.status, 201);
		const shareId = response.payload.id;
		const shareToken = response.payload.token;
		assert.ok(shareToken);

		response = await adminClient.request(`/api/files/${encodeURIComponent(fileId)}/public-shares`);
		assert.equal(response.status, 200);
		assert.equal(Array.isArray(response.payload.shares), true);
		assert.equal(response.payload.shares.length, 1);
		assert.equal(response.payload.shares[0].id, shareId);

		response = await anonymousClient.request(`/api/shares/${encodeURIComponent(shareToken)}/launch`);
		assert.equal(response.status, 401);
		assert.equal(response.payload.error, 'SHARE_PASSWORD_REQUIRED');

		response = await anonymousClient.request(`/api/shares/${encodeURIComponent(shareToken)}/launch`, {
			headers: { 'X-Share-Password': 'WrongPassword123!' }
		});
		assert.equal(response.status, 401);
		assert.equal(response.payload.error, 'INVALID_SHARE_PASSWORD');

		response = await anonymousClient.request(`/api/shares/${encodeURIComponent(shareToken)}/launch`, {
			headers: { 'X-Share-Password': 'PublicPass123!' }
		});
		assert.equal(response.status, 200);
		assert.equal(typeof response.payload.actionUrl, 'string');
		assert.equal(typeof response.payload.accessToken, 'string');

		response = await anonymousClient.request(`/api/shares/${encodeURIComponent(shareToken)}/launch`, {
			headers: { 'X-Share-Password': 'PublicPass123!' }
		});
		assert.equal(response.status, 403);
		assert.match(String(response.payload.message || ''), /access limit/i);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('public share routes support update/revoke/delete for managed links', async function() {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);

	try {
		await setupAdminAndLogin(adminClient);

		let response = await adminClient.request('/api/files', {
			method: 'POST',
			body: { type: 'text', fileName: 'managed-public-doc' }
		});
		assert.equal(response.status, 201);
		const fileId = response.payload.file.id;

		response = await adminClient.request(`/api/files/${encodeURIComponent(fileId)}/public-share`, {
			method: 'POST',
			body: {
				permission: 'read',
				note: 'initial'
			}
		});
		assert.equal(response.status, 201);
		const shareId = response.payload.id;

		response = await adminClient.request(`/api/public-shares/${encodeURIComponent(shareId)}`, {
			method: 'PATCH',
			body: {
				permission: 'read_write',
				downloadEnabled: false,
				maxAccessCount: 5,
				note: 'updated note'
			}
		});
		assert.equal(response.status, 200);
		assert.equal(response.payload.id, shareId);
		assert.equal(response.payload.permission, 'read_write');
		assert.equal(response.payload.downloadEnabled, false);
		assert.equal(response.payload.maxAccessCount, 5);
		assert.equal(response.payload.note, 'updated note');
		assert.equal(response.payload.status, 'active');

		response = await adminClient.request(`/api/public-shares/${encodeURIComponent(shareId)}`, {
			method: 'PATCH',
			body: { status: 'revoked' }
		});
		assert.equal(response.status, 200);
		assert.equal(response.payload.status, 'revoked');

		response = await adminClient.request(`/api/files/${encodeURIComponent(fileId)}/public-shares`);
		assert.equal(response.status, 200);
		assert.equal(response.payload.shares.length, 1);
		assert.equal(response.payload.shares[0].id, shareId);
		assert.equal(response.payload.shares[0].status, 'revoked');

		response = await adminClient.request(`/api/public-shares/${encodeURIComponent(shareId)}`, {
			method: 'DELETE'
		});
		assert.equal(response.status, 204);

		response = await adminClient.request(`/api/files/${encodeURIComponent(fileId)}/public-shares`);
		assert.equal(response.status, 200);
		assert.equal(response.payload.shares.length, 0);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});
