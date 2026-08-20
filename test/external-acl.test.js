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
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-acl-'));
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
	const response = await client.request('/api/auth/setup-initial-admin', {
		method: 'POST',
		body: { username, password }
	});
	return response;
}

async function login(client, username, password) {
	const response = await client.request('/api/auth/login', {
		method: 'POST',
		body: { username, password }
	});
	return response;
}

test('external ACL GET returns empty list when no ACL is set', async () => {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);

	try {
		await setupInitialAdmin(adminClient);
		await login(adminClient, 'admin', 'password12345');

		const response = await adminClient.request('/api/admin/external-acl');
		assert.strictEqual(response.status, 200);
		assert.deepStrictEqual(response.payload.allowedUserIds, []);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('external ACL POST updates the allowed users list', async () => {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);

	try {
		await setupInitialAdmin(adminClient);
		await login(adminClient, 'admin', 'password12345');

		const postResponse = await adminClient.request('/api/admin/external-acl', {
			method: 'POST',
			body: { allowedUserIds: ['user1', 'user2'] }
		});

		assert.strictEqual(postResponse.status, 200);
		assert.deepStrictEqual(postResponse.payload.allowedUserIds, ['user1', 'user2']);

		const getResponse = await adminClient.request('/api/admin/external-acl');
		assert.strictEqual(getResponse.status, 200);
		assert.deepStrictEqual(getResponse.payload.allowedUserIds, ['user1', 'user2']);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('external ACL POST sanitizes and filters empty user ids', async () => {
	const instance = await startIsolatedServer();
	const adminClient = createClient(instance.baseUrl);

	try {
		await setupInitialAdmin(adminClient);
		await login(adminClient, 'admin', 'password12345');

		const response = await adminClient.request('/api/admin/external-acl', {
			method: 'POST',
			body: { allowedUserIds: ['user1', '', '  ', 'user2'] }
		});

		assert.strictEqual(response.status, 200);
		assert.deepStrictEqual(response.payload.allowedUserIds, ['user1', 'user2']);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});

test('external ACL requires admin authentication', async () => {
	const instance = await startIsolatedServer();
	const unauthClient = createClient(instance.baseUrl);

	try {
		const getResponse = await unauthClient.request('/api/admin/external-acl');
		assert.strictEqual(getResponse.status, 401);

		const postResponse = await unauthClient.request('/api/admin/external-acl', {
			method: 'POST',
			body: { allowedUserIds: ['user1'] }
		});
		assert.strictEqual(postResponse.status, 401);
	} finally {
		instance.server.close();
		instance.collaboraServer.close();
	}
});
