import { getVisibleTreeEntries } from './fileBrowserTree.mjs';

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
	bulkDeleteButton: document.querySelector('#bulk-delete-button'),
	viewerFrame: document.querySelector('#collabora-online-viewer'),
	refreshButton: document.querySelector('#refresh-button'),
	newTextButton: document.querySelector('#new-text-button'),
	newSpreadsheetButton: document.querySelector('#new-spreadsheet-button'),
	newPresentationButton: document.querySelector('#new-presentation-button'),
	newFolderButton: document.querySelector('#new-folder-button'),
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
	folderPickerFileId: null,
	contextMenuFileId: null,
	newDocumentMenuOpen: false
};

const DEFAULT_VIEWER_TITLE = 'No document opened yet';
const DEFAULT_VIEWER_SUBTITLE = 'Choose a file from the list to open it in Collabora.';
const THEME_STORAGE_KEY = 'wopi-folder-browser-theme';
const THEME_MODES = new Set(['auto', 'light', 'dark']);
const systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function isFolderEntry(document) {
	return Boolean(document && document.isDirectory);
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

function renderEmptyState(message = 'No supported documents or folders found. Create one with the New buttons.') {
	elements.documentsBody.innerHTML = `
		<tr>
			<td colspan="6">
				<div class="file-meta">${escapeHtml(message)}</div>
			</td>
		</tr>
	`;
	elements.selectAllFiles.checked = false;
	elements.bulkActions.classList.add('hidden');
}

function updateBulkActionState(documents) {
	const selectedCount = appState.selectedFileIds.size;
	elements.selectionSummary.textContent = `${selectedCount} selected`;
	elements.bulkActions.classList.toggle('hidden', selectedCount === 0);
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

function toggleDocumentSelection(fileId, checked) {
	if (checked) {
		appState.selectedFileIds.add(fileId);
	} else {
		appState.selectedFileIds.delete(fileId);
	}
	updateBulkActionState(appState.visibleDocuments.length ? appState.visibleDocuments : appState.documents);
	const row = elements.documentsBody.querySelector(`tr[data-file-id="${CSS.escape(fileId)}"]`);
	if (row) {
		row.classList.toggle('selected-row', checked);
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

function buildFilePreviewSvg(document) {
	const MIME_COLOR_MAP = {
		folder: '#d97706',
		spreadsheet: '#2f9e44',
		text: '#0f62fe',
		presentation: '#f59f00',
		default: '#64748b'
	};
	const typeKey = document.isDirectory ? 'folder'
	: document.mimeType && document.mimeType.includes('spreadsheet') ? 'spreadsheet'
	: document.mimeType && document.mimeType.includes('presentation') ? 'presentation'
	: document.mimeType && (document.mimeType.includes('text') || document.mimeType.includes('csv')) ? 'text'
	: 'default';
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
	const previewUrl = buildFilePreviewSvg(document);
	const isFolder = isFolderEntry(document);
	const isExpanded = isFolder && appState.expandedFolderIds.has(document.id);
	const toggleLabel = isExpanded ? 'Collapse folder' : 'Expand folder';
	return `
		<tr class="${isSelected ? 'selected-row' : ''} ${isFolder ? 'tree-folder-row' : 'tree-file-row'}" data-file-id="${document.id}" data-tree-depth="${depth}" data-is-folder="${isFolder}">
			<td class="select-cell">
				<input type="checkbox" class="file-select-checkbox" data-file-id="${document.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${escapeHtml(document.name)}">
			</td>
			<td class="tree-name-cell">
				<div class="file-row-main tree-row-main" style="padding-left: ${depth * 1.25}rem">
					${isFolder ? `<button type="button" class="tree-toggle" data-action="toggle-folder" data-file-id="${document.id}" aria-label="${toggleLabel}" aria-expanded="${isExpanded ? 'true' : 'false'}">${isExpanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-spacer" aria-hidden="true"></span>'}
					<img class="file-row-preview ${isFolder ? 'folder-preview' : ''}" src="${previewUrl}" alt="${escapeHtml(document.name)} preview">
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
					${isFolder ? '<button type="button" class="secondary" data-action="details" data-file-id="'+document.id+'">Details</button>' : '<button type="button" data-action="open" data-mode="edit" data-file-id="'+document.id+'">Open</button><button type="button" class="secondary" data-action="open" data-mode="view" data-file-id="'+document.id+'">View</button>'}
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
			if (document && document.isDirectory) {
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
				<img src="${getPreviewImage(document)}" alt="${escapeHtml(document.name)} preview">
			</div>
			<div class="details-header">
				<h3>${escapeHtml(document.name)}</h3>
				<button type="button" class="secondary" data-action="details-toggle-favorite" data-file-id="${document.id}">${favoriteLabel}</button>
			</div>
			<div class="detail-meta">
				<div class="detail-meta-row"><span>Size</span><strong>${formatBytes(document.size)}</strong></div>
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
		const document = getDocumentById(fileId);
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
						return `
							<div class="version-item">
								<div class="version-thumb"><img src="${getPreviewImage(document)}" alt="Version preview"></div>
								<div class="version-body">
									<h4>${isCurrent ? 'Current version' : `Version ${index + 1}`}</h4>
									<small>${escapeHtml(version.createdBy && version.createdBy.name ? version.createdBy.name : 'shared-user')}</small>
									<small>${formatDate(version.createdAt)} · ${formatBytes(version.size)}</small>
								</div>
								<div class="version-actions">
									${isCurrent ? '<button type="button" class="secondary" data-action="version-name-current" data-file-id="'+fileId+'" data-version-id="'+version.id+'">Name current</button>' : '<button type="button" class="secondary" data-action="version-rename" data-file-id="'+fileId+'" data-version-id="'+version.id+'">Rename</button>'}
									${!isCurrent ? '<button type="button" class="secondary" data-action="version-compare" data-file-id="'+fileId+'" data-version-id="'+version.id+'">Compare</button>' : ''}
									${!isCurrent ? '<button type="button" class="secondary" data-action="version-restore" data-file-id="'+fileId+'" data-version-id="'+version.id+'">Restore</button>' : ''}
									<button type="button" class="secondary" data-action="version-download" data-file-id="'+fileId+'" data-version-id="'+version.id+'">Download</button>
									${!isCurrent ? '<button type="button" class="danger" data-action="version-delete" data-file-id="'+fileId+'" data-version-id="'+version.id+'">Delete</button>' : ''}
								</div>
							</div>
						`;
						}).join('') : '<div class="file-meta">No versions recorded yet.</div>'}
				</div>
			</div>
		`;
		for (const button of elements.detailsPanelContent.querySelectorAll('[data-action][data-file-id]')) {
			button.addEventListener('click', function() {
				if (button.dataset.action === 'details-back') {
					openDetailsPanel(fileId);
					return;
				}
				handleVersionAction(button.dataset.action, fileId, button.dataset.versionId);
			});
		}
	} catch (error) {
		setStatus(error.message, true);
	}
}

async function handleDetailsAction(action, fileId) {
	const document = getDocumentById(fileId);
	if (action === 'details-toggle-favorite') {
		await handleFileAction('favorite', fileId);
		if (document) {
			renderDetailsPanel(document);
		}
		return;
	}
	if (action === 'details-view') {
		if (isFolderEntry(document)) {
			setStatus('Folders cannot be previewed.', true);
			return;
		}
		await openDocument(fileId, 'view');
		return;
	}
	if (action === 'details-open') {
		if (isFolderEntry(document)) {
			setStatus('Folders cannot be opened in Collabora.', true);
			return;
		}
		await openDocument(fileId, 'edit');
		return;
	}
	if (action === 'details-share') {
		if (isFolderEntry(document)) {
			setStatus('Folders cannot be shared.', true);
			return;
		}
		await createShare(fileId);
		return;
	}
	if (action === 'details-rename') {
		await renameDocument(fileId);
		await loadPage();
		openDetailsPanel(fileId);
		return;
	}
	if (action === 'details-move') {
		await openFolderTargetDialog('move', fileId);
		return;
	}
	if (action === 'details-copy') {
		await openFolderTargetDialog('copy', fileId);
		return;
	}
	if (action === 'details-download') {
		if (isFolderEntry(document)) {
			setStatus('Folders cannot be downloaded.', true);
			return;
		}
		window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
		return;
	}
	if (action === 'details-delete') {
		await deleteDocument(fileId);
		await loadPage();
		closeDetailsPanel();
		return;
	}
	if (action === 'details-save-as') {
		await saveAsDocument(fileId);
		return;
	}
	if (action === 'details-versions') {
		await renderVersionList(fileId);
		return;
	}
}

async function handleVersionAction(action, fileId, versionId) {
	if (!versionId) {
		return;
	}
	if (action === 'version-rename') {
		const nextName = window.prompt('Rename this version (optional):');
		if (!nextName) {
			return;
		}
		window.alert('Version rename is not yet available from the API sample; the current version metadata remains read-only in this UI.');
		return;
	}
	if (action === 'version-name-current') {
		window.alert('Current version naming is not yet available from the API sample.');
		return;
	}
	if (action === 'version-compare') {
		window.alert('Compare view is not yet available from the API sample.');
		return;
	}
	if (action === 'version-restore') {
		await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' });
		await loadPage();
		openDetailsPanel(fileId);
		return;
	}
	if (action === 'version-download') {
		window.location.href = `/api/files/${encodeURIComponent(fileId)}/download?versionId=${encodeURIComponent(versionId)}`;
		return;
	}
	if (action === 'version-delete') {
		window.alert('Version deletion is not yet available from the API sample.');
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
		const message = payload && payload.error ? payload.error : `Request failed with status ${response.status}.`;
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
	const nextName = nextNameOverride || window.prompt(promptLabel, document ? document.name : '');
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
	const targetName = targetNameOverride || window.prompt(isFolderEntry(document) ? 'Move folder as:' : 'Move name (with extension):', document ? document.name : '');
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
	const targetName = targetNameOverride || window.prompt(isFolderEntry(document) ? 'Copy folder as:' : 'Copy name (with extension):', document ? document.name : '');
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

function populateFolderPicker(document) {
	const options = getFolderOptions();
	elements.folderPickerTarget.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
	const preferredTarget = document && document.relativePath.includes('/')
		? document.relativePath.slice(0, document.relativePath.lastIndexOf('/'))
		: '';
	elements.folderPickerTarget.value = options.some((option) => option.value === preferredTarget) ? preferredTarget : '';
	elements.folderPickerName.value = document ? document.name : '';
}

function openFolderTargetDialog(action, fileId) {
	const document = getDocumentById(fileId);
	if (!document) {
		return;
	}

	appState.folderPickerAction = action;
	appState.folderPickerFileId = fileId;
	elements.folderPickerModal.classList.remove('hidden');
	elements.folderPickerModal.setAttribute('aria-hidden', 'false');
	elements.folderPickerConfirm.textContent = action === 'move' ? 'Move' : 'Copy';
	elements.folderPickerTitle.textContent = action === 'move' ? 'Move to folder' : 'Copy to folder';
	populateFolderPicker(document);
	elements.folderPickerName.focus();
}

function closeFolderTargetDialog() {
	appState.folderPickerAction = null;
	appState.folderPickerFileId = null;
	elements.folderPickerModal.classList.add('hidden');
	elements.folderPickerModal.setAttribute('aria-hidden', 'true');
}

async function submitFolderTargetDialog(event) {
	event.preventDefault();
	const fileId = appState.folderPickerFileId;
	const action = appState.folderPickerAction;
	if (!fileId || !action) {
		return;
	}

	const targetDirectory = elements.folderPickerTarget.value;
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
	await loadPage();
	closeFolderTargetDialog();
	setStatus(action === 'move' ? 'Entry moved.' : 'Entry copied.');
}

async function saveAsDocument(fileId) {
	const document = getDocumentById(fileId);
	const targetName = window.prompt('Save copy as (with extension):', document ? document.name : '');
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

async function toggleFavorite(fileId) {
	const file = appState.documents.find((entry) => entry.id === fileId);
	const nextFavorite = !file.favorite;
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/favorite`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ favorite: nextFavorite })
	});
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
		${isFolder ? '' : `<button type="button" data-context-action="favorite" data-file-id="${documentEntry.id}">${documentEntry.favorite ? 'Remove from favorites' : 'Add to favorites'}</button>
		<button type="button" data-context-action="view" data-file-id="${documentEntry.id}">Preview (View)</button>`}
		${isFolder ? `<button type="button" data-context-action="new-document" data-file-id="${documentEntry.id}" class="has-submenu">New document...</button>
		<div class="context-menu-submenu hidden" data-submenu="new-document" aria-label="New document submenu">
			<button type="button" data-context-action="new-text" data-file-id="${documentEntry.id}">New text document</button>
			<button type="button" data-context-action="new-spreadsheet" data-file-id="${documentEntry.id}">New spreadsheet</button>
			<button type="button" data-context-action="new-presentation" data-file-id="${documentEntry.id}">New presentation</button>
			<button type="button" data-context-action="new-folder" data-file-id="${documentEntry.id}">New folder</button>
		</div>` : ''}
		<button type="button" data-context-action="rename" data-file-id="${documentEntry.id}">Rename</button>
		<button type="button" data-context-action="move" data-file-id="${documentEntry.id}">Move to...</button>
		<button type="button" data-context-action="copy" data-file-id="${documentEntry.id}">Copy to...</button>
		${isFolder ? '' : `<button type="button" data-context-action="save-as" data-file-id="${documentEntry.id}">Save as...</button>
		<button type="button" data-context-action="download" data-file-id="${documentEntry.id}">Download</button>`}
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
	const documentEntry = getDocumentById(fileId);
	if (!documentEntry) {
		return;
	}

	if (action === 'favorite') {
		await handleFileAction('favorite', fileId);
		return;
	}
	if (action === 'details') {
		openDetailsPanel(fileId);
		return;
	}
	if (action === 'new-document') {
		return;
	}
	if (action === 'new-text') {
		await createDocumentInDirectory('text', documentEntry.relativePath);
		return;
	}
	if (action === 'new-spreadsheet') {
		await createDocumentInDirectory('spreadsheet', documentEntry.relativePath);
		return;
	}
	if (action === 'new-presentation') {
		await createDocumentInDirectory('presentation', documentEntry.relativePath);
		return;
	}
	if (action === 'new-folder') {
		await createFolderInDirectory(documentEntry.relativePath);
		return;
	}
	if (action === 'view') {
		await openDocument(fileId, 'view');
		return;
	}
	if (action === 'rename') {
		await renameDocument(fileId);
		await loadPage();
		return;
	}
	if (action === 'move') {
		await openFolderTargetDialog('move', fileId);
		return;
	}
	if (action === 'copy') {
		await openFolderTargetDialog('copy', fileId);
		return;
	}
	if (action === 'save-as') {
		await saveAsDocument(fileId);
		return;
	}
	if (action === 'download') {
		window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
		return;
	}
	if (action === 'delete') {
		await deleteDocument(fileId);
		await loadPage();
		return;
	}
}

async function handleFileAction(action, fileId, mode) {
	try {
		if (action === 'open') {
			await openDocument(fileId, mode || 'edit');
			return;
		}
		if (action === 'details') {
			openDetailsPanel(fileId);
			return;
		}
		if (action === 'download') {
			window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
			return;
		}
		if (action === 'rename') {
			await renameDocument(fileId);
		} else if (action === 'copy') {
			await openFolderTargetDialog('copy', fileId);
		} else if (action === 'move') {
			await openFolderTargetDialog('move', fileId);
		} else if (action === 'delete') {
			await deleteDocument(fileId);
		} else if (action === 'favorite') {
			await toggleFavorite(fileId);
		} else if (action === 'versions') {
			await showVersions(fileId);
		} else if (action === 'share') {
			await createShare(fileId);
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

async function bulkDeleteSelected() {
const selectedIds = Array.from(appState.selectedFileIds);
if (selectedIds.length === 0) {
	return;
}

const confirmed = window.confirm(`Delete ${selectedIds.length} selected document${selectedIds.length === 1 ? '' : 's'}?`);
if (!confirmed) {
	return;
}

for (const fileId of selectedIds) {
	await requestJson(`/api/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

appState.selectedFileIds.clear();
closeDetailsPanel();
await loadPage();
setStatus(`Deleted ${selectedIds.length} selected document${selectedIds.length === 1 ? '' : 's'}.`);
}

elements.refreshButton.addEventListener('click', loadPage);
elements.newTextButton.addEventListener('click', function() {
createDocument('text');
});
elements.newSpreadsheetButton.addEventListener('click', function() {
createDocument('spreadsheet');
});
elements.newPresentationButton.addEventListener('click', function() {
createDocument('presentation');
});
elements.newFolderButton.addEventListener('click', createFolder);
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
elements.bulkDeleteButton.addEventListener('click', bulkDeleteSelected);
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
