const ACTIVITY_LABELS = {
	open: 'Opened',
	view: 'Viewed',
	edit: 'Edited',
	create: 'Created',
	recycle: 'Moved to recycle bin',
	restore: 'Restored',
	share: 'Shared',
	move: 'Moved',
	copy: 'Copied',
	rename: 'Renamed',
	download: 'Downloaded',
	upload: 'Uploaded',
	'restore-version': 'Restored version',
	'delete-version': 'Deleted version',
	delete: 'Deleted'
};

export function getActivityLabel(type) {
	return ACTIVITY_LABELS[type] || type;
}
