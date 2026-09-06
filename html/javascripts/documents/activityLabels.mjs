const ACTIVITY_LABELS = {
	open: 'Opened',
	view: 'Viewed',
	edit: 'Edited',
	create: 'Created',
	upload: 'Uploaded',
	'restore-version': 'Restored version',
	'delete-version': 'Deleted version'
};

export function getActivityLabel(type) {
	return ACTIVITY_LABELS[type] || type;
}
