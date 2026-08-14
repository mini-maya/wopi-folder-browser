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
	themeSelect: document.querySelector('#theme-select'),
	searchInput: document.querySelector('#search-input'),
	collaboraForm: document.querySelector('#collabora-submit-form'),
	accessToken: document.querySelector('#access-token'),
	accessTokenTtl: document.querySelector('#access-token-ttl')
};

const appState = {
	documents: [],
	visibleDocuments: [],
	config: null,
	themeMode: 'auto',
	selectedFileIds: new Set()
};

const DEFAULT_VIEWER_TITLE = 'No document opened yet';
const DEFAULT_VIEWER_SUBTITLE = 'Choose a file from the list to open it in Collabora.';
const THEME_STORAGE_KEY = 'wopi-folder-browser-theme';
const THEME_MODES = new Set(['auto', 'light', 'dark']);
const systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

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

function renderEmptyState() {
	elements.documentsBody.innerHTML = `
		<tr>
			<td colspan="6">
				<div class="file-meta">No supported documents found. Create one with the New buttons.</div>
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
		spreadsheet: '#2f9e44',
		text: '#0f62fe',
		presentation: '#f59f00',
	
default: '#64748b'
	};
	const typeKey = document.mimeType && document.mimeType.includes('spreadsheet') ? 'spreadsheet'
		: document.mimeType && document.mimeType.includes('presentation') ? 'presentation'
		: document.mimeType && (document.mimeType.includes('text') || document.mimeType.includes('csv')) ? 'text'
		: 'default';
	const label = (document.name ? document.name.split('.').pop() || 'FILE' : 'FILE').toUpperCase();
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

function renderDocuments(documents) {
	if (documents.length === 0) {
		renderEmptyState();
		return;
	}

	elements.documentsBody.innerHTML = documents.map(function(document) {
		const isSelected = appState.selectedFileIds.has(document.id);
		const previewUrl = buildFilePreviewSvg(document);
		return `
			<tr class="${isSelected ? 'selected-row' : ''}" data-file-id="${document.id}">
				<td class="select-cell">
					<input type="checkbox" class="file-select-checkbox" data-file-id="${document.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${escapeHtml(document.name)}">
				</td>
				<td>
					<div class="file-row-main">
						<img class="file-row-preview" src="${previewUrl}" alt="${escapeHtml(document.name)} preview">
						<div>
							<div class="file-name">${escapeHtml(document.name)}</div>
							<div class="file-meta">${escapeHtml(document.mimeType)}</div>
						</div>
					</div>
				</td>
				<td>${escapeHtml(document.relativePath)}</td>
				<td>${formatDate(document.updatedAt)}</td>
				<td>${formatBytes(document.size)}</td>
				<td>
					<div class="actions actions-inline">
						<button type="button" data-action="open" data-mode="edit" data-file-id="${document.id}">Open</button>
						<button type="button" class="secondary" data-action="open" data-mode="view" data-file-id="${document.id}">View</button>
						<button type="button" class="secondary menu-button" data-action="context-menu" data-file-id="${document.id}" aria-label="Open file actions">⋯</button>
					</div>
				</td>
			</tr>
		`;
	}).join('');

	for (const checkbox of elements.documentsBody.querySelectorAll('.file-select-checkbox')) {
		checkbox.addEventListener('change', function(event) {
			event.stopPropagation();
			toggleDocumentSelection(event.target.dataset.fileId, event.target.checked);
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
			if (button.dataset.action === 'open') {
				handleFileAction('open', button.dataset.fileId, button.dataset.mode);
				return;
			}
			handleFileAction(button.dataset.action, button.dataset.fileId, button.dataset.mode);
		});
	}

	appState.visibleDocuments = documents;
	updateBulkActionState(documents);
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
	const favoriteLabel = document.favorite ? '★ Favorite' : '☆ Favorite';
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
				<div class="detail-meta-row"><span>Path</span><strong>${escapeHtml(document.relativePath)}</strong></div>
			</div>
			<div class="details-actions">
				<button type="button" data-action="details-view" data-file-id="${document.id}">View</button>
				<button type="button" class="secondary" data-action="details-open" data-file-id="${document.id}">Open</button>
				<button type="button" class="secondary" data-action="details-save-as" data-file-id="${document.id}">Save as...</button>
				<button type="button" class="secondary" data-action="details-share" data-file-id="${document.id}">Share</button>
				<button type="button" class="secondary" data-action="details-rename" data-file-id="${document.id}">Rename</button>
				<button type="button" class="secondary" data-action="details-copy" data-file-id="${document.id}">Copy</button>
				<button type="button" class="secondary" data-action="details-download" data-file-id="${document.id}">Download</button>
				<button type="button" class="danger" data-action="details-delete" data-file-id="${document.id}">Delete</button>
			</div>
			<div class="details-actions">
				<button type="button" class="secondary" data-action="details-versions" data-file-id="${document.id}">View versions</button>
			</div>
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
	if (action === 'details-toggle-favorite') {
		await handleFileAction('favorite', fileId);
		const document = getDocumentById(fileId);
		if (document) {
			renderDetailsPanel(document);
		}
		return;
	}
	if (action === 'details-view') {
		await openDocument(fileId, 'view');
		return;
	}
	if (action === 'details-open') {
		await openDocument(fileId, 'edit');
		return;
	}
	if (action === 'details-share') {
		await createShare(fileId);
		return;
	}
	if (action === 'details-rename') {
		await renameDocument(fileId);
		await loadPage();
		openDetailsPanel(fileId);
		return;
	}
	if (action === 'details-copy') {
		await copyDocument(fileId);
		await loadPage();
		return;
	}
	if (action === 'details-download') {
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
	const query = elements.searchInput.value.trim().toLowerCase();
	if (!query) {
		appState.visibleDocuments = appState.documents;
		renderDocuments(appState.documents);
		return;
	}

	const filtered = appState.documents.filter((document) => (
		document.name.toLowerCase().includes(query) ||
		document.relativePath.toLowerCase().includes(query) ||
		String(document.mimeType || '').toLowerCase().includes(query)
	));
	appState.visibleDocuments = filtered;
	renderDocuments(filtered);
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

function enterEditorFullscreen() {
	setViewerMode('edit');
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
		appState.visibleDocuments = fileList.documents;
		elements.documentRoot.textContent = config.documentRoot;
		elements.appBaseUrl.textContent = config.appBaseUrl;
		elements.collaboraUrl.textContent = config.collaboraPublicUrl;
		applySearchFilter();
		setStatus(`Loaded ${fileList.documents.length} document${fileList.documents.length === 1 ? '' : 's'}.`);
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
	setStatus(`Creating ${type} document...`);
	try {
		const payload = await requestJson('/api/files', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: type, mode: 'edit' })
		});
		submitLaunchPayload(payload);
		setStatus(`Created and opened ${payload.file.name}.`);
		await loadPage();
	} catch (error) {
		setStatus(error.message, true);
	}
}

async function renameDocument(fileId, nextNameOverride) {
	const nextName = nextNameOverride || window.prompt('New file name (with extension):');
	if (!nextName) {
		return;
	}
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/move`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetName: nextName })
	});
}

async function copyDocument(fileId, targetNameOverride) {
	const targetName = targetNameOverride || window.prompt('Copy name (with extension):');
	if (!targetName) {
		return;
	}
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/copy`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetName: targetName || undefined })
	});
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
	const menu = document.createElement('div');
	menu.className = 'context-menu';
	menu.innerHTML = `
		<button type="button" data-context-action="favorite" data-file-id="${documentEntry.id}">${documentEntry.favorite ? 'Remove from favorites' : 'Add to favorites'}</button>
		<button type="button" data-context-action="details" data-file-id="${documentEntry.id}">Details</button>
		<button type="button" data-context-action="view" data-file-id="${documentEntry.id}">Preview (View)</button>
		<button type="button" data-context-action="rename" data-file-id="${documentEntry.id}">Rename</button>
		<button type="button" data-context-action="move-copy" data-file-id="${documentEntry.id}">Move or copy</button>
		<button type="button" data-context-action="save-as" data-file-id="${documentEntry.id}">Save as...</button>
		<button type="button" data-context-action="download" data-file-id="${documentEntry.id}">Download</button>
		<div class="context-menu-separator"></div>
		<button type="button" class="danger" data-context-action="delete" data-file-id="${documentEntry.id}">Delete file</button>
	`;
	for (const menuButton of menu.querySelectorAll('[data-context-action][data-file-id]')) {
		menuButton.addEventListener('click', function(event) {
			event.preventDefault();
			event.stopPropagation();
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
	for (const menuButton of document.querySelectorAll('.menu-button[aria-expanded="true"]')) {
		menuButton.setAttribute('aria-expanded', 'false');
	}
}

async function handleContextMenuAction(action, fileId) {
	if (action === 'favorite') {
		await handleFileAction('favorite', fileId);
		return;
	}
	if (action === 'details') {
		openDetailsPanel(fileId);
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
	if (action === 'move-copy') {
		const shouldMove = window.confirm('Move this document? Click Cancel to copy it instead.');
		if (shouldMove) {
			await renameDocument(fileId);
		} else {
			await copyDocument(fileId);
		}
		await loadPage();
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
		if (action === 'download') {
			window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
			return;
		}
		if (action === 'rename') {
			await renameDocument(fileId);
		} else if (action === 'copy') {
			await copyDocument(fileId);
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
setStatus(`Deleted ${selectedIds.length} selected file${selectedIds.length === 1 ? '' : 's'}.`);
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
elements.searchInput.addEventListener('input', applySearchFilter);
elements.closeViewerButton.addEventListener('click', function() {
closeViewer();
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
renderDocuments(visibleDocuments);
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
