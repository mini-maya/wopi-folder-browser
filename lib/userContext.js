'use strict';

function parseCsv(value) {
	return String(value || '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function getRequestUser(req) {
	if (req.auth?.authenticated && req.auth.user) {
		return {
			id: req.auth.user.id,
			displayName: req.auth.user.username,
			groups: []
		};
	}

	const id = 'shared-user';
	const name = 'Shared Folder User';
	const groups = parseCsv(req.get('x-user-groups') || req.query.userGroups || '');
	return {
		id: id,
		displayName: name,
		groups: groups
	};
}

module.exports = {
	getRequestUser: getRequestUser
};
