export function createDocumentListController({
	elements,
	appState,
	searchInput,
	isFolderEntry,
	getDocumentById,
	getFolderSelectionState,
	getVisibleTreeEntries,
	buildFolderPictogramSvg,
	buildFilePreviewSvg,
	folderContainsFiles,
	escapeHtml,
	formatDate,
	formatBytes,
	onCloseOpenContextMenu,
	onShowContextMenu,
	onHandleFileAction,
	onHandleRecycleAction
}) {
	function filterNestedDocuments(documents) {
		const folders = documents
			.filter((document) => isFolderEntry(document))
			.sort((left, right) => left.relativePath.length - right.relativePath.length);
		return documents.filter((document) => !folders.some((folder) => folder.id !== document.id && document.relativePath.startsWith(`${folder.relativePath}/`)));
	}

	function getBulkSelectedDocuments() {
		const selectedDocuments = Array.from(appState.selectedFileIds)
			.map((fileId) => getDocumentById(fileId))
			.filter(Boolean);
		return filterNestedDocuments(selectedDocuments);
	}

	function renderEmptyState(message = 'No supported documents or folders found. Create one with the New... menu.') {
		elements.documentsBody.innerHTML = `
		<tr>
			<td colspan="6">
				<div class="file-meta">${escapeHtml(message)}</div>
			</td>
		</tr>
	`;
		elements.selectAllFiles.checked = false;
		updateBulkActionState([]);
	}

	function renderRecycleRow(entry) {
		const isSelected = appState.selectedFileIds.has(entry.id);
		const previewSrc = buildFilePreviewSvg({ mimeType: entry.mimeType || '' });
		return `
		<tr class="${isSelected ? 'selected-row' : ''} tree-file-row" data-file-id="${entry.id}" data-recycle-entry-id="${entry.id}" data-is-recycle-entry="true">
			<td class="select-cell">
				<input type="checkbox" class="file-select-checkbox" data-file-id="${entry.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${escapeHtml(entry.originalName || 'recycled file')}">
			</td>
			<td class="tree-name-cell">
				<div class="file-row-main tree-row-main">
					<span class="tree-toggle-spacer" aria-hidden="true"></span>
					<img class="file-row-preview" src="${previewSrc}" alt="${escapeHtml(entry.originalName || 'recycled file')} preview">
					<div>
						<div class="file-name">${escapeHtml(entry.originalName || 'Recovered file')}</div>
					</div>
				</div>
			</td>
			<td>${escapeHtml(entry.originalPath || '')}</td>
			<td>${formatDate(entry.deletedAt)}</td>
			<td>${entry.versionSize != null ? formatBytes(entry.versionSize) : '—'}</td>
			<td>
				<div class="actions actions-inline">
					<button type="button" class="secondary menu-button" data-action="context-menu" data-file-id="${entry.id}" aria-label="Open recycle actions">⋯</button>
				</div>
			</td>
		</tr>
	`;
	}

	function updateBulkActionState(documents) {
		const selectedCount = appState.selectedFileIds.size;
		elements.selectionSummary.textContent = `${selectedCount} selected`;
		elements.selectionSummary.classList.toggle('hidden', selectedCount === 0);
		elements.bulkActionsMenuButton.disabled = selectedCount === 0;
		if (selectedCount === 0) {
			onCloseOpenContextMenu();
		}
		if (!documents || documents.length === 0) {
			elements.selectAllFiles.checked = false;
			return;
		}
		const allSelected = documents.every((document) => appState.selectedFileIds.has(document.id));
		elements.selectAllFiles.checked = documents.length > 0 && allSelected;
	}

	function collapseFolderAndDescendants(folderId) {
		const folder = getDocumentById(folderId);
		if (!folder || !folder.isDirectory) {
			return;
		}

		const prefix = `${folder.relativePath}/`;
		for (const document of appState.documents) {
			if (document.isDirectory && document.relativePath.startsWith(prefix)) {
				appState.expandedFolderIds.delete(document.id);
			}
		}
		appState.expandedFolderIds.delete(folderId);
	}

	function toggleFolderExpansion(folderId) {
		const folder = getDocumentById(folderId);
		if (!folder || !folder.isDirectory) {
			return;
		}

		if (appState.expandedFolderIds.has(folderId)) {
			collapseFolderAndDescendants(folderId);
			return;
		}

		appState.expandedFolderIds.add(folderId);
	}

	function getSelectionCascadeIds(fileId) {
		const document = getDocumentById(fileId);
		if (!document) {
			return [fileId];
		}
		if (!document.isDirectory) {
			return [document.id];
		}

		const prefix = `${document.relativePath}/`;
		const cascadeDocumentIds = new Set(
			appState.documents
				.filter((entry) => entry.id === document.id || entry.relativePath.startsWith(prefix))
				.map((entry) => entry.id)
		);
		return Array.from(cascadeDocumentIds);
	}

	function toggleDocumentSelection(fileId, checked) {
		const affectedIds = getSelectionCascadeIds(fileId);
		for (const affectedId of affectedIds) {
			if (checked) {
				appState.selectedFileIds.add(affectedId);
			} else {
				appState.selectedFileIds.delete(affectedId);
			}
		}
		updateBulkActionState(appState.visibleDocuments.length ? appState.visibleDocuments : appState.documents);
		for (const row of elements.documentsBody.querySelectorAll('tr[data-file-id]')) {
			const rowFileId = row.dataset.fileId;
			const isSelected = appState.selectedFileIds.has(rowFileId);
			row.classList.toggle('selected-row', isSelected);
			const checkbox = row.querySelector('.file-select-checkbox');
			if (!checkbox) {
				continue;
			}

			const rowDocument = getDocumentById(rowFileId);
			if (rowDocument && rowDocument.isDirectory) {
				const selectionState = getFolderSelectionState(rowDocument, appState.documents, appState.selectedFileIds);
				checkbox.checked = selectionState.checked;
				checkbox.indeterminate = false;
				continue;
			}

			checkbox.checked = isSelected;
			checkbox.indeterminate = false;
		}
	}

	function renderDocumentRow(document, depth) {
		const isSelected = appState.selectedFileIds.has(document.id);
		const isFolder = isFolderEntry(document);
		const isExpanded = isFolder && appState.expandedFolderIds.has(document.id);
		const previewUrl = isFolder
			? buildFolderPictogramSvg({
				isOpen: isExpanded,
				hasFiles: folderContainsFiles(document, appState.documents),
				isFavorite: Boolean(document.favorite),
				preferFavoriteIcon: false
			})
			: buildFilePreviewSvg(document);
		const toggleLabel = isExpanded ? 'Collapse folder' : 'Expand folder';
		return `
		<tr class="${isSelected ? 'selected-row' : ''} ${isFolder ? 'tree-folder-row' : 'tree-file-row'}" data-file-id="${document.id}" data-tree-depth="${depth}" data-is-folder="${isFolder}">
			<td class="select-cell">
				<input type="checkbox" class="file-select-checkbox" data-file-id="${document.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${escapeHtml(document.name)}">
			</td>
			<td class="tree-name-cell">
				<div class="file-row-main tree-row-main" style="padding-left: ${depth * 2.95}rem">
					${isFolder ? `<button type="button" class="tree-toggle" data-action="toggle-folder" data-file-id="${document.id}" aria-label="${toggleLabel}" aria-expanded="${isExpanded ? 'true' : 'false'}">${isExpanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-spacer" aria-hidden="true"></span>'}
					<img class="file-row-preview ${isFolder ? 'folder-icon' : ''}" src="${previewUrl}" alt="${escapeHtml(document.name)} preview">
					<div>
						<div class="file-name">${escapeHtml(document.name)}</div>
					</div>
				</div>
			</td>
			<td>${escapeHtml(document.relativePath.split('/').filter(Boolean).join(' / '))}</td>
			<td>${formatDate(document.updatedAt)}</td>
			<td>${isFolder ? '—' : formatBytes(document.size)}</td>
			<td>
				<div class="actions actions-inline">
					${isFolder ? '' : '<button type="button" data-action="open" data-mode="edit" data-file-id="'+document.id+'">Open</button><button type="button" class="secondary" data-action="open" data-mode="view" data-file-id="'+document.id+'">View</button>'}
					<button type="button" class="secondary menu-button" data-action="context-menu" data-file-id="${document.id}" aria-label="Open file actions">⋯</button>
				</div>
			</td>
		</tr>
	`;
	}

	function setDocumentListHeaders() {
		if (elements.columnPath) {
			elements.columnPath.textContent = 'Path';
		}
		if (elements.columnDate) {
			elements.columnDate.textContent = 'Modified';
		}
	}

	function setRecycleListHeaders() {
		if (elements.columnPath) {
			elements.columnPath.textContent = 'Original Path';
		}
		if (elements.columnDate) {
			elements.columnDate.textContent = 'Deleted';
		}
	}

	function getBulkSelectedRecycleEntries() {
		return (appState.recycleEntries || []).filter((entry) => appState.selectedFileIds.has(entry.id));
	}

	function renderFlatDocuments(documents) {
		if (documents.length === 0) {
			renderEmptyState('No matching documents or folders found.');
			return;
		}

		setDocumentListHeaders();
		elements.documentsBody.innerHTML = documents.map((document) => renderDocumentRow(document, 0)).join('');
		wireDocumentRows();
		appState.visibleDocuments = documents;
		updateBulkActionState(documents);
	}

	function renderTreeDocuments(documents) {
		const visibleEntries = getVisibleTreeEntries(documents, appState.expandedFolderIds);
		if (visibleEntries.length === 0) {
			renderEmptyState();
			return;
		}

		setDocumentListHeaders();
		elements.documentsBody.innerHTML = visibleEntries.map(({ document, depth }) => renderDocumentRow(document, depth)).join('');
		wireDocumentRows();
		appState.visibleDocuments = visibleEntries.map(({ document }) => document);
		updateBulkActionState(appState.visibleDocuments);
	}

	function wireDocumentRows() {
		for (const checkbox of elements.documentsBody.querySelectorAll('.file-select-checkbox')) {
			checkbox.addEventListener('change', function(event) {
				event.stopPropagation();
				toggleDocumentSelection(event.target.dataset.fileId, event.target.checked);
			});
		}

		for (const row of elements.documentsBody.querySelectorAll('tr[data-file-id]')) {
			row.addEventListener('click', function(event) {
				if (event.target.closest('button, input, a, select, textarea, label')) {
					return;
				}

				if (appState.currentView === 'recycle') {
					onHandleRecycleAction('details', row.dataset.fileId);
					return;
				}

				const document = getDocumentById(row.dataset.fileId);
				if (document?.isDirectory) {
					toggleFolderExpansion(document.id);
					renderCurrentDocumentList();
				}
			});
		}

		for (const button of elements.documentsBody.querySelectorAll('button[data-action][data-file-id]')) {
			button.addEventListener('click', function(event) {
				event.preventDefault();
				event.stopPropagation();
				if (button.dataset.action === 'context-menu') {
					onShowContextMenu(button.dataset.fileId, button);
					return;
				}
				if (button.dataset.action === 'toggle-folder') {
					toggleFolderExpansion(button.dataset.fileId);
					renderCurrentDocumentList();
					return;
				}
				if (button.dataset.action === 'open') {
					onHandleFileAction('open', button.dataset.fileId, button.dataset.mode);
					return;
				}
				onHandleFileAction(button.dataset.action, button.dataset.fileId, button.dataset.mode);
			});
		}
	}

	function renderRecycleEntries(entries) {
		setRecycleListHeaders();
		if (entries.length === 0) {
			renderEmptyState('No recycled documents found.');
			return;
		}
		elements.documentsBody.innerHTML = entries.map((entry) => renderRecycleRow(entry)).join('');
		wireDocumentRows();
		appState.visibleDocuments = entries;
		updateBulkActionState(entries);
	}

	function renderCurrentDocumentList() {
		if (appState.currentView === 'recycle') {
			renderRecycleEntries(appState.recycleEntries || []);
			return;
		}
		const query = searchInput.value.trim().toLowerCase();
		if (query) {
			const filtered = appState.documents.filter((document) => (
				document.name.toLowerCase().includes(query) ||
				document.relativePath.toLowerCase().includes(query) ||
				String(document.mimeType || '').toLowerCase().includes(query)
			));
			renderFlatDocuments(filtered);
			return;
		}

		renderTreeDocuments(appState.documents);
	}

	return {
		getBulkSelectedDocuments,
		getBulkSelectedRecycleEntries,
		renderEmptyState,
		updateBulkActionState,
		renderCurrentDocumentList
	};
}
