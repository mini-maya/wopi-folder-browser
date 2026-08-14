const elements = {
	documentRoot: document.querySelector('#document-root'),
	appBaseUrl: document.querySelector('#app-base-url'),
	collaboraUrl: document.querySelector('#collabora-url'),
	statusMessage: document.querySelector('#status-message'),
	documentsBody: document.querySelector('#documents-body'),
	viewerTitle: document.querySelector('#viewer-title'),
	viewerSubtitle: document.querySelector('#viewer-subtitle'),
	closeViewerButton: document.querySelector('#close-viewer-button'),
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
	config: null,
	themeMode: 'auto'
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
			<td colspan="5">
				<div class="file-meta">No supported documents found. Create one with the New buttons.</div>
			</td>
		</tr>
	`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function renderDocuments(documents) {
	if (documents.length === 0) {
		renderEmptyState();
		return;
	}

	elements.documentsBody.innerHTML = documents.map(function(document) {
		const favoriteIcon = document.favorite ? '★' : '☆';
		return `
			<tr>
				<td>
					<div class="file-name">${escapeHtml(document.name)}</div>
					<div class="file-meta">${escapeHtml(document.mimeType)}</div>
				</td>
				<td>${escapeHtml(document.relativePath)}</td>
				<td>${formatDate(document.updatedAt)}</td>
				<td>${formatBytes(document.size)}</td>
				<td>
					<div class="actions">
						<button type="button" data-action="open" data-mode="edit" data-file-id="${document.id}">Open</button>
						<button type="button" class="secondary" data-action="open" data-mode="view" data-file-id="${document.id}">View</button>
						<button type="button" class="secondary" data-action="download" data-file-id="${document.id}">Download</button>
						<button type="button" class="secondary" data-action="favorite" data-file-id="${document.id}">${favoriteIcon}</button>
						<button type="button" class="secondary" data-action="rename" data-file-id="${document.id}">Rename</button>
						<button type="button" class="secondary" data-action="copy" data-file-id="${document.id}">Copy</button>
						<button type="button" class="secondary" data-action="versions" data-file-id="${document.id}">Versions</button>
						<button type="button" class="secondary" data-action="share" data-file-id="${document.id}">Share</button>
						<button type="button" class="danger" data-action="delete" data-file-id="${document.id}">Delete</button>
					</div>
				</td>
			</tr>
		`;
	}).join('');

	for (const button of elements.documentsBody.querySelectorAll('button[data-action][data-file-id]')) {
		button.addEventListener('click', function() {
			handleFileAction(button.dataset.action, button.dataset.fileId, button.dataset.mode);
		});
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
		renderDocuments(appState.documents);
		return;
	}

	const filtered = appState.documents.filter((document) => (
		document.name.toLowerCase().includes(query) ||
		document.relativePath.toLowerCase().includes(query) ||
		String(document.mimeType || '').toLowerCase().includes(query)
	));
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

async function renameDocument(fileId) {
	const nextName = window.prompt('New file name (with extension):');
	if (!nextName) {
		return;
	}
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/move`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetName: nextName })
	});
}

async function copyDocument(fileId) {
	const targetName = window.prompt('Copy name (with extension):');
	await requestJson(`/api/files/${encodeURIComponent(fileId)}/copy`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetName: targetName || undefined })
	});
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
elements.themeSelect.addEventListener('change', function(event) {
	applyThemeMode(event.target.value, true);
});

initializeTheme();
maybeLaunchPublicShare().then(function(launchedFromShare) {
	if (!launchedFromShare) {
		loadPage();
	}
});
