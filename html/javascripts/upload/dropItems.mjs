function readFileSystemEntry(entry, relativePath) {
	if (entry.isFile) {
		return new Promise((resolve, reject) => {
			entry.file((file) => {
				resolve([{
					file: file,
					relativePath: relativePath
				}]);
			}, reject);
		});
	}

	if (!entry.isDirectory) {
		return Promise.resolve([]);
	}

	return readDirectoryEntries(entry).then(async function(entries) {
		let collectedItems = [];
		for (const childEntry of entries) {
			const childPath = relativePath ? `${relativePath}/${childEntry.name}` : childEntry.name;
			collectedItems = collectedItems.concat(await readFileSystemEntry(childEntry, childPath));
		}
		return collectedItems;
	});
}

function readDirectoryEntries(directoryEntry) {
	const reader = directoryEntry.createReader();
	const entries = [];

	return new Promise((resolve, reject) => {
		function readNextBatch() {
			reader.readEntries(function(batch) {
				if (!batch.length) {
					resolve(entries);
					return;
				}
				entries.push(...batch);
				readNextBatch();
			}, reject);
		}

		readNextBatch();
	});
}

export async function collectDroppedUploadItems(dataTransfer) {
	if (dataTransfer.items && dataTransfer.items.length > 0) {
		const fileItems = Array.from(dataTransfer.items).filter((item) => item.kind === 'file');
		const entries = fileItems
			.map((item) => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)
			.filter(Boolean);
		if (entries.length > 0) {
			let collectedItems = [];
			for (const entry of entries) {
				collectedItems = collectedItems.concat(await readFileSystemEntry(entry, entry.name));
			}
			return collectedItems;
		}
	}

	return Array.from(dataTransfer.files || []).map((file) => ({
		file: file,
		relativePath: file.webkitRelativePath || file.name
	}));
}
