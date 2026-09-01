export function createFileActionsController({
	appState,
	requestJson,
	escapeHtml,
	formatBytes,
	formatDate,
	getDocumentById,
	getBulkSelectedDocuments,
	setStatus,
	loadPage,
	onCloseDetailsPanel,
	onOpenDetailsPanel,
	onOpenFolderTargetDialog,
	onOpenDocument
}) {
	function getCurrentMountId() {
		return appState.currentMountId || null;
	}

	function getMountHeaders() {
		const mountId = getCurrentMountId();
		return mountId ? { 'X-Mount-Id': mountId } : {};
	}

	function isMissingEntry(fileId) {
		const document = getDocumentById(fileId);
		return Boolean(document?.isMissingOnDisk);
	}

	function downloadBlob(blob, downloadName) {
		const objectUrl = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = objectUrl;
		link.download = downloadName;
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.setTimeout(function() {
			URL.revokeObjectURL(objectUrl);
		}, 0);
	}

	async function downloadSelectedDocuments(documents) {
		if (documents.length === 1) {
			window.location.href = `/api/files/${encodeURIComponent(documents[0].id)}/download`;
			return;
		}

		setStatus('Preparing bulk download...');
		const response = await fetch('/api/files/bulk-download', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...getMountHeaders()
			},
			body: JSON.stringify({ fileIds: documents.map((document) => document.id) })
		});
		if (!response.ok) {
			const payload = await response.json().catch(() => null);
			throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
		}

		const blob = await response.blob();
		downloadBlob(blob, 'selected-items.zip');
		setStatus(`Downloaded ${documents.length} selected item${documents.length === 1 ? '' : 's'}.`);
	}

	async function setFavoriteState(fileId, favorite) {
		await requestJson(`/api/files/${encodeURIComponent(fileId)}/favorite`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ favorite: favorite })
		});
	}

	async function addSelectedDocumentsToFavorites(documents) {
		for (const document of documents) {
			await setFavoriteState(document.id, true);
		}
		await loadPage();
		setStatus(`Added ${documents.length} selected item${documents.length === 1 ? '' : 's'} to favorites.`);
	}

	async function toggleFavorite(fileId) {
		if (isMissingEntry(fileId)) {
			setStatus('This entry is currently missing on disk. Only details are available.', true);
			return;
		}
		const file = appState.documents.find((entry) => entry.id === fileId);
		await setFavoriteState(fileId, !file.favorite);
	}

	async function createShare(fileId) {
		if (isMissingEntry(fileId)) {
			setStatus('This entry is currently missing on disk. Only details are available.', true);
			return;
		}
		const permission = window.confirm('Create edit share link? Click Cancel for read-only link.') ? 'read_write' : 'read';
		const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/public-share`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ permission: permission })
		});
		const shareUrl = payload.share?.url || payload.publicShare?.url || payload.url;
		if (!shareUrl) {
			setStatus('Public link created, but URL is missing in response.', true);
			return;
		}
		await navigator.clipboard.writeText(shareUrl);
		window.alert(`Share link copied to clipboard:\n${shareUrl}`);
	}

	async function handleBulkAction(action) {
		const selectedDocuments = getBulkSelectedDocuments();
		if (!selectedDocuments.length) {
			return;
		}

		switch (action) {
			case 'favorite':
				await addSelectedDocumentsToFavorites(selectedDocuments);
				return;
			case 'download':
				await downloadSelectedDocuments(selectedDocuments);
				return;
			default:
				return;
		}
	}

	async function handleFileAction(action, fileId, mode) {
		try {
			if (action !== 'details' && isMissingEntry(fileId)) {
				setStatus('This entry is currently missing on disk. Only details are available.', true);
				return;
			}
			switch (action) {
			case 'open':
				await onOpenDocument(fileId, mode || 'edit');
				return;
			case 'details':
				onOpenDetailsPanel(fileId);
				return;
			case 'download':
				window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
				return;
			case 'favorite':
				await toggleFavorite(fileId);
				break;
			case 'share':
				await createShare(fileId);
				break;
			default:
				return;
			}

			await loadPage();
			setStatus('Action completed.');
		} catch (error) {
			setStatus(error.message, true);
		}
	}

	return {
		saveAsDocument: undefined,
		createShare,
		handleBulkAction,
		handleFileAction
	};
}
