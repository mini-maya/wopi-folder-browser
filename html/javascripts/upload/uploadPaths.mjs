export function normalizeUploadRelativePath(value) {
	return String(value || '')
		.replace(/\\/g, '/')
		.split('/')
		.filter(Boolean)
		.join('/');
}

export function buildUploadDestinationPath(relativePath, targetDirectory) {
	const normalizedRelativePath = normalizeUploadRelativePath(relativePath);
	const normalizedTargetDirectory = normalizeUploadRelativePath(targetDirectory);
	if (!normalizedTargetDirectory) {
		return normalizedRelativePath;
	}
	if (!normalizedRelativePath) {
		return normalizedTargetDirectory;
	}
	return `${normalizedTargetDirectory}/${normalizedRelativePath}`;
}

export function getUploadSummaryLabel(count) {
	return count === 0
		? 'No files selected yet.'
		: `${count} file${count === 1 ? '' : 's'} ready to upload.`;
}
