export function getParentPath(relativePath) {
	const segments = String(relativePath || '').split('/').filter(Boolean);
	if (segments.length <= 1) {
		return '';
	}

	segments.pop();
	return segments.join('/');
}

function compareDocuments(left, right) {
	if (left.isDirectory !== right.isDirectory) {
		return left.isDirectory ? -1 : 1;
	}

	return left.name.localeCompare(right.name);
}

export function buildDocumentTree(documents) {
	const buckets = new Map();
	for (const document of documents.slice().sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
		const parentPath = getParentPath(document.relativePath);
		if (!buckets.has(parentPath)) {
			buckets.set(parentPath, []);
		}
		buckets.get(parentPath).push(document);
	}

	for (const bucket of buckets.values()) {
		bucket.sort(compareDocuments);
	}

	return buckets;
}

export function getVisibleTreeEntries(documents, expandedFolderIds) {
	const buckets = buildDocumentTree(documents);
	const visibleEntries = [];

	function walk(parentPath, depth) {
		const children = buckets.get(parentPath) || [];
		for (const child of children) {
			visibleEntries.push({ document: child, depth: depth });
			if (child.isDirectory && expandedFolderIds.has(child.id)) {
				walk(child.relativePath, depth + 1);
			}
		}
	}

	walk('', 0);
	return visibleEntries;
}
