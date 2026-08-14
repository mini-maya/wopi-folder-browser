'use strict';

function parseCsv(value) {
	return String(value || '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function getRequestUser(req) {
	const id = String(req.get('x-user-id') || req.query.userId || 'shared-user');
	const name = String(req.get('x-user-name') || req.query.userName || 'Shared Folder User');
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
