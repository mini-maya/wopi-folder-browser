#!/usr/bin/env node
'use strict';

const config = require('../lib/config');
const { createInitialAdmin } = require('../lib/initialAdminSetup');

function parseArguments(argv) {
	const values = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith('--')) {
			continue;
		}
		const key = token.slice(2);
		const next = argv[index + 1];
		if (!next || next.startsWith('--')) {
			values[key] = 'true';
			continue;
		}
		values[key] = next;
		index += 1;
	}
	return values;
}

async function main() {
	const args = parseArguments(process.argv.slice(2));
	const username = args.username || process.env.INITIAL_ADMIN_USERNAME;
	const password = args.password || process.env.INITIAL_ADMIN_PASSWORD;

	if (!username || !password) {
		console.error('Usage: npm run setup:admin -- --username <name> --password <password>');
		console.error('Or set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD.');
		process.exit(1);
		return;
	}

	try {
		const user = await createInitialAdmin(config, { username, password });
		console.log(`Initial admin created: ${user.username} (${user.id})`);
		process.exit(0);
	} catch (error) {
		console.error(error.message || String(error));
		process.exit(1);
	}
}

main();
