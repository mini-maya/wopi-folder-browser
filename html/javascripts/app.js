import { getFolderSelectionState, getFolderSizeBytes, getVisibleTreeEntries } from './fileBrowserTree.mjs';

const elements = {
	documentRoot: document.querySelector('#document-root'),
	appBaseUrl: document.querySelector('#app-base-url'),
	collaboraUrl: document.querySelector('#collabora-url'),
	statusMessage: document.querySelector('#status-message'),
	documentsBody: document.querySelector('#documents-body'),
	viewerTitle: document.querySelector('#viewer-title'),
	viewerSubtitle: document.querySelector('#viewer-subtitle'),
	closeViewerButton: document.querySelector('#close-viewer-button'),
	closeDetailsPanelButton: document.querySelector('#close-details-panel-button'),
	detailsPanel: document.querySelector('#details-panel'),
	detailsPanelContent: document.querySelector('#details-panel-content'),
	selectAllFiles: document.querySelector('#select-all-files'),
	bulkActions: document.querySelector('#bulk-actions'),
	selectionSummary: document.querySelector('#selection-summary'),
	bulkActionsMenuButton: document.querySelector('#bulk-menu-button'),
	viewerFrame: document.querySelector('#collabora-online-viewer'),
	refreshButton: document.querySelector('#refresh-button'),
	newMenuButton: document.querySelector('#new-menu-button'),
	themeSelect: document.querySelector('#theme-select'),
	searchInput: document.querySelector('#search-input'),
	collaboraForm: document.querySelector('#collabora-submit-form'),
	accessToken: document.querySelector('#access-token'),
	accessTokenTtl: document.querySelector('#access-token-ttl'),
	folderPickerModal: document.querySelector('#folder-picker-modal'),
	folderPickerCancel: document.querySelector('#folder-picker-cancel'),
	folderPickerForm: document.querySelector('#folder-picker-form'),
	folderPickerTarget: document.querySelector('#folder-picker-target'),
	folderPickerName: document.querySelector('#folder-picker-name'),
	folderPickerTitle: document.querySelector('#folder-picker-title'),
	folderPickerConfirm: document.querySelector('#folder-picker-confirm')
};

const appState = {
	documents: [],
	visibleDocuments: [],
	config: null,
	themeMode: 'auto',
	selectedFileIds: new Set(),
	expandedFolderIds: new Set(),
	folderPickerAction: null,
	folderPickerSelectionIds: [],
	folderPickerBulkMode: false,
	contextMenuFileId: null,
	bulkActionsMenuOpen: false,
	newDocumentMenuOpen: false
};

const DEFAULT_VIEWER_TITLE = 'No document opened yet';
const DEFAULT_VIEWER_SUBTITLE = 'Choose a file from the list to open it in Collabora.';
const THEME_STORAGE_KEY = 'wopi-folder-browser-theme';
const THEME_MODES = new Set(['auto', 'light', 'dark']);
const systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function isFolderEntry(document) {
	return Boolean(document?.isDirectory);
}

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

function setStatus(message, isError = false) {
	elements.statusMessage.textContent = message;
	elements.statusMessage.classList.toggle('error', isError);
}

function getStoredThemeMode() {
	const storedMode = localStorage.getItem(THEME_STORAGE_KEY);
	if (storedMode && THEME_MODES.has(storedMode)) {
		return storedMode;
	}

	return 'auto';
}

function resolveTheme(mode) {
	if (mode === 'dark') {
		return 'dark';
	}
	if (mode === 'light') {
		return 'light';
	}

	return systemThemeMediaQuery.matches ? 'dark' : 'light';
}

function applyThemeMode(mode, persistPreference) {
	const normalizedMode = THEME_MODES.has(mode) ? mode : 'auto';
	const resolvedTheme = resolveTheme(normalizedMode);
	appState.themeMode = normalizedMode;
	document.body.dataset.theme = resolvedTheme;
	elements.themeSelect.value = normalizedMode;
	if (persistPreference) {
		localStorage.setItem(THEME_STORAGE_KEY, normalizedMode);
	}
}

function initializeTheme() {
	applyThemeMode(getStoredThemeMode(), false);
	systemThemeMediaQuery.addEventListener('change', function() {
		if (appState.themeMode === 'auto') {
			applyThemeMode('auto', false);
		}
	});
}

function formatBytes(bytes) {
	if (bytes === 0) {
		return '0 B';
	}

	const units = ['B', 'KB', 'MB', 'GB'];
	const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / Math.pow(1024, unitIndex);
	return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(isoDate) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(isoDate));
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

function updateBulkActionState(documents) {
	const selectedCount = appState.selectedFileIds.size;
	elements.selectionSummary.textContent = `${selectedCount} selected`;
	elements.selectionSummary.classList.toggle('hidden', selectedCount === 0);
	elements.bulkActionsMenuButton.disabled = selectedCount === 0;
	if (selectedCount === 0) {
		closeOpenContextMenu();
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

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function folderContainsFiles(folderDocument) {
	if (!folderDocument || !folderDocument.isDirectory) {
		return false;
	}
	const prefix = `${folderDocument.relativePath}/`;
	for (const document of appState.documents) {
		if (!document.isDirectory && document.relativePath.startsWith(prefix)) {
			return true;
		}
	}
	return false;
}

function buildFolderPictogramSvg(options) {
	const { isOpen, hasFiles, isFavorite, preferFavoriteIcon } = options;
	const openFolderWithoutFilesSvg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" xml:space="preserve">
			<g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
				<path d="M 73.538 35.162 l -52.548 1.952 c -1.739 0 -2.753 0.651 -3.232 2.323 L 6.85 76.754 c -0.451 1.586 -2.613 2.328 -4.117 2.328 h 0 C 1.23 79.082 0 77.852 0 76.349 l 0 -10.458 V 23.046 v -2.047 v -6.273 c 0 -2.103 1.705 -3.808 3.808 -3.808 h 27.056 c 1.01 0 1.978 0.401 2.692 1.115 l 7.85 7.85 c 0.714 0.714 1.683 1.115 2.692 1.115 H 69.73 c 2.103 0 3.808 1.705 3.808 3.808 v 1.301 C 73.538 26.106 73.538 35.162 73.538 35.162 z" fill="rgb(224,173,49)"/>
				<path d="M 2.733 79.082 L 2.733 79.082 c 1.503 0 2.282 -1.147 2.733 -2.733 l 10.996 -38.362 c 0.479 -1.672 2.008 -2.824 3.748 -2.824 h 67.379 c 1.609 0 2.765 1.546 2.311 3.09 L 79.004 75.279 c -0.492 1.751 -1.571 3.818 -3.803 3.803 C 75.201 79.082 2.733 79.082 2.733 79.082 z" fill="rgb(255,200,67)"/>
			</g>
		</svg>
	`;
	const openFolderWithFilesSvg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" xml:space="preserve">
			<g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
				<path d="M 73.538 35.162 l -52.548 1.952 c -1.739 0 -2.753 0.651 -3.232 2.323 L 6.85 76.754 c -0.451 1.586 -2.613 2.328 -4.117 2.328 h 0 C 1.23 79.082 0 77.852 0 76.349 l 0 -10.458 V 23.046 v -2.047 v -6.273 c 0 -2.103 1.705 -3.808 3.808 -3.808 h 27.056 c 1.01 0 1.978 0.401 2.692 1.115 l 7.85 7.85 c 0.714 0.714 1.683 1.115 2.692 1.115 H 69.73 c 2.103 0 3.808 1.705 3.808 3.808 v 1.301 L 73.538 35.162 z" fill="rgb(224,173,49)"/>
				<path d="M 63.726 14.605 v 54.54 c 0 1.386 -1.124 2.51 -2.51 2.51 H 13.02 c -1.386 0 -2.51 -1.124 -2.51 -2.51 V 2.51 c 0 -1.386 1.124 -2.51 2.51 -2.51 H 49.12 C 51.554 6.059 56.533 10.874 63.726 14.605 z" fill="rgb(233,233,224)"/>
				<path d="M 63.726 14.605 H 51.407 c -1.263 0 -2.287 -1.024 -2.287 -2.287 V 0 L 63.726 14.605 z" fill="rgb(217,215,202)"/>
				<path d="M 52.978 23.363 H 20.139 c -0.829 0 -1.5 -0.671 -1.5 -1.5 s 0.671 -1.5 1.5 -1.5 h 32.839 c 0.828 0 1.5 0.671 1.5 1.5 S 53.806 23.363 52.978 23.363 z" fill="rgb(217,215,202)"/>
				<path d="M 52.978 30.363 H 20.139 c -0.829 0 -1.5 -0.671 -1.5 -1.5 s 0.671 -1.5 1.5 -1.5 h 32.839 c 0.828 0 1.5 0.671 1.5 1.5 S 53.806 30.363 52.978 30.363 z" fill="rgb(217,215,202)"/>
				<path d="M 2.733 79.082 L 2.733 79.082 c 1.503 0 2.282 -1.147 2.733 -2.733 l 10.996 -38.362 c 0.479 -1.672 2.008 -2.824 3.748 -2.824 h 67.379 c 1.609 0 2.765 1.546 2.311 3.09 L 79.004 75.279 c -0.492 1.751 -1.571 3.818 -3.803 3.803 H 2.733 z" fill="rgb(255,200,67)"/>
			</g>
		</svg>
	`;
	const closedFolderSvg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" xml:space="preserve">
			<g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
				<path d="M 0 68.798 v 11.914 c 0 1.713 1.401 3.114 3.114 3.114 h 0 c 3.344 0 4.805 -2.642 4.805 -2.642 L 8.14 29.281 l 2.739 -2.827 l 72.894 -2.977 v -1.482 c 0 -2.396 -1.942 -4.338 -4.338 -4.338 H 50.236 c -1.15 0 -2.254 -0.457 -3.067 -1.27 l -8.943 -8.943 c -0.813 -0.813 -1.917 -1.27 -3.067 -1.27 H 4.338 C 1.942 6.174 0 8.116 0 10.512 v 7.146 v 2.332 V 68.798" fill="rgb(224,173,49)"/>
				<path d="M 3.114 83.826 L 3.114 83.826 c 1.713 0 3.114 -1.401 3.114 -3.114 V 27.81 c 0 -2.393 1.94 -4.333 4.333 -4.333 h 75.107 c 2.393 0 4.333 1.94 4.333 4.333 v 51.684 c 0 2.393 -1.94 4.333 -4.333 4.333 C 85.667 83.826 3.114 83.826 3.114 83.826 z" fill="rgb(255,200,67)"/>
			</g>
		</svg>
	`;
	const favoriteFolderSvg = `
		<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="256" height="256" viewBox="0 0 256 256" xml:space="preserve">
			<g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
				<path d="M 0 68.798 v 11.914 c 0 1.713 1.401 3.114 3.114 3.114 h 0 c 3.344 0 4.805 -2.642 4.805 -2.642 L 8.14 29.281 l 2.739 -2.827 l 72.894 -2.977 v -1.482 c 0 -2.396 -1.942 -4.338 -4.338 -4.338 H 50.236 c -1.15 0 -2.254 -0.457 -3.067 -1.27 l -8.943 -8.943 c -0.813 -0.813 -1.917 -1.27 -3.067 -1.27 H 4.338 C 1.942 6.174 0 8.116 0 10.512 v 7.146 v 2.332 V 68.798" fill="rgb(224,173,49)"/>
				<path d="M 3.114 83.826 L 3.114 83.826 c 1.713 0 3.114 -1.401 3.114 -3.114 V 27.81 c 0 -2.393 1.94 -4.333 4.333 -4.333 h 75.107 c 2.393 0 4.333 1.94 4.333 4.333 v 51.684 c 0 2.393 -1.94 4.333 -4.333 4.333 C 85.667 83.826 3.114 83.826 3.114 83.826 z" fill="rgb(255,200,67)"/>
				<path d="M 35.679 72.029 c -0.311 0 -0.62 -0.097 -0.882 -0.286 c -0.462 -0.336 -0.693 -0.904 -0.597 -1.468 l 1.997 -11.645 l -8.46 -8.246 c -0.409 -0.398 -0.556 -0.995 -0.38 -1.538 c 0.177 -0.543 0.646 -0.938 1.211 -1.021 l 11.692 -1.699 l 5.229 -10.595 c 0.253 -0.512 0.774 -0.836 1.345 -0.836 l 0 0 c 0.571 0 1.093 0.324 1.345 0.836 l 5.229 10.594 l 11.692 1.699 c 0.564 0.082 1.034 0.478 1.211 1.021 c 0.176 0.543 0.029 1.14 -0.38 1.538 l -8.461 8.246 l 1.998 11.645 c 0.097 0.563 -0.135 1.132 -0.597 1.468 c -0.464 0.336 -1.074 0.38 -1.58 0.114 l -10.457 -5.498 l -10.458 5.498 C 36.158 71.973 35.918 72.029 35.679 72.029 z M 32.008 50.357 l 6.848 6.676 c 0.354 0.345 0.515 0.841 0.432 1.328 l -1.617 9.426 l 8.465 -4.45 c 0.438 -0.229 0.96 -0.229 1.396 0 l 8.465 4.45 l -1.617 -9.426 c -0.083 -0.487 0.078 -0.983 0.432 -1.328 l 6.849 -6.676 l -9.465 -1.375 c -0.488 -0.071 -0.911 -0.378 -1.129 -0.82 l -4.232 -8.577 l -4.233 8.577 c -0.219 0.442 -0.641 0.749 -1.129 0.82 L 32.008 50.357 z" fill="rgb(184,53,53)"/>
			</g>
		</svg>
	`;
	const useFavoriteIcon = Boolean(isFavorite && (preferFavoriteIcon || !isOpen));
	const effectiveHasFiles = isOpen && hasFiles;
	let svg = closedFolderSvg;
	if (useFavoriteIcon) {
		svg = favoriteFolderSvg;
	} else if (isOpen) {
		svg = effectiveHasFiles ? openFolderWithFilesSvg : openFolderWithoutFilesSvg;
	}
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getFileTypeKey(document) {
	if (document.isDirectory) {
		return 'folder';
	}
	const mimeType = document.mimeType || '';
	if (mimeType.includes('spreadsheet')) {
		return 'spreadsheet';
	}
	if (mimeType.includes('presentation')) {
		return 'presentation';
	}
	if (mimeType.includes('text') || mimeType.includes('csv')) {
		return 'text';
	}
	return 'default';
}

function buildFilePreviewSvg(document) {
	const MIME_COLOR_MAP = {
		folder: '#d97706',
		spreadsheet: '#2f9e44',
		text: '#0f62fe',
		presentation: '#f59f00',
		default: '#64748b'
	};
	const typeKey = getFileTypeKey(document);
	const label = document.isDirectory
		? 'FOLDER'
		: (document.name ? document.name.split('.').pop() || 'FILE' : 'FILE').toUpperCase();
	const fill = MIME_COLOR_MAP[typeKey];
	const svg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
			<defs>
				<linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
					<stop offset="0%" stop-color="#f8fafc"/>
					<stop offset="100%" stop-color="#e2e8f0"/>
				</linearGradient>
			</defs>
			<rect width="240" height="160" rx="18" fill="url(#bg)"/>
			<rect x="22" y="20" width="196" height="120" rx="12" fill="${fill}" opacity="0.16"/>
			<path d="M70 34h72l34 34v54c0 7-6 13-13 13H70c-7 0-13-6-13-13V47c0-7 6-13 13-13zm72 0v32h34" fill="none" stroke="${fill}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
			<text x="120" y="95" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${fill}">${escapeHtml(label.substring(0, 4))}</text>
		</svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function renderDocumentRow(document, depth) {
	const isSelected = appState.selectedFileIds.has(document.id);
	const isFolder = isFolderEntry(document);
	const isExpanded = isFolder && appState.expandedFolderIds.has(document.id);
	const previewUrl = isFolder
		? buildFolderPictogramSvg({
			isOpen: isExpanded,
			hasFiles: folderContainsFiles(document),
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
				<div class="file-row-main tree-row-main" style="padding-left: ${depth * 1.25}rem">
					${isFolder ? `<button type="button" class="tree-toggle" data-action="toggle-folder" data-file-id="${document.id}" aria-label="${toggleLabel}" aria-expanded="${isExpanded ? 'true' : 'false'}">${isExpanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-spacer" aria-hidden="true"></span>'}
					<img class="file-row-preview ${isFolder ? 'folder-icon' : ''}" src="${previewUrl}" alt="${escapeHtml(document.name)} preview">
					<div>
						<div class="file-name">${escapeHtml(document.name)}</div>
						<div class="file-meta">${isFolder ? 'Folder' : escapeHtml(document.mimeType)}</div>
						<div class="entry-badge">${isFolder ? 'Folder' : 'File'}</div>
					</div>
				</div>
			</td>
			<td>${escapeHtml(document.relativePath)}</td>
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

function renderFlatDocuments(documents) {
	if (documents.length === 0) {
		renderEmptyState('No matching documents or folders found.');
		return;
	}

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
				showContextMenu(button.dataset.fileId, button);
				return;
			}
			if (button.dataset.action === 'toggle-folder') {
				toggleFolderExpansion(button.dataset.fileId);
				renderCurrentDocumentList();
				return;
			}
			if (button.dataset.action === 'open') {
				handleFileAction('open', button.dataset.fileId, button.dataset.mode);
				return;
			}
			handleFileAction(button.dataset.action, button.dataset.fileId, button.dataset.mode);
		});
	}
}

function renderCurrentDocumentList() {
	const query = elements.searchInput.value.trim().toLowerCase();
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

function getDocumentById(fileId) {
	return appState.documents.find((document) => document.id === fileId) || null;
}

function getPreviewImage(document) {
	if (!document) {
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#e2e8f0"/><text x="120" y="90" text-anchor="middle" font-family="Arial" font-size="36" fill="#475569">FILE</text></svg>');
	}
	if (document.isDirectory) {
		return buildFolderPictogramSvg({
			isOpen: false,
			hasFiles: false,
			isFavorite: Boolean(document.favorite),
			preferFavoriteIcon: true
		});
	}
	return buildFilePreviewSvg(document);
}

function openDetailsPanel(fileId) {
	const document = getDocumentById(fileId);
	if (!document) {
		return;
	}
	elements.detailsPanel.classList.remove('hidden');
	renderDetailsPanel(document);
}

function closeDetailsPanel() {
	elements.detailsPanel.classList.add('hidden');
}

function renderDetailsPanel(document) {
	const isFolder = isFolderEntry(document);
	const folderSizeBytes = isFolder ? getFolderSizeBytes(document, appState.documents) : document.size;
	const previewClass = isFolder ? 'folder-icon' : '';
	const favoriteLabel = document.favorite ? '★ Favorite' : '☆ Favorite';
	const actionButtons = isFolder
		? `
				<button type="button" class="secondary" data-action="details-move" data-file-id="${document.id}">Move</button>
				<button type="button" class="secondary" data-action="details-copy" data-file-id="${document.id}">Copy</button>
				<button type="button" class="secondary" data-action="details-rename" data-file-id="${document.id}">Rename</button>
				<button type="button" class="danger" data-action="details-delete" data-file-id="${document.id}">Delete</button>
			`
		: `
				<button type="button" data-action="details-view" data-file-id="${document.id}">View</button>
				<button type="button" class="secondary" data-action="details-open" data-file-id="${document.id}">Open</button>
				<button type="button" class="secondary" data-action="details-save-as" data-file-id="${document.id}">Save as...</button>
				<button type="button" class="secondary" data-action="details-share" data-file-id="${document.id}">Share</button>
				<button type="button" class="secondary" data-action="details-rename" data-file-id="${document.id}">Rename</button>
				<button type="button" class="secondary" data-action="details-move" data-file-id="${document.id}">Move</button>
				<button type="button" class="secondary" data-action="details-copy" data-file-id="${document.id}">Copy</button>
				<button type="button" class="secondary" data-action="details-download" data-file-id="${document.id}">Download</button>
				<button type="button" class="danger" data-action="details-delete" data-file-id="${document.id}">Delete</button>
			`;
	elements.detailsPanelContent.innerHTML = `
		<div class="details-card">
			<div class="details-preview">
				<img class="${previewClass}" src="${getPreviewImage(document)}" alt="${escapeHtml(document.name)} preview">
			</div>
			<div class="details-header">
				<h3>${escapeHtml(document.name)}</h3>
				<button type="button" class="secondary" data-action="details-toggle-favorite" data-file-id="${document.id}">${favoriteLabel}</button>
			</div>
			<div class="detail-meta">
				<div class="detail-meta-row"><span>Size</span><strong>${formatBytes(folderSizeBytes)}</strong></div>
				<div class="detail-meta-row"><span>Modified</span><strong>${formatDate(document.updatedAt)}</strong></div>
				<div class="detail-meta-row"><span>Author</span><strong>shared-user</strong></div>
				<div class="detail-meta-row"><span>Type</span><strong>${isFolder ? 'Folder' : 'File'}</strong></div>
				<div class="detail-meta-row"><span>Path</span><strong>${escapeHtml(document.relativePath)}</strong></div>
			</div>
			<div class="details-actions">
				${actionButtons}
			</div>
			${!isFolder ? `
			<div class="details-actions">
				<button type="button" class="secondary" data-action="details-versions" data-file-id="${document.id}">View versions</button>
			</div>
			` : ''}
		</div>
	`;

	for (const button of elements.detailsPanelContent.querySelectorAll('[data-action][data-file-id]')) {
		button.addEventListener('click', function() {
			handleDetailsAction(button.dataset.action, button.dataset.fileId);
		});
	}
}

async function renderVersionList(fileId) {
	try {
		const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions`);
		const fileEntry = getDocumentById(fileId);
		const versions = Array.isArray(payload.versions) ? payload.versions : [];
		elements.detailsPanelContent.innerHTML = `
			<div class="details-card">
				<div class="details-header">
					<h3>Versions</h3>
					<button type="button" class="secondary" data-action="details-back" data-file-id="${fileId}">Back</button>
				</div>
				<div class="version-list">
					${versions.length ? versions.map(function(version, index) {
						const isCurrent = index === 0;
						const versionNumber = isCurrent ? null : versions.length - index;
						return `
							<div class="version-item">
								<div class="version-thumb"><img src="${getPreviewImage(fileEntry)}" alt="Version preview"></div>
								<div class="version-body">
									<h4>${isCurrent ? 'Current version' : `Version ${versionNumber}`}${version.label ? ` — ${escapeHtml(version.label)}` : ''}</h4>
									<small>${escapeHtml(version.createdBy?.name ?? 'shared-user')}</small>
									<small>${formatDate(version.createdAt)} · ${formatBytes(version.size)}</small>
								</div>
								<div class="version-actions" style="position: relative;">
									<button type="button" class="secondary menu-button" data-action="context-menu" data-file-id="${fileId}" data-version-id="${version.id}" aria-label="Open version actions" aria-expanded="false">⋯</button>
								</div>
							</div>
						`;
						}).join('') : '<div class="file-meta">No versions recorded yet.</div>'}
				</div>
			</div>
		`;

		for (const button of elements.detailsPanelContent.querySelectorAll('[data-action][data-file-id]')) {
			button.addEventListener('click', function(event) {
				if (button.dataset.action === 'details-back') {
					openDetailsPanel(fileId);
					return;
				}
				if (button.dataset.action === 'context-menu' && button.dataset.versionId) {
					event.preventDefault();
					event.stopPropagation();
					const menuEntries = [];
					const version = versions.find((entry) => entry.id === button.dataset.versionId);
					if (!version) {
						return;
					}
					const isCurrent = versions[0]?.id === version.id;
					menuEntries.push({ label: 'View', action: 'version-view', danger: false, accent: true });
					menuEntries.push({ divider: true });
					menuEntries.push(isCurrent
						? { label: 'Name current', action: 'version-name-current', danger: false }
						: { label: 'Rename', action: 'version-rename', danger: false }
					);
					if (!isCurrent) {
						menuEntries.push({ label: 'Restore', action: 'version-restore', danger: false });
					}
					menuEntries.push({ label: 'Download', action: 'version-download', danger: false });
					if (!isCurrent) {
					menuEntries.push({ divider: true });
					menuEntries.push({ label: 'Delete', action: 'version-delete', danger: true });
					}

					closeOpenContextMenu();
					const menu = document.createElement('div');
					menu.className = 'context-menu';
					menu.innerHTML = menuEntries.map(function(entry) {
					if (entry.divider) {
						return '<div class="context-menu-separator"></div>';
					}
					const accentClass = entry.accent ? 'accent' : '';
					return `<button type="button" data-context-action="${entry.action}" data-file-id="${fileId}" data-version-id="${version.id}" class="${entry.danger ? 'danger' : ''} ${accentClass}">${entry.label}</button>`;
					}).join('');
					for (const menuButton of menu.querySelectorAll('[data-context-action][data-file-id]')) {
						menuButton.addEventListener('click', function(menuEvent) {
							menuEvent.preventDefault();
							menuEvent.stopPropagation();
							closeOpenContextMenu();
							handleVersionAction(menuButton.dataset.contextAction, fileId, version.id);
						});
					}
					positionContextMenu(menu, button, 220, 220);
					document.body.appendChild(menu);
					button.setAttribute('aria-expanded', 'true');
					return;
				}
			});
		}
	} catch (error) {
		setStatus(error.message, true);
	}
}

async function handleDetailsAction(action, fileId) {
	const document = getDocumentById(fileId);
	switch (action) {
		case 'details-toggle-favorite':
			await handleFileAction('favorite', fileId);
			openDetailsPanel(fileId);
			return;
		case 'details-view':
			if (isFolderEntry(document)) {
				setStatus('Folders cannot be previewed.', true);
				return;
			}
			await openDocument(fileId, 'view');
			return;
		case 'details-open':
			if (isFolderEntry(document)) {
				setStatus('Folders cannot be opened in Collabora.', true);
				return;
			}
			await openDocument(fileId, 'edit');
			return;
		case 'details-share':
			if (isFolderEntry(document)) {
				setStatus('Folders cannot be shared.', true);
				return;
			}
			await createShare(fileId);
			return;
		case 'details-rename':
			await renameDocument(fileId);
			await loadPage();
			openDetailsPanel(fileId);
			return;
		case 'details-move':
			await openFolderTargetDialog('move', fileId);
			return;
		case 'details-copy':
			await openFolderTargetDialog('copy', fileId);
			return;
		case 'details-download':
			if (isFolderEntry(document)) {
				setStatus('Folders cannot be downloaded.', true);
				return;
			}
			window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
			return;
		case 'details-delete':
			await deleteDocument(fileId);
			await loadPage();
			closeDetailsPanel();
			return;
		case 'details-save-as':
			await saveAsDocument(fileId);
			return;
		case 'details-versions':
			await renderVersionList(fileId);
			return;
		default:
			return;
	}
}

function showBulkActionsMenu(button) {
	closeOpenContextMenu();
	const selectedDocuments = getBulkSelectedDocuments();
	if (!selectedDocuments.length) {
		return;
	}

	const menu = document.createElement('div');
	menu.className = 'context-menu bulk-actions-menu';
	menu.innerHTML = `
		<button type="button" data-bulk-action="favorite">Add to favorites</button>
		<button type="button" data-bulk-action="download">Download</button>
		<button type="button" data-bulk-action="move">Move to...</button>
		<button type="button" data-bulk-action="copy">Copy to...</button>
		<div class="context-menu-separator"></div>
		<button type="button" class="danger" data-bulk-action="delete">Delete...</button>
	`;
	for (const menuButton of menu.querySelectorAll('[data-bulk-action]')) {
		menuButton.addEventListener('click', function(event) {
			event.preventDefault();
			event.stopPropagation();
			closeOpenContextMenu();
			handleBulkAction(menuButton.dataset.bulkAction);
		});
	}
	positionContextMenu(menu, button, 220, 220);
	document.body.appendChild(menu);
	button.setAttribute('aria-expanded', 'true');
	appState.bulkActionsMenuOpen = true;
}

function toggleBulkActionsMenu(button) {
	if (appState.bulkActionsMenuOpen) {
		closeOpenContextMenu();
		return;
	}
	showBulkActionsMenu(button);
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
		case 'move':
			await openFolderTargetDialog('move', selectedDocuments.map((document) => document.id));
			return;
		case 'copy':
			await openFolderTargetDialog('copy', selectedDocuments.map((document) => document.id));
			return;
		case 'delete':
			await deleteSelectedDocuments(selectedDocuments);
			return;
		default:
			return;
	}
}

async function handleVersionAction(action, fileId, versionId) {
	if (!versionId) {
		return;
	}
	switch (action) {
		case 'version-rename': {
			const nextName = window.prompt('Rename this version:');
			if (!nextName) {
				return;
			}
			await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: nextName })
			});
			await renderVersionList(fileId);
			return;
		}
		case 'version-view': {
			const language = navigator.language || 'en-US';
			const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/view?lang=${encodeURIComponent(language)}`);
			submitLaunchPayload(payload);
			return;
		}
		case 'version-name-current': {
			const nextName = window.prompt('Name the current version:');
			if (!nextName) {
				return;
			}
			await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: nextName })
			});
			await renderVersionList(fileId);
			return;
		}
		case 'version-restore':
			await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' });
			await loadPage();
			openDetailsPanel(fileId);
			return;
		case 'version-download':
			window.location.href = `/api/files/${encodeURIComponent(fileId)}/download?versionId=${encodeURIComponent(versionId)}`;
			return;
		case 'version-delete': {
			if (!window.confirm('Delete this version? This cannot be undone.')) {
				return;
			}
			await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}`, { method: 'DELETE' });
			await renderVersionList(fileId);
			return;
		}
		default:
			return;
	}
}

async function requestJson(url, options = {}) {
	const response = await fetch(url, options);
	let payload;

	try {
		payload = await response.json();
	} catch (error) {
		payload = null;
	}

	if (!response.ok) {
		const message = payload?.error ?? `Request failed with status ${response.status}.`;
		throw new Error(message);
	}

	return payload;
}

function applySearchFilter() {
	renderCurrentDocumentList();
}

function submitLaunchPayload(payload) {
	elements.collaboraForm.action = payload.actionUrl;
	elements.accessToken.value = payload.accessToken;
	elements.accessTokenTtl.value = String(payload.accessTokenTtl);
	elements.viewerTitle.textContent = `${payload.file.name} (${payload.mode})`;
	elements.viewerSubtitle.textContent = payload.file.relativePath;
	setViewerMode(payload.mode);
	elements.collaboraForm.requestSubmit();
}

function setViewerMode(mode) {
	const isFullscreenMode = mode === 'edit';
	document.body.classList.toggle('editor-fullscreen', isFullscreenMode);
	elements.closeViewerButton.classList.remove('hidden');
}

async function closeViewer() {
	document.body.classList.remove('editor-fullscreen');
	elements.closeViewerButton.classList.add('hidden');
	elements.viewerTitle.textContent = DEFAULT_VIEWER_TITLE;
	elements.viewerSubtitle.textContent = DEFAULT_VIEWER_SUBTITLE;
	elements.viewerFrame.src = 'about:blank';
	if (window.location.pathname.startsWith('/share/')) {
		window.history.replaceState(null, '', '/');
	}
	await loadPage();
	setStatus('Closed document.');
}

async function loadPage() {
	setStatus('Loading documents...');
	try {
		const [config, fileList] = await Promise.all([
			requestJson('/api/config'),
			requestJson('/api/files')
		]);

		appState.config = config;
		appState.documents = fileList.documents;
		elements.documentRoot.textContent = config.documentRoot;
		elements.appBaseUrl.textContent = config.appBaseUrl;
		elements.collaboraUrl.textContent = config.collaboraPublicUrl;
		renderCurrentDocumentList();
		setStatus(`Loaded ${fileList.documents.length} entr${fileList.documents.length === 1 ? 'y' : 'ies'}.`);
	} catch (error) {
		renderEmptyState();
		setStatus(error.message, true);
	}
}

async function openDocument(fileId, mode) {
	setStatus('Preparing Collabora launch...');
	try {
		const language = navigator.language || 'en-US';
		const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/launch?lang=${encodeURIComponent(language)}&mode=${encodeURIComponent(mode)}`);
		submitLaunchPayload(payload);
		setStatus(`Opened ${payload.file.name} in ${payload.mode} mode.`);
		await loadPage();
	} catch (error) {
		setStatus(error.message, true);
	}
}

async function createDocument(type) {
	return createDocumentInDirectory(type, '');
}

async function createDocumentInDirectory(type, directory) {
	setStatus(`Creating ${type} document...`);
	try {
		const payload = await requestJson('/api/files', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: type,
				directory: directory || undefined,
				mode: 'edit'
			})
		});
		submitLaunchPayload(payload);
		setStatus(`Created and opened ${payload.file.name}.`);
		await loadPage();
	} catch (error) {
		setStatus(error.message, true);
	}
}

async function createFolder() {
	return createFolderInDirectory('');
}

async function createFolderInDirectory(directory) {
	setStatus('Creating folder...');
	const folderName = window.prompt('Folder name:');
	if (!folderName) {
		return;
	}

	try {
		await requestJson('/api/folders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				directory: directory || undefined,
				folderName: folderName
			})
		});
		await loadPage();
		setStatus('Folder created.');
	} catch (error) {
		setStatus(error.message, true);
	}
}

async function renameDocument(fileId, nextNameOverride) {
	const document = getDocumentById(fileId);
	const promptLabel = isFolderEntry(document)
		? 'New folder name:'
		: 'New file name (with extension):';
	const nextName = nextNameOverride || window.prompt(promptLabel, document?.name ?? '');
	if (!nextName) {
		return;
	}
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/move`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetName: nextName })
	});
}

async function moveDocument(fileId, targetNameOverride, targetDirectoryOverride) {
	const document = getDocumentById(fileId);
	const targetName = targetNameOverride || window.prompt(isFolderEntry(document) ? 'Move folder as:' : 'Move name (with extension):', document?.name ?? '');
	if (!targetName) {
		return;
	}
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/move`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			targetDirectory: targetDirectoryOverride,
			targetName: targetName || undefined
		})
	});
}

async function copyDocument(fileId, targetNameOverride, targetDirectoryOverride) {
	const document = getDocumentById(fileId);
	const targetName = targetNameOverride || window.prompt(isFolderEntry(document) ? 'Copy folder as:' : 'Copy name (with extension):', document?.name ?? '');
	if (!targetName) {
		return;
	}
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/copy`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			targetDirectory: targetDirectoryOverride,
			targetName: targetName || undefined
		})
	});
}

function getFolderOptions() {
	const folders = appState.documents.filter((document) => isFolderEntry(document));
	return [
		{ value: '', label: 'Root folder' },
		...folders.map((folder) => ({
			value: folder.relativePath,
			label: folder.relativePath
		}))
	];
}

function populateFolderPicker(document, preferRoot = false) {
	const options = getFolderOptions();
	elements.folderPickerTarget.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
	const preferredTarget = preferRoot
		? ''
		: (document?.relativePath.includes('/')
			? document.relativePath.slice(0, document.relativePath.lastIndexOf('/'))
			: '');
	elements.folderPickerTarget.value = options.some((option) => option.value === preferredTarget) ? preferredTarget : '';
	elements.folderPickerName.value = document?.name ?? '';
}

function openFolderTargetDialog(action, fileIds) {
	const selectionIds = Array.isArray(fileIds) ? fileIds : [fileIds];
	const selectedDocuments = selectionIds
		.map((fileId) => getDocumentById(fileId))
		.filter(Boolean);
	if (!selectedDocuments.length) {
		return;
	}
	const isBulkMode = selectedDocuments.length > 1;

	appState.folderPickerAction = action;
	appState.folderPickerSelectionIds = selectedDocuments.map((document) => document.id);
	appState.folderPickerBulkMode = isBulkMode;
	elements.folderPickerModal.classList.remove('hidden');
	elements.folderPickerModal.setAttribute('aria-hidden', 'false');
	elements.folderPickerConfirm.textContent = action === 'move' ? 'Move' : 'Copy';
	elements.folderPickerTitle.textContent = isBulkMode
		? (action === 'move' ? 'Move selected items to folder' : 'Copy selected items to folder')
		: (action === 'move' ? 'Move to folder' : 'Copy to folder');
	elements.folderPickerName.closest('.modal-field').classList.toggle('hidden', isBulkMode);
	populateFolderPicker(selectedDocuments[0], isBulkMode);
	if (isBulkMode) {
		elements.folderPickerTarget.focus();
	} else {
		elements.folderPickerName.focus();
	}
}

function closeFolderTargetDialog() {
	appState.folderPickerAction = null;
	appState.folderPickerSelectionIds = [];
	appState.folderPickerBulkMode = false;
	elements.folderPickerModal.classList.add('hidden');
	elements.folderPickerModal.setAttribute('aria-hidden', 'true');
}

async function submitFolderTargetDialog(event) {
	event.preventDefault();
	const selectionIds = appState.folderPickerSelectionIds;
	const action = appState.folderPickerAction;
	if (!selectionIds.length || !action) {
		return;
	}
	const isBulkMode = appState.folderPickerBulkMode;

	const targetDirectory = elements.folderPickerTarget.value;
	const documents = selectionIds
		.map((fileId) => getDocumentById(fileId))
		.filter(Boolean);
	if (!documents.length) {
		return;
	}

	if (isBulkMode) {
		if (action === 'move') {
			await moveDocuments(documents, targetDirectory);
		} else {
			await copyDocuments(documents, targetDirectory);
		}
	} else {
		const fileId = selectionIds[0];
		const targetName = elements.folderPickerName.value.trim();
		if (!targetName) {
			setStatus('Please enter a name.', true);
			return;
		}
		if (action === 'move') {
			await moveDocument(fileId, targetName, targetDirectory);
		} else {
			await copyDocument(fileId, targetName, targetDirectory);
		}
	}
	await loadPage();
	closeFolderTargetDialog();
	setStatus(isBulkMode
		? (action === 'move' ? 'Selected items moved.' : 'Selected items copied.')
		: (action === 'move' ? 'Entry moved.' : 'Entry copied.'));
}

async function moveDocuments(documents, targetDirectory) {
	for (const document of documents) {
		await requestJson(`/api/files/${encodeURIComponent(document.id)}/move`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				targetDirectory: targetDirectory || undefined,
				targetName: document.name
			})
		});
	}
}

async function copyDocuments(documents, targetDirectory) {
	for (const document of documents) {
		await requestJson(`/api/files/${encodeURIComponent(document.id)}/copy`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				targetDirectory: targetDirectory || undefined,
				targetName: document.name
			})
		});
	}
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
		headers: { 'Content-Type': 'application/json' },
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

async function addSelectedDocumentsToFavorites(documents) {
	for (const document of documents) {
		await setFavoriteState(document.id, true);
	}
	await loadPage();
	setStatus(`Added ${documents.length} selected item${documents.length === 1 ? '' : 's'} to favorites.`);
}

async function deleteSelectedDocuments(documents) {
	const confirmed = window.confirm(`Delete ${documents.length} selected item${documents.length === 1 ? '' : 's'}?`);
	if (!confirmed) {
		return;
	}

	for (const document of documents) {
		await requestJson(`/api/files/${encodeURIComponent(document.id)}`, {
			method: 'DELETE'
		});
	}

	appState.selectedFileIds.clear();
	closeDetailsPanel();
	await loadPage();
	setStatus(`Deleted ${documents.length} selected item${documents.length === 1 ? '' : 's'}.`);
}

async function saveAsDocument(fileId) {
	const document = getDocumentById(fileId);
	const targetName = window.prompt('Save copy as (with extension):', document?.name ?? '');
	if (!targetName) {
		return;
	}
	await copyDocument(fileId, targetName);
	await loadPage();
	openDetailsPanel(fileId);
}

async function deleteDocument(fileId) {
	if (!window.confirm('Delete this document?')) {
		return;
	}

	await requestJson(`/api/files/${encodeURIComponent(fileId)}`, {
		method: 'DELETE'
	});
}

async function setFavoriteState(fileId, favorite) {
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/favorite`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ favorite: favorite })
	});
}

async function toggleFavorite(fileId) {
	const file = appState.documents.find((entry) => entry.id === fileId);
	await setFavoriteState(fileId, !file.favorite);
}

async function showVersions(fileId) {
	const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions`);
	if (!payload.versions.length) {
		window.alert('No versions yet.');
		return;
	}

	const selectedId = window.prompt(
		`Version history:\n${payload.versions.map((version) => `${version.id} — ${new Date(version.createdAt).toLocaleString()}`).join('\n')}\n\nEnter a Version ID to restore:`
	);
	if (!selectedId) {
		return;
	}

	await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(selectedId)}/restore`, {
		method: 'POST'
	});
}

async function createShare(fileId) {
	const permission = window.confirm('Create edit share link? Click Cancel for read-only link.') ? 'edit' : 'view';
	const payload = await requestJson('/api/shares', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ fileId: fileId, permission: permission })
	});
	await navigator.clipboard.writeText(payload.url);
	window.alert(`Share link copied to clipboard:\n${payload.url}`);
}

async function showContextMenu(fileId, button) {
	const documentEntry = getDocumentById(fileId);
	if (!documentEntry) {
		return;
	}
	closeOpenContextMenu();
	appState.contextMenuFileId = fileId;
	appState.newDocumentMenuOpen = false;
	const isFolder = isFolderEntry(documentEntry);
	const menu = document.createElement('div');
	menu.className = 'context-menu';
	menu.innerHTML = `
		<button type="button" data-context-action="details" data-file-id="${documentEntry.id}">Details</button>
		<button type="button" data-context-action="favorite" data-file-id="${documentEntry.id}">${documentEntry.favorite ? 'Remove from favorites' : 'Add to favorites'}</button>
		${isFolder ? '' : `<button type="button" data-context-action="view" data-file-id="${documentEntry.id}">Preview (View)</button>`}
		${isFolder ? `<button type="button" data-context-action="new-document" data-file-id="${documentEntry.id}" class="has-submenu">New...</button>
		<div class="context-menu-submenu hidden" data-submenu="new-document" aria-label="New document submenu">
			<button type="button" data-context-action="new-folder" data-file-id="${documentEntry.id}">New folder</button>
			<div class="context-menu-separator"></div>
			<button type="button" data-context-action="new-text" data-file-id="${documentEntry.id}">New text document</button>
			<button type="button" data-context-action="new-spreadsheet" data-file-id="${documentEntry.id}">New spreadsheet</button>
			<button type="button" data-context-action="new-presentation" data-file-id="${documentEntry.id}">New presentation</button>
			<div class="context-menu-separator"></div>
			<button type="button" data-context-action="new-microsoft-text" data-file-id="${documentEntry.id}">New Microsoft Word document</button>
			<button type="button" data-context-action="new-microsoft-spreadsheet" data-file-id="${documentEntry.id}">New Microsoft Excel spreadsheet</button>
			<button type="button" data-context-action="new-microsoft-presentation" data-file-id="${documentEntry.id}">New Microsoft PowerPoint presentation</button>
		</div>` : ''}
		<button type="button" data-context-action="download" data-file-id="${documentEntry.id}">Download</button>
		<button type="button" data-context-action="rename" data-file-id="${documentEntry.id}">Rename</button>
		<button type="button" data-context-action="move" data-file-id="${documentEntry.id}">Move to...</button>
		<button type="button" data-context-action="copy" data-file-id="${documentEntry.id}">Copy to...</button>
		${isFolder ? '' : `<button type="button" data-context-action="save-as" data-file-id="${documentEntry.id}">Save as...</button>`}
		<div class="context-menu-separator"></div>
		<button type="button" class="danger" data-context-action="delete" data-file-id="${documentEntry.id}">Delete ${isFolder ? 'folder' : 'file'}</button>
	`;
	for (const menuButton of menu.querySelectorAll('[data-context-action][data-file-id]')) {
		menuButton.addEventListener('click', function(event) {
			event.preventDefault();
			event.stopPropagation();
			if (menuButton.dataset.contextAction === 'new-document') {
				toggleNewDocumentSubmenu(menu);
				return;
			}
			closeOpenContextMenu();
			handleContextMenuAction(menuButton.dataset.contextAction, fileId);
		});
	}
	const buttonRect = button.getBoundingClientRect();
	const menuWidth = 220;
	const menuHeight = 320;
	const left = Math.min(window.innerWidth - menuWidth - 12, Math.max(12, buttonRect.right - menuWidth + 8));
	const top = Math.min(window.innerHeight - menuHeight - 12, Math.max(12, buttonRect.top + 8));
	menu.style.position = 'fixed';
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
	document.body.appendChild(menu);
	button.setAttribute('aria-expanded', 'true');
}

function closeOpenContextMenu() {
	const existingMenu = document.querySelector('.context-menu');
	if (existingMenu) {
		existingMenu.remove();
	}
	const existingSubmenu = document.querySelector('.context-menu-submenu');
	if (existingSubmenu) {
		existingSubmenu.remove();
	}
	for (const menuButton of document.querySelectorAll('.menu-button[aria-expanded="true"]')) {
		menuButton.setAttribute('aria-expanded', 'false');
	}
	appState.contextMenuFileId = null;
	appState.bulkActionsMenuOpen = false;
	appState.newDocumentMenuOpen = false;
}

function toggleNewDocumentSubmenu(menu) {
	const submenu = menu.querySelector('[data-submenu="new-document"]');
	if (!submenu) {
		return;
	}

	const isOpen = !submenu.classList.contains('hidden');
	submenu.classList.toggle('hidden', isOpen);
	appState.newDocumentMenuOpen = !isOpen;
}

async function handleContextMenuAction(action, fileId) {
	const documentEntry = fileId ? getDocumentById(fileId) : null;
	if (fileId && !documentEntry) {
		return;
	}
	if (!fileId && !String(action).startsWith('new-')) {
		return;
	}

	switch (action) {
		case 'favorite':
			await handleFileAction('favorite', fileId);
			return;
		case 'details':
			openDetailsPanel(fileId);
			return;
		case 'new-document':
			return;
		case 'new-text':
			await createDocumentInDirectory('text', documentEntry?.relativePath || '');
			return;
		case 'new-spreadsheet':
			await createDocumentInDirectory('spreadsheet', documentEntry?.relativePath || '');
			return;
		case 'new-presentation':
			await createDocumentInDirectory('presentation', documentEntry?.relativePath || '');
			return;
		case 'new-microsoft-text':
			await createDocumentInDirectory('microsoft-text', documentEntry?.relativePath || '');
			return;
		case 'new-microsoft-spreadsheet':
			await createDocumentInDirectory('microsoft-spreadsheet', documentEntry?.relativePath || '');
			return;
		case 'new-microsoft-presentation':
			await createDocumentInDirectory('microsoft-presentation', documentEntry?.relativePath || '');
			return;
		case 'new-folder':
			await createFolderInDirectory(documentEntry?.relativePath || '');
			return;
		case 'view':
			await openDocument(fileId, 'view');
			return;
		case 'rename':
			await renameDocument(fileId);
			await loadPage();
			return;
		case 'move':
			await openFolderTargetDialog('move', fileId);
			return;
		case 'copy':
			await openFolderTargetDialog('copy', fileId);
			return;
		case 'save-as':
			await saveAsDocument(fileId);
			return;
		case 'download':
			window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
			return;
		case 'delete':
			await deleteDocument(fileId);
			await loadPage();
			return;
		default:
			return;
	}
}

async function handleFileAction(action, fileId, mode) {
	try {
		switch (action) {
			case 'open':
				await openDocument(fileId, mode || 'edit');
				return;
			case 'details':
				openDetailsPanel(fileId);
				return;
			case 'download':
				window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
				return;
			case 'rename':
				await renameDocument(fileId);
				break;
			case 'copy':
				await openFolderTargetDialog('copy', fileId);
				break;
			case 'move':
				await openFolderTargetDialog('move', fileId);
				break;
			case 'delete':
				await deleteDocument(fileId);
				break;
			case 'favorite':
				await toggleFavorite(fileId);
				break;
			case 'versions':
				await showVersions(fileId);
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

async function maybeLaunchPublicShare() {
	const pathMatch = window.location.pathname.match(/^\/share\/([^/]+)$/);
	if (!pathMatch) {
		return false;
	}

	setStatus('Loading public share...');
	try {
		const payload = await requestJson(`/api/shares/${encodeURIComponent(pathMatch[1])}/launch?lang=${encodeURIComponent(navigator.language || 'en-US')}`);
		submitLaunchPayload(payload);
		setStatus(`Opened share ${payload.file.name}.`);
		return true;
	} catch (error) {
		setStatus(error.message, true);
		return true;
	}
}

function positionContextMenu(menu, button, menuWidth = 220, menuHeight = 320) {
	const buttonRect = button.getBoundingClientRect();
	const left = Math.min(window.innerWidth - menuWidth - 12, Math.max(12, buttonRect.right - menuWidth + 8));
	const top = Math.min(window.innerHeight - menuHeight - 12, Math.max(12, buttonRect.top + 8));
	menu.style.position = 'fixed';
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
}

function showNewDocumentMenu(button) {
	closeOpenContextMenu();
	const menu = document.createElement('div');
	menu.className = 'context-menu new-document-menu';
	menu.innerHTML = `
		<button type="button" data-context-action="new-folder">New folder</button>
		<div class="context-menu-separator"></div>
		<button type="button" data-context-action="new-text">New text document</button>
		<button type="button" data-context-action="new-spreadsheet">New spreadsheet</button>
		<button type="button" data-context-action="new-presentation">New presentation</button>
		<div class="context-menu-separator"></div>
		<button type="button" data-context-action="new-microsoft-text">New Microsoft Word document</button>
		<button type="button" data-context-action="new-microsoft-spreadsheet">New Microsoft Excel spreadsheet</button>
		<button type="button" data-context-action="new-microsoft-presentation">New Microsoft PowerPoint presentation</button>
	`;
	for (const menuButton of menu.querySelectorAll('[data-context-action]')) {
		menuButton.addEventListener('click', function(event) {
			event.preventDefault();
			event.stopPropagation();
			closeOpenContextMenu();
			handleContextMenuAction(menuButton.dataset.contextAction);
		});
	}
	positionContextMenu(menu, button, 220, 220);
	document.body.appendChild(menu);
	button.setAttribute('aria-expanded', 'true');
	appState.newDocumentMenuOpen = true;
}

function toggleNewDocumentMenu(button) {
	if (appState.newDocumentMenuOpen) {
		closeOpenContextMenu();
		return;
	}
	showNewDocumentMenu(button);
}

async function bulkDeleteSelected() {
	return deleteSelectedDocuments(getBulkSelectedDocuments());
}

elements.refreshButton.addEventListener('click', loadPage);
elements.newMenuButton.addEventListener('click', function(event) {
event.preventDefault();
event.stopPropagation();
toggleNewDocumentMenu(elements.newMenuButton);
});
elements.bulkActionsMenuButton.addEventListener('click', function(event) {
event.preventDefault();
event.stopPropagation();
toggleBulkActionsMenu(elements.bulkActionsMenuButton);
});
elements.searchInput.addEventListener('input', applySearchFilter);
elements.closeViewerButton.addEventListener('click', function() {
closeViewer();
});
elements.folderPickerCancel.addEventListener('click', closeFolderTargetDialog);
elements.folderPickerForm.addEventListener('submit', submitFolderTargetDialog);
elements.folderPickerModal.addEventListener('click', function(event) {
if (event.target === elements.folderPickerModal) {
	closeFolderTargetDialog();
}
});
document.addEventListener('click', function(event) {
if (!event.target.closest('.context-menu') && !event.target.closest('.menu-button')) {
	closeOpenContextMenu();
}
});
elements.closeDetailsPanelButton.addEventListener('click', closeDetailsPanel);
elements.selectAllFiles.addEventListener('change', function(event) {
const visibleDocuments = appState.visibleDocuments.length ? appState.visibleDocuments : appState.documents;
if (event.target.checked) {
	for (const document of visibleDocuments) {
		appState.selectedFileIds.add(document.id);
	}
} else {
	for (const document of visibleDocuments) {
		appState.selectedFileIds.delete(document.id);
	}
}
updateBulkActionState(visibleDocuments);
renderCurrentDocumentList();
});
elements.themeSelect.addEventListener('change', function(event) {
applyThemeMode(event.target.value, true);
});

initializeTheme();
maybeLaunchPublicShare().then(function(launchedFromShare) {
if (!launchedFromShare) {
	loadPage();
}
});
