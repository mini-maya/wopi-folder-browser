'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

function runCli(commandArgs, env) {
	return new Promise((resolve) => {
		const child = spawn('node', commandArgs, {
			cwd: path.join(__dirname, '..'),
			env: env
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.on('close', (code) => {
			resolve({ code, stdout, stderr });
		});
	});
}

test('init-admin CLI creates admin once and blocks second run', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-init-admin-cli-'));
	const documentRoot = path.join(tempRoot, 'documents');
	const stateRoot = path.join(tempRoot, 'state');
	await fs.mkdir(documentRoot, { recursive: true });
	await fs.mkdir(stateRoot, { recursive: true });

	const sharedEnv = {
		...process.env,
		DOCUMENT_ROOT: documentRoot,
		WOPI_STATE_ROOT: stateRoot,
		SESSION_SECRET: 'test-session-secret',
		ACCESS_TOKEN_SECRET: 'test-access-token-secret'
	};

	try {
		const firstRun = await runCli(
			['./bin/init-admin.js', '--username', 'admin', '--password', 'AdminPassword123'],
			sharedEnv
		);
		assert.equal(firstRun.code, 0);
		assert.match(firstRun.stdout, /Initial admin created/);

		const secondRun = await runCli(
			['./bin/init-admin.js', '--username', 'admin2', '--password', 'AdminPassword123'],
			sharedEnv
		);
		assert.equal(secondRun.code, 1);
		assert.match(secondRun.stderr, /already been completed/);
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});
