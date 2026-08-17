import { getFolderSelectionState, getFolderSizeBytes, getVisibleTreeEntries } from './fileBrowserTree.mjs';

const elements = {
	layout: document.querySelector('#app-layout'),
	layoutSplitter: document.querySelector('#layout-splitter'),
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
	uploadButton: document.querySelector('#upload-button'),
	myFilesButton: document.querySelector('#my-files-button'),
	sharedFilesButton: document.querySelector('#shared-files-button'),
	adminButton: document.querySelector('#admin-button'),
	accountButton: document.querySelector('#account-button'),
	loginButton: document.querySelector('#login-button'),
	logoutButton: document.querySelector('#logout-button'),
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
	folderPickerConfirm: document.querySelector('#folder-picker-confirm'),
	uploadModal: document.querySelector('#upload-modal'),
	uploadModalTitle: document.querySelector('#upload-modal-title'),
	uploadTargetLabel: document.querySelector('#upload-target-label'),
	uploadFileInput: document.querySelector('#upload-file-input'),
	uploadChooseButton: document.querySelector('#upload-choose-button'),
	uploadDropzone: document.querySelector('#upload-dropzone'),
	uploadSelectionSummary: document.querySelector('#upload-selection-summary'),
	uploadSelectionList: document.querySelector('#upload-selection-list'),
	uploadErrors: document.querySelector('#upload-errors'),
	uploadCancel: document.querySelector('#upload-cancel'),
	uploadConfirm: document.querySelector('#upload-confirm'),
	loginModal: document.querySelector('#login-modal'),
	loginCancel: document.querySelector('#login-cancel'),
	loginForm: document.querySelector('#login-form'),
	loginUsername: document.querySelector('#login-username'),
	loginPassword: document.querySelector('#login-password'),
	accountModal: document.querySelector('#account-modal'),
	accountCancel: document.querySelector('#account-cancel'),
	accountForm: document.querySelector('#account-form'),
	accountCurrentPassword: document.querySelector('#account-current-password'),
	accountNewPassword: document.querySelector('#account-new-password'),
	adminModal: document.querySelector('#admin-modal'),
	adminCancel: document.querySelector('#admin-cancel'),
	adminCreateUserForm: document.querySelector('#admin-create-user-form'),
	adminCreateUsername: document.querySelector('#admin-create-username'),
	adminCreateRole: document.querySelector('#admin-create-role'),
	adminCreatePassword: document.querySelector('#admin-create-password'),
	adminCreateGeneratePassword: document.querySelector('#admin-create-generate-password'),
	adminGeneratedPassword: document.querySelector('#admin-generated-password'),
	adminUsersBody: document.querySelector('#admin-users-body')
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
	versionRenameId: null,
	newDocumentType: null,
	newDocumentDirectory: '',
	contextMenuFileId: null,
	bulkActionsMenuOpen: false,
	newDocumentMenuOpen: false,
	uploadTargetDirectory: '',
	uploadItems: [],
	uploadErrors: [],
	uploadBusy: false,
	uploadDragActive: false,
	viewerOpen: false,
	viewerPanelWidth: 800,
	isResizingViewer: false,
	auth: {
		authenticated: false,
		user: null,
		storageContext: 'shared'
	},
	adminUsers: [],
	applyConflictToAll: false,
	integrationPendingData: null
};

const DEFAULT_VIEWER_TITLE = 'No document opened yet';
const DEFAULT_VIEWER_SUBTITLE = 'Choose a file from the list to open it in Collabora.';
const DEFAULT_VIEWER_WIDTH = 800;
const MIN_VIEWER_WIDTH = 480;
const MIN_SIDEBAR_WIDTH = 480;
const SPLITTER_WIDTH = 12;
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

function syncViewerLayout() {
	const layoutPadding = getLayoutHorizontalPadding();
	const layoutWidth = elements.layout.getBoundingClientRect().width - layoutPadding;
	const maximumWidth = Math.max(MIN_VIEWER_WIDTH, layoutWidth - SPLITTER_WIDTH - MIN_SIDEBAR_WIDTH);
	const width = appState.viewerOpen
		? Math.min(Math.max(MIN_VIEWER_WIDTH, appState.viewerPanelWidth), maximumWidth)
		: 0;
	appState.viewerPanelWidth = width;
	elements.layout.style.setProperty('--viewer-width', `${width}px`);
	elements.layout.style.gridTemplateColumns = appState.viewerOpen
		? `${width}px ${SPLITTER_WIDTH}px minmax(${MIN_SIDEBAR_WIDTH}px, 1fr)`
		: 'minmax(0, 1fr)';
	elements.layout.classList.toggle('viewer-open', appState.viewerOpen);
	elements.layoutSplitter.classList.toggle('hidden', !appState.viewerOpen);
}

function getLayoutHorizontalPadding() {
	const layoutStyles = window.getComputedStyle(elements.layout);
	return parseFloat(layoutStyles.paddingLeft) + parseFloat(layoutStyles.paddingRight);
}

function startViewerResize(event) {
	if (!appState.viewerOpen) {
		return;
	}
	appState.isResizingViewer = true;
	document.body.style.userSelect = 'none';
	document.body.style.cursor = 'col-resize';
	event.preventDefault();
	event.stopPropagation();
	elements.layoutSplitter.setPointerCapture?.(event.pointerId);
}

function updateViewerResize(event) {
	if (!appState.isResizingViewer) {
		return;
	}
	const layoutBounds = elements.layout.getBoundingClientRect();
	const layoutWidth = layoutBounds.width - getLayoutHorizontalPadding();
	const maximumWidth = Math.max(MIN_VIEWER_WIDTH, layoutWidth - SPLITTER_WIDTH - MIN_SIDEBAR_WIDTH);
	const nextWidth = Math.min(
		Math.max(MIN_VIEWER_WIDTH, event.clientX - layoutBounds.left - SPLITTER_WIDTH),
		maximumWidth
	);
	appState.viewerPanelWidth = nextWidth;
	syncViewerLayout();
}

function stopViewerResize() {
	if (!appState.isResizingViewer) {
		return;
	}
	appState.isResizingViewer = false;
	document.body.style.userSelect = '';
	document.body.style.cursor = '';
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

function normalizeUploadRelativePath(value) {
	return String(value || '')
		.replace(/\\/g, '/')
		.split('/')
		.filter(Boolean)
		.join('/');
}

function buildUploadDestinationPath(relativePath, targetDirectory) {
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

function getUploadTargetLabel() {
	return appState.uploadTargetDirectory || 'Root folder';
}

function getUploadSummaryLabel(count) {
	return count === 0
		? 'No files selected yet.'
		: `${count} file${count === 1 ? '' : 's'} ready to upload.`;
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
	if (mimeType.includes('spreadsheet') || mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) {
		return 'spreadsheet';
	}
	if (mimeType.includes('presentation') || mimeType.includes('presentationml') || mimeType.includes('ms-powerpoint')) {
		return 'presentation';
	}
	if (mimeType.includes('text') || mimeType.includes('csv') || mimeType.includes('wordprocessingml') || mimeType.includes('msword')) {
		return 'text';
	}
	return 'default';
}

function buildFilePreviewSvg(document) {
	const MIME_SVG_MAP = {
		spreadsheet: `
			<svg fill="#007C3C" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>LibreOffice Calc</title>
			<path d="M9 13H7v-1h2v1zm6-3h-2v1h2v-1zm-6 0H7v1h2v-1zm3 0h-2v1h2v-1zm3-10 7 7V0h-7zM9 14H7v1h2v-1zm5 3h1v-3h-1v3zm2 0h1v-1h-1v1zm-4 0h1v-2h-1v2zm1-17 9 9v12c0 1.662-1.338 3-3 3H5c-1.662 0-3-1.338-3-3V3c0-1.662 1.338-3 3-3h8zm5 13h-7v5h7v-5zm-2-4H6v7h4.5v-1H10v-1h.5v-1H10v-1h2v.5h1V12h2v.5h1V9z"/>
			</svg>
		`,
		text: `
			<svg fill="#083FA6" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>LibreOffice Writer</title>
            <path d="M22 0v7l-7-7h7zm0 9v12c0 1.662-1.338 3-3 3H5c-1.662 0-3-1.338-3-3V3c0-1.662 1.338-3 3-3h8l9 9zM6 10h5V9H6v1zm0 2h5v-1H6v1zm0 2h5v-1H6v1zm5 3H6v1h5v-1zm7-2H6v1h12v-1zm0-6h-6v5h6V9zm-1.5 2a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zM14 11l-1 2h3l-2-2z"/>
            </svg>
		`,
		presentation: `
			<svg fill="#D0120D" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>LibreOffice Impress</title><path d="M22 0v7l-7-7h7zm-9 0 9 9v12c0 1.662-1.338 3-3 3H5c-1.662 0-3-1.338-3-3V3c0-1.662 1.338-3 3-3h8zM7 17H6v1h1v-1zm0-2H6v1h1v-1zm0-2H6v1h1v-1zm3 4H8v1h2v-1zm0-2H8v1h2v-1zm0-2H8v1h2v-1zm6-1v-1H8v1h8zm2 1h-7v5h7v-5zm0-4H6v1h12V9zm-4 6.707 1 1 2.207-2.207-.707-.707-1.5 1.5-1-1-2.207 2.207.707.707 1.5-1.5z"/>
			</svg>
		`,
		default: `
			<svg fill="#7324A9" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>LibreOffice Base</title><path d="M17 13h-1v-1h1v1zm0 1h-1v1h1v-1zm0 2h-1v1h1v-1zm-.6-16H15l7 7V0h-5.6zM13 0l9 9v12c0 1.662-1.338 3-3 3H5c-1.662 0-3-1.338-3-3V3c0-1.662 1.338-3 3-3h8zM6 11c0 .552 1.343 1 3 1s3-.448 3-1v-1c0-.552-1.343-1-3-1s-3 .448-3 1v1zm0 2c0 .552 1.343 1 3 1s3-.448 3-1v-1c0 .552-1.343 1-3 1s-3-.448-3-1v1zm0 2c0 .552 1.343 1 3 1s3-.448 3-1v-1c0 .552-1.343 1-3 1s-3-.448-3-1v1zm0 2c0 .552 1.343 1 3 1s3-.448 3-1v-1c0 .552-1.343 1-3 1s-3-.448-3-1v1zm12-6h-5v7h5v-7zm-3 1h-1v1h1v-1zm0 4h-1v1h1v-1zm0-2h-1v1h1v-1z"/>
			</svg>
		`
	};
	const typeKey = getFileTypeKey(document);
	const svg = MIME_SVG_MAP[typeKey];
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
				<button type="button" class="danger" data-action="details-delete" data-file-id="${document.id}">Delete</button>
			`
		: `
				<button type="button" data-action="details-view" data-file-id="${document.id}">View</button>
				<button type="button" class="secondary" data-action="details-open" data-file-id="${document.id}">Open</button>
				<button type="button" class="secondary" data-action="details-save-as" data-file-id="${document.id}">Save as...</button>
				<button type="button" class="secondary" data-action="details-share" data-file-id="${document.id}">Share</button>
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
					menuEntries.push({ label: 'View', action: 'version-view', danger: false });
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
			const initialName = await getVersionLabel(fileId, versionId);
			openNameEntryDialog({
				action: 'version-rename',
				title: 'Rename this version',
				buttonText: 'Save',
				defaultValue: initialName || '',
				fileId,
				directory: '',
				versionId
			});
			return;
		}
		case 'version-view': {
			const language = navigator.language || 'en-US';
			const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/view?lang=${encodeURIComponent(language)}`);
			submitLaunchPayload(payload);
			return;
		}
		case 'version-name-current': {
			const initialName = await getVersionLabel(fileId, versionId);
			openNameEntryDialog({
				action: 'version-name-current',
				title: 'Name the current version',
				buttonText: 'Save',
				defaultValue: initialName || '',
				fileId,
				directory: '',
				versionId
			});
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

function formatConflictItemSummary(entry) {
	if (!entry) {
		return 'Unknown item';
	}
	const typeLabel = entry.type === 'directory' ? 'Folder' : 'File';
	const sizeLabel = entry.size != null ? ` · ${formatBytes(entry.size)}` : '';
	const modifiedLabel = entry.modifiedAt ? ` · ${formatDate(entry.modifiedAt)}` : '';
	return `${entry.name || 'Untitled'} · ${typeLabel}${sizeLabel}${modifiedLabel}`;
}

async function showConflictDialog(conflict, operationLabel) {
	return new Promise((resolve) => {
		const isDirectoryConflict = conflict?.conflictType === 'directory' || conflict?.source?.type === 'directory' || conflict?.target?.type === 'directory';
		const title = isDirectoryConflict ? 'Folder already exists' : 'File already exists';
		const description = isDirectoryConflict
			? 'A folder with this name already exists at the target location. Choose how to continue.'
			: 'A file with this name already exists at the target location. Choose how to continue.';
		const actionButtons = isDirectoryConflict
			? '<button type="button" data-conflict-action="replace">Replace folder</button>' +
				'<button type="button" data-conflict-action="integrate" class="secondary">Integrate folder</button>' +
				'<button type="button" data-conflict-action="skip" class="secondary">Skip</button>'
			: '<button type="button" data-conflict-action="overwrite">Overwrite</button>' +
				'<button type="button" data-conflict-action="keep_both" class="secondary">Keep both</button>' +
				'<button type="button" data-conflict-action="skip" class="secondary">Skip</button>';
		const sourceParentPath = (conflict?.source?.relativePath || '').includes('/')
			? (conflict.source.relativePath || '').slice(0, (conflict.source.relativePath || '').lastIndexOf('/'))
			: '';
		const targetParentPath = (conflict?.target?.relativePath || '').includes('/')
			? (conflict.target.relativePath || '').slice(0, (conflict.target.relativePath || '').lastIndexOf('/'))
			: '';
		const modal = document.createElement('div');
		modal.className = 'modal';
		modal.setAttribute('aria-hidden', 'false');
		modal.innerHTML = `
			<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="conflict-dialog-title">
				<div class="modal-header">
					<div>
						<h3 id="conflict-dialog-title">${title}</h3>
						<p class="modal-description">${escapeHtml(operationLabel || 'This operation')} will decide how the existing item is handled.</p>
					</div>
					<button type="button" class="secondary" data-conflict-action="cancel">Cancel</button>
				</div>
				<div class="modal-body">
					<p class="file-meta">${description}</p>
					<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 16px 0;">
						<div class="details-card" style="padding: 12px; border: 1px solid var(--border-color, rgba(255,255,255,0.12)); border-radius: 12px;">
							<strong>Source</strong>
							<div>Name: <strong>${escapeHtml(conflict?.source?.name || 'Unknown')}</strong></div>
							${sourceParentPath ? `<div>Path: <strong>${escapeHtml(sourceParentPath)}</strong></div>` : ''}
							<div>Type: <strong>${escapeHtml(conflict?.source?.type === 'directory' ? 'Folder' : 'File')}</strong></div>
							<div>Size: <strong>${conflict?.source?.size != null ? escapeHtml(formatBytes(conflict.source.size)) : '—'}</strong></div>
							<div>Modified at: <strong>${conflict?.source?.modifiedAt ? escapeHtml(formatDate(conflict.source.modifiedAt)) : '—'}</strong></div>
						</div>
						<div class="details-card" style="padding: 12px; border: 1px solid var(--border-color, rgba(255,255,255,0.12)); border-radius: 12px;">
							<strong>Existing target</strong>
							<div>Name: <strong>${escapeHtml(conflict?.target?.name || 'Unknown')}</strong></div>
							${targetParentPath ? `<div>Path: <strong>${escapeHtml(targetParentPath)}</strong></div>` : ''}
							<div>Type: <strong>${escapeHtml(conflict?.target?.type === 'directory' ? 'Folder' : 'File')}</strong></div>
							<div>Size: <strong>${conflict?.target?.size != null ? escapeHtml(formatBytes(conflict.target.size)) : '—'}</strong></div>
							<div>Modified at: <strong>${conflict?.target?.modifiedAt ? escapeHtml(formatDate(conflict.target.modifiedAt)) : '—'}</strong></div>
						</div>
					</div>
					<label class="checkbox-field" style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
						<input type="checkbox" id="conflict-apply-all">
						<span>Apply to all conflicts in this batch</span>
					</label>
					<div class="modal-actions" style="justify-content:flex-start; gap: 8px; flex-wrap: wrap;">
						${actionButtons}
					</div>
				</div>
			</div>
		`;
		const close = () => {
			modal.remove();
		};
		for (const button of modal.querySelectorAll('[data-conflict-action]')) {
			button.addEventListener('click', function() {
				const action = button.dataset.conflictAction;
				const applyToAll = !!modal.querySelector('#conflict-apply-all')?.checked;
				appState.applyConflictToAll = applyToAll;
				close();
				if (action === 'cancel') {
					resolve(null);
					return;
				}
				resolve(action);
			});
		}
		document.body.appendChild(modal);
		const applyAllCheckbox = modal.querySelector('#conflict-apply-all');
		if (applyAllCheckbox) {
			applyAllCheckbox.addEventListener('change', function() {
				appState.applyConflictToAll = applyAllCheckbox.checked;
			});
		}
	});
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
		const error = new Error(message);
		error.status = response.status;
		error.payload = payload;
		throw error;
	}

	return payload;
}

function renderAuthControls() {
	const authenticated = Boolean(appState.auth?.authenticated);
	const role = appState.auth?.user?.role || 'user';
	const currentContext = appState.auth?.storageContext || 'shared';

	elements.loginButton.classList.toggle('hidden', authenticated);
	elements.logoutButton.classList.toggle('hidden', !authenticated);
	elements.accountButton.classList.toggle('hidden', !authenticated);
	elements.adminButton.classList.toggle('hidden', !(authenticated && role === 'admin'));
	elements.myFilesButton.classList.toggle('hidden', !authenticated);
	elements.sharedFilesButton.classList.toggle('hidden', !authenticated);
	elements.myFilesButton.disabled = !authenticated || currentContext === 'personal';
	elements.sharedFilesButton.disabled = !authenticated || currentContext === 'shared';
}

function applyPasswordPolicyToForms(minLength) {
	const effectiveMinLength = Number.isInteger(minLength) && minLength > 0 ? minLength : 12;
	elements.accountNewPassword.minLength = effectiveMinLength;
	elements.adminCreatePassword.minLength = effectiveMinLength;
	elements.accountNewPassword.placeholder = `At least ${effectiveMinLength} characters`;
	elements.adminCreatePassword.placeholder = `At least ${effectiveMinLength} characters`;
}

async function refreshAuthState() {
	appState.auth = await requestJson('/api/auth/me');
	renderAuthControls();
}

function openModal(modalElement) {
	modalElement.classList.remove('hidden');
	modalElement.setAttribute('aria-hidden', 'false');
}

function closeModal(modalElement) {
	modalElement.classList.add('hidden');
	modalElement.setAttribute('aria-hidden', 'true');
}

function openLoginModal() {
	elements.loginForm.reset();
	openModal(elements.loginModal);
	elements.loginUsername.focus();
}

async function submitLoginForm(event) {
	event.preventDefault();
	const username = elements.loginUsername.value.trim();
	const password = elements.loginPassword.value;
	if (!username || !password) {
		setStatus('Username and password are required.', true);
		return;
	}
	await requestJson('/api/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: username, password: password })
	});
	closeModal(elements.loginModal);
	await loadPage();
	if (appState.auth?.user?.must_change_password) {
		openAccountModal();
		setStatus('Please change your password now.', true);
	}
}

async function logoutCurrentUser() {
	await requestJson('/api/auth/logout', { method: 'POST' });
	await closeViewer();
	await loadPage();
}

async function switchStorageContext(context) {
	await requestJson('/api/auth/storage-context', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ context: context })
	});
	await loadPage();
}

function openAccountModal() {
	elements.accountForm.reset();
	openModal(elements.accountModal);
	elements.accountCurrentPassword.focus();
}

async function submitAccountForm(event) {
	event.preventDefault();
	const currentPassword = elements.accountCurrentPassword.value;
	const newPassword = elements.accountNewPassword.value;
	if (!currentPassword || !newPassword) {
		setStatus('Current and new password are required.', true);
		return;
	}
	await requestJson('/api/auth/change-password', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			currentPassword: currentPassword,
			newPassword: newPassword
		})
	});
	closeModal(elements.accountModal);
	setStatus('Password updated.');
	await refreshAuthState();
}

function renderAdminUsers() {
	elements.adminUsersBody.innerHTML = '';
	if (appState.adminUsers.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 5;
		cell.textContent = 'No users found.';
		row.appendChild(cell);
		elements.adminUsersBody.appendChild(row);
		return;
	}

	for (const user of appState.adminUsers) {
		const row = document.createElement('tr');
		const usernameCell = document.createElement('td');
		usernameCell.textContent = user.username;
		const roleCell = document.createElement('td');
		roleCell.textContent = user.role;
		const statusCell = document.createElement('td');
		statusCell.textContent = user.active ? 'active' : 'disabled';
		const createdCell = document.createElement('td');
		createdCell.textContent = formatDate(user.created_at);
		const actionsCell = document.createElement('td');
		const actionContainer = document.createElement('div');
		actionContainer.className = 'admin-user-actions';

		const toggleButton = document.createElement('button');
		toggleButton.type = 'button';
		toggleButton.className = 'secondary';
		toggleButton.textContent = user.active ? 'Disable' : 'Enable';
		toggleButton.addEventListener('click', async function() {
			try {
				await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ active: !user.active })
				});
				await loadAdminUsers();
			} catch (error) {
				setStatus(error.message, true);
			}
		});

		const resetButton = document.createElement('button');
		resetButton.type = 'button';
		resetButton.className = 'secondary';
		resetButton.textContent = 'Reset password';
		resetButton.addEventListener('click', async function() {
			try {
				const payload = await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ generatePassword: true })
				});
				const generated = payload.generatedPassword ? `New password (show once): ${payload.generatedPassword}` : 'Password reset.';
				elements.adminGeneratedPassword.textContent = generated;
				elements.adminGeneratedPassword.classList.remove('hidden');
			} catch (error) {
				setStatus(error.message, true);
			}
		});

		const deleteButton = document.createElement('button');
		deleteButton.type = 'button';
		deleteButton.className = 'danger';
		deleteButton.textContent = 'Delete';
		deleteButton.disabled = appState.auth?.user?.id === user.id;
		deleteButton.addEventListener('click', async function() {
			try {
				await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
				await loadAdminUsers();
			} catch (error) {
				setStatus(error.message, true);
			}
		});

		actionContainer.append(toggleButton, resetButton, deleteButton);
		actionsCell.appendChild(actionContainer);
		row.append(usernameCell, roleCell, statusCell, createdCell, actionsCell);
		elements.adminUsersBody.appendChild(row);
	}
}

async function loadAdminUsers() {
	const payload = await requestJson('/api/admin/users');
	appState.adminUsers = payload.users || [];
	renderAdminUsers();
}

async function openAdminUserManagement() {
	elements.adminGeneratedPassword.textContent = '';
	elements.adminGeneratedPassword.classList.add('hidden');
	elements.adminCreateUserForm.reset();
	elements.adminCreateGeneratePassword.checked = true;
	elements.adminCreatePassword.disabled = true;
	await loadAdminUsers();
	openModal(elements.adminModal);
}

async function submitAdminCreateUserForm(event) {
	event.preventDefault();
	const username = elements.adminCreateUsername.value.trim();
	const role = elements.adminCreateRole.value === 'admin' ? 'admin' : 'user';
	const generate = elements.adminCreateGeneratePassword.checked;
	const password = elements.adminCreatePassword.value;
	if (!username) {
		setStatus('Username is required.', true);
		return;
	}
	if (!generate && !password) {
		setStatus('Password is required if generation is disabled.', true);
		return;
	}
	const payload = await requestJson('/api/admin/users', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username: username,
			role: role,
			generatePassword: generate,
			password: generate ? undefined : password
		})
	});
	elements.adminGeneratedPassword.textContent = payload.generatedPassword
		? `Initial password (show once): ${payload.generatedPassword}`
		: 'User created.';
	elements.adminGeneratedPassword.classList.remove('hidden');
	elements.adminCreateUserForm.reset();
	elements.adminCreateGeneratePassword.checked = true;
	elements.adminCreatePassword.disabled = true;
	await loadAdminUsers();
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
	appState.viewerPanelWidth = DEFAULT_VIEWER_WIDTH;
	appState.viewerOpen = true;
	syncViewerLayout();
	setViewerMode(payload.mode);
	elements.collaboraForm.requestSubmit();
}

function isShareSessionPath() {
	return window.location.pathname.startsWith('/share/');
}

function setViewerMode(mode) {
	const isShareSession = isShareSessionPath();
	const isFullscreenMode = isShareSession || mode === 'edit';
	document.body.classList.toggle('share-session', isShareSession);
	document.body.classList.toggle('editor-fullscreen', isFullscreenMode);
	if (isShareSession) {
		elements.closeViewerButton.classList.add('hidden');
		elements.closeViewerButton.setAttribute('aria-label', 'Close shared document');
		return;
	}
	elements.closeViewerButton.classList.toggle('hidden', !appState.viewerOpen);
	elements.closeViewerButton.setAttribute('aria-label', 'Close document');
}

async function closeViewer() {
	document.body.classList.remove('editor-fullscreen');
	if (isShareSessionPath()) {
		document.body.classList.add('share-session');
		elements.closeViewerButton.classList.add('hidden');
		try {
			window.close();
		} catch (error) {
			// Browsers may block programmatic tab-closing; fall back to the blank share state.
		}
		elements.viewerTitle.textContent = DEFAULT_VIEWER_TITLE;
		elements.viewerSubtitle.textContent = DEFAULT_VIEWER_SUBTITLE;
		elements.viewerFrame.src = 'about:blank';
		setStatus('Share session closed.');
		return;
	}
	document.body.classList.remove('share-session');
	appState.viewerOpen = false;
	syncViewerLayout();
	elements.closeViewerButton.classList.add('hidden');
	elements.viewerTitle.textContent = DEFAULT_VIEWER_TITLE;
	elements.viewerSubtitle.textContent = DEFAULT_VIEWER_SUBTITLE;
	elements.viewerFrame.src = 'about:blank';
	window.history.replaceState(null, '', '/');
	await loadPage();
	setStatus('Closed document.');
}

async function loadPage() {
	setStatus('Loading documents...');
	try {
		const [authState, config, fileList] = await Promise.all([
			requestJson('/api/auth/me'),
			requestJson('/api/config'),
			requestJson('/api/files')
		]);

		appState.auth = authState;
		appState.config = config;
		appState.documents = fileList.documents;
		appState.auth.storageContext = config.storageContext || appState.auth.storageContext || 'shared';
		applyPasswordPolicyToForms(config.passwordMinLength);
		renderAuthControls();
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

async function createDocumentInDirectory(type, directory) {
	openNameEntryDialog({
		action: 'new-document',
		title: getCreateDocumentDialogTitle(type),
		buttonText: 'Create',
		defaultValue: getDefaultDocumentNameByType(type),
		fileId: null,
		directory: directory || '',
		documentType: type
	});
}

async function createFolderInDirectory(directory) {
	openNameEntryDialog({
		action: 'new-folder',
		title: 'Create new folder',
		buttonText: 'Create folder',
		defaultValue: '',
		directory: directory || '',
		fileId: null
	});
}

async function moveDocument(fileId, targetNameOverride, targetDirectoryOverride) {
	if (!targetNameOverride) {
		setStatus('A target name is required for this move operation.', true);
		return;
	}
	try {
		await requestJson(`/api/files/${encodeURIComponent(fileId)}/move`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				targetDirectory: targetDirectoryOverride,
				targetName: targetNameOverride || undefined,
				...(appState.integrationPendingData || {})
			})
		});
		await loadPage();
		setStatus('Moved successfully.');
		appState.integrationPendingData = null;
	} catch (error) {
		if (error?.payload?.error === 'FILE_CONFLICT') {
			const resolution = await showConflictDialog(error.payload, 'Move');
			if (!resolution) {
				appState.integrationPendingData = null;
				return;
			}
			const isDirectoryConflict = error?.payload?.conflictType === 'directory';
			const isIntegrating = appState.integrationPendingData?.conflictResolution === 'integrate';
			if (isDirectoryConflict && isIntegrating) {
				if (appState.applyConflictToAll) {
					appState.integrationPendingData.directoryConflictResolution = resolution;
					delete appState.integrationPendingData.directoryConflictResolutions;
				} else {
					const conflictPath = error?.payload?.target?.relativePath;
					if (conflictPath) {
						if (!appState.integrationPendingData.directoryConflictResolutions) {
							appState.integrationPendingData.directoryConflictResolutions = {};
						}
						appState.integrationPendingData.directoryConflictResolutions[conflictPath] = resolution;
					} else {
						appState.integrationPendingData.directoryConflictResolution = resolution;
					}
				}
			} else if (isDirectoryConflict) {
				appState.integrationPendingData = { conflictResolution: resolution };
			} else if (isIntegrating) {
				if (appState.applyConflictToAll) {
					appState.integrationPendingData.fileConflictResolution = resolution;
					delete appState.integrationPendingData.fileConflictResolutions;
				} else {
					const conflictPath = error?.payload?.target?.relativePath;
					if (conflictPath) {
						if (!appState.integrationPendingData.fileConflictResolutions) {
							appState.integrationPendingData.fileConflictResolutions = {};
						}
						appState.integrationPendingData.fileConflictResolutions[conflictPath] = resolution;
					} else {
						appState.integrationPendingData.fileConflictResolution = resolution;
					}
				}
			} else {
				appState.integrationPendingData = { conflictResolution: resolution };
			}
			await moveDocument(fileId, targetNameOverride, targetDirectoryOverride);
			return;
		}
		appState.integrationPendingData = null;
		throw error;
	}
}

async function copyDocument(fileId, targetNameOverride, targetDirectoryOverride) {
	if (!targetNameOverride) {
		setStatus('A target name is required for this copy operation.', true);
		return;
	}
	try {
		await requestJson(`/api/files/${encodeURIComponent(fileId)}/copy`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				targetDirectory: targetDirectoryOverride,
				targetName: targetNameOverride || undefined,
				...(appState.integrationPendingData || {})
			})
		});
		await loadPage();
		setStatus('Copied successfully.');
		appState.integrationPendingData = null;
	} catch (error) {
		if (error?.payload?.error === 'FILE_CONFLICT') {
			const resolution = await showConflictDialog(error.payload, 'Copy');
			if (!resolution) {
				appState.integrationPendingData = null;
				return;
			}
			const isDirectoryConflict = error?.payload?.conflictType === 'directory';
			const isIntegrating = appState.integrationPendingData?.conflictResolution === 'integrate';
			if (isDirectoryConflict && isIntegrating) {
				if (appState.applyConflictToAll) {
					appState.integrationPendingData.directoryConflictResolution = resolution;
					delete appState.integrationPendingData.directoryConflictResolutions;
				} else {
					const conflictPath = error?.payload?.target?.relativePath;
					if (conflictPath) {
						if (!appState.integrationPendingData.directoryConflictResolutions) {
							appState.integrationPendingData.directoryConflictResolutions = {};
						}
						appState.integrationPendingData.directoryConflictResolutions[conflictPath] = resolution;
					} else {
						appState.integrationPendingData.directoryConflictResolution = resolution;
					}
				}
			} else if (isDirectoryConflict) {
				appState.integrationPendingData = { conflictResolution: resolution };
			} else if (isIntegrating) {
				if (appState.applyConflictToAll) {
					appState.integrationPendingData.fileConflictResolution = resolution;
					delete appState.integrationPendingData.fileConflictResolutions;
				} else {
					const conflictPath = error?.payload?.target?.relativePath;
					if (conflictPath) {
						if (!appState.integrationPendingData.fileConflictResolutions) {
							appState.integrationPendingData.fileConflictResolutions = {};
						}
						appState.integrationPendingData.fileConflictResolutions[conflictPath] = resolution;
					} else {
						appState.integrationPendingData.fileConflictResolution = resolution;
					}
				}
			} else {
				appState.integrationPendingData = { conflictResolution: resolution };
			}
			await copyDocument(fileId, targetNameOverride, targetDirectoryOverride);
			return;
		}
		appState.integrationPendingData = null;
		throw error;
	}
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

function selectBasenameForInput(input, value) {
	if (!input || !value) {
		return;
	}
	const fileName = value.trim();
	const parsedName = fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;
	if (!parsedName || fileName.startsWith('.')) {
		return;
	}
	const start = 0;
	const end = parsedName.length;
	input.setSelectionRange(start, end);
}

async function getVersionLabel(fileId, versionId) {
	const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions`);
	const version = payload.versions.find((entry) => entry.id === versionId);
	return version?.label ?? '';
}

function getDefaultDocumentNameByType(type) {
	const configuredDefaults = appState.config?.defaultDocumentNames || {};
	const extension = type === 'spreadsheet' ? '.ods'
		: type === 'presentation' ? '.odp'
			: type === 'microsoft-text' ? '.docx'
				: type === 'microsoft-spreadsheet' ? '.xlsx'
					: type === 'microsoft-presentation' ? '.pptx'
						: '.odt';
	const fallbackBaseName = type === 'spreadsheet' || type === 'microsoft-spreadsheet'
		? 'Untitled spreadsheet'
		: type === 'presentation' || type === 'microsoft-presentation'
			? 'Untitled presentation'
			: 'Untitled document';
	const configuredName = configuredDefaults[type] || `${fallbackBaseName}${extension}`;
	return configuredName.endsWith(extension) ? configuredName : `${configuredName}${extension}`;
}

function getCreateDocumentDialogTitle(type) {
	return type === 'spreadsheet'
		? 'Create new spreadsheet'
		: type === 'presentation'
			? 'Create new presentation'
			: type === 'microsoft-text'
				? 'Create new Microsoft Word document'
				: type === 'microsoft-spreadsheet'
					? 'Create new Microsoft Excel spreadsheet'
					: type === 'microsoft-presentation'
						? 'Create new Microsoft PowerPoint presentation'
						: 'Create new text document';
}

function openNameEntryDialog({ action, title, buttonText, defaultValue, fileId, directory, versionId, documentType }) {
	const documentEntry = fileId ? getDocumentById(fileId) : null;
	const needsTargetDirectory = action === 'new-folder' || action === 'save-as';
	appState.folderPickerAction = action;
	appState.folderPickerSelectionIds = fileId ? [fileId] : [];
	appState.folderPickerBulkMode = false;
	appState.versionRenameId = versionId ?? null;
	appState.newDocumentType = documentType ?? null;
	appState.newDocumentDirectory = directory || '';
	elements.folderPickerModal.classList.remove('hidden');
	elements.folderPickerModal.setAttribute('aria-hidden', 'false');
	elements.folderPickerTitle.textContent = title;
	elements.folderPickerConfirm.textContent = buttonText;
	elements.folderPickerTarget.closest('.modal-field').classList.toggle('hidden', !needsTargetDirectory);
	elements.folderPickerName.closest('.modal-field').classList.remove('hidden');
	if (needsTargetDirectory) {
		const options = getFolderOptions();
		elements.folderPickerTarget.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
		const preferredTarget = directory || (documentEntry && documentEntry.relativePath.includes('/')
			? documentEntry.relativePath.slice(0, documentEntry.relativePath.lastIndexOf('/'))
			: '');
		elements.folderPickerTarget.value = options.some((option) => option.value === preferredTarget) ? preferredTarget : '';
	} else {
		elements.folderPickerTarget.innerHTML = '';
	}
	elements.folderPickerName.value = defaultValue ?? '';
	elements.folderPickerName.focus();
	prepareFolderPickerNameSelection();
}

function prepareFolderPickerNameSelection() {
	if (!appState.folderPickerAction) {
		return;
	}
	const selectedDocument = appState.folderPickerSelectionIds[0]
		? getDocumentById(appState.folderPickerSelectionIds[0])
		: null;
	if (
		appState.folderPickerAction === 'save-as'
		|| appState.folderPickerAction === 'new-document'
		|| (selectedDocument && !isFolderEntry(selectedDocument))
	) {
		selectBasenameForInput(elements.folderPickerName, elements.folderPickerName.value);
	}
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
	elements.folderPickerConfirm.textContent = action === 'move' ? 'Move' : (action === 'save-as' ? 'Save' : 'Copy');
	elements.folderPickerTitle.textContent = isBulkMode
		? (action === 'move' ? 'Move selected items to folder' : (action === 'save-as' ? 'Save selected item as' : 'Copy selected items to folder'))
		: (action === 'move' ? 'Move to folder' : (action === 'save-as' ? 'Save copy as' : 'Copy to folder'));
	elements.folderPickerTarget.closest('.modal-field').classList.remove('hidden');
	elements.folderPickerName.closest('.modal-field').classList.toggle('hidden', isBulkMode);
	populateFolderPicker(selectedDocuments[0], action === 'save-as' ? false : isBulkMode);
	if (action === 'save-as') {
		elements.folderPickerTarget.value = selectedDocuments[0]?.relativePath.includes('/')
			? selectedDocuments[0].relativePath.slice(0, selectedDocuments[0].relativePath.lastIndexOf('/'))
			: '';
		elements.folderPickerName.value = selectedDocuments[0]?.name ?? '';
	}
	if (isBulkMode) {
		elements.folderPickerTarget.focus();
	} else {
		elements.folderPickerName.focus();
	}
	prepareFolderPickerNameSelection();
}

function closeFolderTargetDialog() {
	appState.folderPickerAction = null;
	appState.folderPickerSelectionIds = [];
	appState.folderPickerBulkMode = false;
	appState.versionRenameId = null;
	appState.newDocumentType = null;
	appState.newDocumentDirectory = '';
	elements.folderPickerModal.classList.add('hidden');
	elements.folderPickerModal.setAttribute('aria-hidden', 'true');
}

async function submitFolderTargetDialog(event) {
	event.preventDefault();
	const action = appState.folderPickerAction;
	if (!action) {
		return;
	}
	const targetDirectory = elements.folderPickerTarget.value;
	const targetName = elements.folderPickerName.value.trim();
	if (!targetName) {
		setStatus('Please enter a name.', true);
		return;
	}

	switch (action) {
		case 'new-document': {
			if (!appState.newDocumentType) {
				setStatus('Document type is missing for this creation action.', true);
				return;
			}
			setStatus(`Creating ${appState.newDocumentType} document...`);
			const payload = await requestJson('/api/files', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: appState.newDocumentType,
					fileName: targetName,
					directory: appState.newDocumentDirectory || undefined,
					mode: 'edit'
				})
			});
			submitLaunchPayload(payload);
			await loadPage();
			closeFolderTargetDialog();
			setStatus(`Created and opened ${payload.file.name}.`);
			return;
		}
		case 'new-folder': {
			await requestJson('/api/folders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					directory: targetDirectory || undefined,
					folderName: targetName
				})
			});
			await loadPage();
			closeFolderTargetDialog();
			setStatus('Folder created.');
			return;
		}
		case 'version-rename': {
			const fileId = appState.folderPickerSelectionIds[0];
			if (!fileId) {
				return;
			}
			await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(appState.versionRenameId || '')}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: targetName })
			});
			await renderVersionList(fileId);
			closeFolderTargetDialog();
			setStatus('Version renamed.');
			return;
		}
		case 'version-name-current': {
			const fileId = appState.folderPickerSelectionIds[0];
			if (!fileId) {
				return;
			}
			await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(appState.versionRenameId || '')}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: targetName })
			});
			await renderVersionList(fileId);
			closeFolderTargetDialog();
			setStatus('Current version named.');
			return;
		}
		default: {
			const selectionIds = appState.folderPickerSelectionIds;
			const isBulkMode = appState.folderPickerBulkMode;
			const documents = selectionIds
				.map((fileId) => getDocumentById(fileId))
				.filter(Boolean);
			if (!documents.length) {
				return;
			}
			try {
				if (isBulkMode) {
					if (action === 'move') {
						await moveDocuments(documents, targetDirectory);
					} else {
						await copyDocuments(documents, targetDirectory);
					}
				} else {
					const fileId = selectionIds[0];
					if (action === 'move') {
						await moveDocument(fileId, targetName, targetDirectory);
					} else if (action === 'save-as') {
						await copyDocument(fileId, targetName, targetDirectory);
					} else {
						await copyDocument(fileId, targetName, targetDirectory);
					}
				}
			} catch (error) {
				setStatus(error.message, true);
				return;
			}
			await loadPage();
			closeFolderTargetDialog();
			setStatus(isBulkMode
				? (action === 'move' ? 'Selected items moved.' : 'Selected items copied.')
				: (action === 'move' ? 'Entry moved.' : 'Entry copied.'));
			return;
		}
	}
}

function renderUploadDialog() {
	const uploadCount = appState.uploadItems.length;
	elements.uploadTargetLabel.textContent = getUploadTargetLabel();
	elements.uploadSelectionSummary.textContent = getUploadSummaryLabel(uploadCount);
	elements.uploadConfirm.disabled = uploadCount === 0 || appState.uploadBusy;
	elements.uploadChooseButton.disabled = appState.uploadBusy;
	elements.uploadCancel.disabled = appState.uploadBusy;
	elements.uploadConfirm.textContent = appState.uploadBusy ? 'Uploading...' : 'Upload';
	elements.uploadDropzone.classList.toggle('drag-active', appState.uploadDragActive);
	elements.uploadDropzone.classList.toggle('is-busy', appState.uploadBusy);

	if (uploadCount === 0) {
		elements.uploadSelectionList.innerHTML = '<li class="upload-list-empty">Choose files or drop them here.</li>';
	} else {
		elements.uploadSelectionList.innerHTML = appState.uploadItems.map((item) => `
			<li class="upload-selection-item">
				<strong>${escapeHtml(item.relativePath)}</strong>
				<span>${formatBytes(item.file.size)}</span>
			</li>
		`).join('');
	}

	if (appState.uploadErrors.length === 0) {
		elements.uploadErrors.classList.add('hidden');
		elements.uploadErrors.innerHTML = '';
		return;
	}

	elements.uploadErrors.classList.remove('hidden');
	elements.uploadErrors.innerHTML = `
		<strong>Upload problems</strong>
		<ul>
			${appState.uploadErrors.map((entry) => `<li>${escapeHtml(entry.relativePath ? `${entry.relativePath}: ${entry.message}` : entry.message)}</li>`).join('')}
		</ul>
	`;
}

function openUploadDialog(targetDirectory = '') {
	closeOpenContextMenu();
	appState.uploadTargetDirectory = targetDirectory || '';
	appState.uploadItems = [];
	appState.uploadErrors = [];
	appState.uploadBusy = false;
	appState.uploadDragActive = false;
	elements.uploadFileInput.value = '';
	elements.uploadModalTitle.textContent = appState.uploadTargetDirectory ? 'Upload to folder' : 'Upload to root folder';
	elements.uploadModal.classList.remove('hidden');
	elements.uploadModal.setAttribute('aria-hidden', 'false');
	renderUploadDialog();
	elements.uploadChooseButton.focus();
}

function closeUploadDialog() {
	if (appState.uploadBusy) {
		return;
	}

	appState.uploadTargetDirectory = '';
	appState.uploadItems = [];
	appState.uploadErrors = [];
	appState.uploadBusy = false;
	appState.uploadDragActive = false;
	elements.uploadFileInput.value = '';
	elements.uploadModal.classList.add('hidden');
	elements.uploadModal.setAttribute('aria-hidden', 'true');
}

function appendUploadItems(items) {
	const normalizedItems = items
		.map((item) => ({
			file: item.file,
			relativePath: normalizeUploadRelativePath(item.relativePath || item.file?.webkitRelativePath || item.file?.name)
		}))
		.filter((item) => item.file && item.relativePath);

	if (normalizedItems.length === 0) {
		appState.uploadErrors = [{ relativePath: '', message: 'The dropped items did not contain any files.' }];
		renderUploadDialog();
		return;
	}

	appState.uploadItems = appState.uploadItems.concat(normalizedItems);
	appState.uploadErrors = [];
	renderUploadDialog();
}

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

async function collectDroppedUploadItems(dataTransfer) {
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

function handleUploadFileSelection(files) {
	const selectedFiles = Array.from(files || []);
	if (selectedFiles.length === 0) {
		return;
	}

	appendUploadItems(selectedFiles.map((file) => ({
		file: file,
		relativePath: file.webkitRelativePath || file.name
	})));
}

async function handleUploadDrop(event) {
	event.preventDefault();
	if (appState.uploadBusy) {
		return;
	}

	appState.uploadDragActive = false;
	try {
		const items = await collectDroppedUploadItems(event.dataTransfer);
		appendUploadItems(items);
	} catch (error) {
		appState.uploadErrors = [{ relativePath: '', message: error.message }];
		renderUploadDialog();
	}
}

async function submitUploadDialog() {
	if (appState.uploadBusy || appState.uploadItems.length === 0) {
		return;
	}

	let shouldCloseUploadDialog = false;
	appState.uploadBusy = true;
	appState.uploadErrors = [];
	renderUploadDialog();

	try {
		const formData = new FormData();
		formData.append('directory', appState.uploadTargetDirectory);
		formData.append('relativePaths', JSON.stringify(appState.uploadItems.map((item) => item.relativePath)));
		for (const item of appState.uploadItems) {
			formData.append('files', item.file, item.file.name);
		}

		const response = await fetch('/api/uploads', {
			method: 'POST',
			body: formData
		});
		const payload = await response.json().catch(() => null);

		if (!response.ok) {
			throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
		}

		const uploadedFiles = Array.isArray(payload?.files) ? payload.files : [];
		const uploadErrors = Array.isArray(payload?.errors) ? payload.errors : [];
		const uploadedPaths = new Set(uploadedFiles.map((entry) => entry.relativePath));
		appState.uploadItems = appState.uploadItems.filter((item) => !uploadedPaths.has(buildUploadDestinationPath(item.relativePath, appState.uploadTargetDirectory)));

		if (uploadedFiles.length > 0) {
			await loadPage();
		}

		if (uploadErrors.length === 0 && uploadedFiles.length > 0) {
			shouldCloseUploadDialog = true;
			setStatus(`Uploaded ${uploadedFiles.length} file${uploadedFiles.length === 1 ? '' : 's'}.`);
			return;
		}

		appState.uploadErrors = uploadErrors.map((entry) => ({
			relativePath: entry.relativePath || '',
			message: entry.message || 'Upload failed.'
		}));
		if (appState.uploadErrors.length === 0) {
			appState.uploadErrors = [{ relativePath: '', message: 'No files were uploaded.' }];
		}
		setStatus(
			uploadedFiles.length > 0
				? `Uploaded ${uploadedFiles.length} file${uploadedFiles.length === 1 ? '' : 's'}; some items were skipped.`
				: 'Upload completed with errors.',
			true
		);
	} catch (error) {
		appState.uploadErrors = [{
			relativePath: '',
			message: error.message
		}];
		setStatus(error.message, true);
	} finally {
		appState.uploadBusy = false;
		if (shouldCloseUploadDialog) {
			closeUploadDialog();
			return;
		}
		renderUploadDialog();
	}
}

async function moveDocuments(documents, targetDirectory) {
	let defaultResolution = null;
	for (const document of documents) {
		const basePayload = {
			targetDirectory: targetDirectory || undefined,
			targetName: document.name
		};
		try {
			await requestJson(`/api/files/${encodeURIComponent(document.id)}/move`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(defaultResolution ? { ...basePayload, conflictResolution: defaultResolution } : basePayload)
			});
		} catch (error) {
			if (error?.payload?.error !== 'FILE_CONFLICT') {
				throw error;
			}
			const resolution = appState.applyConflictToAll
				? (defaultResolution || await showConflictDialog(error.payload, 'Move selected items'))
				: await showConflictDialog(error.payload, 'Move selected items');
			if (!resolution) {
				continue;
			}
			if (appState.applyConflictToAll) {
				defaultResolution = resolution;
			}
			await requestJson(`/api/files/${encodeURIComponent(document.id)}/move`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...basePayload, conflictResolution: resolution })
			});
		}
	}
	appState.applyConflictToAll = false;
}

async function copyDocuments(documents, targetDirectory) {
	let defaultResolution = null;
	for (const document of documents) {
		const basePayload = {
			targetDirectory: targetDirectory || undefined,
			targetName: document.name
		};
		try {
			await requestJson(`/api/files/${encodeURIComponent(document.id)}/copy`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(defaultResolution ? { ...basePayload, conflictResolution: defaultResolution } : basePayload)
			});
		} catch (error) {
			if (error?.payload?.error !== 'FILE_CONFLICT') {
				throw error;
			}
			const resolution = appState.applyConflictToAll
				? (defaultResolution || await showConflictDialog(error.payload, 'Copy selected items'))
				: await showConflictDialog(error.payload, 'Copy selected items');
			if (!resolution) {
				continue;
			}
			if (appState.applyConflictToAll) {
				defaultResolution = resolution;
			}
			await requestJson(`/api/files/${encodeURIComponent(document.id)}/copy`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...basePayload, conflictResolution: resolution })
			});
		}
	}
	appState.applyConflictToAll = false;
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
	if (!document) {
		setStatus('The document could not be found.', true);
		return;
	}
	openFolderTargetDialog('save-as', fileId);
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
		${isFolder ? `<button type="button" data-context-action="upload" data-file-id="${documentEntry.id}">Upload...</button>
		<button type="button" data-context-action="new-document" data-file-id="${documentEntry.id}" class="has-submenu">New...</button>
		<div class="context-menu-submenu hidden" data-submenu="new-document" aria-label="New document submenu">
			<button type="button" data-context-action="new-folder" data-file-id="${documentEntry.id}">New folder</button>
			<div class="context-menu-separator"></div>
			<button type="button" data-context-action="new-openoffice-text" data-file-id="${documentEntry.id}">New OpenOffice text document</button>
			<button type="button" data-context-action="new-openoffice-spreadsheet" data-file-id="${documentEntry.id}">New OpenOffice spreadsheet</button>
			<button type="button" data-context-action="new-openoffice-presentation" data-file-id="${documentEntry.id}">New OpenOffice presentation</button>
			<div class="context-menu-separator"></div>
			<button type="button" data-context-action="new-microsoft-text" data-file-id="${documentEntry.id}">New Microsoft Word document</button>
			<button type="button" data-context-action="new-microsoft-spreadsheet" data-file-id="${documentEntry.id}">New Microsoft Excel spreadsheet</button>
			<button type="button" data-context-action="new-microsoft-presentation" data-file-id="${documentEntry.id}">New Microsoft PowerPoint presentation</button>
		</div>` : ''}
		<button type="button" data-context-action="download" data-file-id="${documentEntry.id}">Download</button>
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
		case 'upload':
			openUploadDialog(documentEntry?.relativePath || '');
			return;
		case 'new-document':
			return;
		case 'new-openoffice-text':
			await createDocumentInDirectory('text', documentEntry?.relativePath || '');
			return;
		case 'new-openoffice-spreadsheet':
			await createDocumentInDirectory('spreadsheet', documentEntry?.relativePath || '');
			return;
		case 'new-openoffice-presentation':
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
		<button type="button" data-context-action="new-openoffice-text">New OpenOffice text document</button>
		<button type="button" data-context-action="new-openoffice-spreadsheet">New OpenOffice spreadsheet</button>
		<button type="button" data-context-action="new-openoffice-presentation">New OpenOffice presentation</button>
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

elements.layoutSplitter.addEventListener('pointerdown', startViewerResize);
document.addEventListener('pointermove', updateViewerResize);
document.addEventListener('pointerup', stopViewerResize);
document.addEventListener('pointercancel', stopViewerResize);
window.addEventListener('resize', syncViewerLayout);

elements.refreshButton.addEventListener('click', loadPage);
elements.loginButton.addEventListener('click', function() {
	openLoginModal();
});
elements.logoutButton.addEventListener('click', function() {
	logoutCurrentUser().catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.myFilesButton.addEventListener('click', function() {
	switchStorageContext('personal').catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.sharedFilesButton.addEventListener('click', function() {
	switchStorageContext('shared').catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.accountButton.addEventListener('click', function() {
	openAccountModal();
});
elements.adminButton.addEventListener('click', function() {
	openAdminUserManagement().catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.newMenuButton.addEventListener('click', function(event) {
event.preventDefault();
event.stopPropagation();
toggleNewDocumentMenu(elements.newMenuButton);
});
elements.uploadButton.addEventListener('click', function(event) {
event.preventDefault();
event.stopPropagation();
openUploadDialog('');
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
elements.folderPickerName.addEventListener('focus', prepareFolderPickerNameSelection);
elements.folderPickerModal.addEventListener('click', function(event) {
if (event.target === elements.folderPickerModal) {
	closeFolderTargetDialog();
}
});
elements.uploadChooseButton.addEventListener('click', function(event) {
event.preventDefault();
event.stopPropagation();
if (appState.uploadBusy) {
	return;
}
elements.uploadFileInput.click();
});
elements.uploadFileInput.addEventListener('change', function(event) {
handleUploadFileSelection(event.target.files);
event.target.value = '';
});
elements.uploadDropzone.addEventListener('click', function() {
if (appState.uploadBusy) {
	return;
}
elements.uploadFileInput.click();
});
elements.uploadDropzone.addEventListener('keydown', function(event) {
if (appState.uploadBusy) {
	return;
}
if (event.key === 'Enter' || event.key === ' ') {
	event.preventDefault();
	elements.uploadFileInput.click();
}
});
elements.uploadDropzone.addEventListener('dragover', function(event) {
event.preventDefault();
if (appState.uploadBusy) {
	return;
}
appState.uploadDragActive = true;
renderUploadDialog();
});
elements.uploadDropzone.addEventListener('dragleave', function(event) {
if (elements.uploadDropzone.contains(event.relatedTarget)) {
	return;
}
appState.uploadDragActive = false;
renderUploadDialog();
});
elements.uploadDropzone.addEventListener('drop', handleUploadDrop);
elements.uploadCancel.addEventListener('click', closeUploadDialog);
elements.uploadConfirm.addEventListener('click', submitUploadDialog);
elements.uploadModal.addEventListener('click', function(event) {
if (event.target === elements.uploadModal) {
	closeUploadDialog();
}
});
elements.loginCancel.addEventListener('click', function() {
	closeModal(elements.loginModal);
});
elements.loginForm.addEventListener('submit', function(event) {
	submitLoginForm(event).catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.loginModal.addEventListener('click', function(event) {
	if (event.target === elements.loginModal) {
		closeModal(elements.loginModal);
	}
});
elements.accountCancel.addEventListener('click', function() {
	closeModal(elements.accountModal);
});
elements.accountForm.addEventListener('submit', function(event) {
	submitAccountForm(event).catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.accountModal.addEventListener('click', function(event) {
	if (event.target === elements.accountModal) {
		closeModal(elements.accountModal);
	}
});
elements.adminCancel.addEventListener('click', function() {
	closeModal(elements.adminModal);
});
elements.adminModal.addEventListener('click', function(event) {
	if (event.target === elements.adminModal) {
		closeModal(elements.adminModal);
	}
});
elements.adminCreateGeneratePassword.addEventListener('change', function(event) {
	elements.adminCreatePassword.disabled = event.target.checked;
	if (event.target.checked) {
		elements.adminCreatePassword.value = '';
	}
});
elements.adminCreateUserForm.addEventListener('submit', function(event) {
	submitAdminCreateUserForm(event).catch(function(error) {
		setStatus(error.message, true);
	});
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
syncViewerLayout();
maybeLaunchPublicShare().then(function(launchedFromShare) {
if (!launchedFromShare) {
	loadPage();
}
});
