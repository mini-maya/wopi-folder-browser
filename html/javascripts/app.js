import { getFolderSelectionState, getFolderSizeBytes, getVisibleTreeEntries } from './tree/fileBrowserTree.mjs';
import { requestJson } from './api/requestJson.mjs';
import { collectDroppedUploadItems } from './upload/dropItems.mjs';
import { buildUploadDestinationPath, getUploadSummaryLabel, normalizeUploadRelativePath } from './upload/uploadPaths.mjs';
import { createUploadController } from './upload/uploadController.mjs';
import { buildFilePreviewSvg, buildFolderPictogramSvg, folderContainsFiles } from './ui/filePreviews.mjs';
import { escapeHtml, formatBytes, formatDate } from './ui/formatting.mjs';
import { createDocumentListController } from './documents/listController.mjs';
import { createAuthController } from './auth/authController.mjs';
import { createThemeController } from './ui/themeController.mjs';
import { createViewerLayoutController } from './viewer/layoutController.mjs';
import { createViewerSessionController } from './viewer/sessionController.mjs';

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
	integrationPendingData: null,
	activeDetailTab: 'share',
	activeDetailFileId: null,
	detailThumbnailRequestId: 0,
	detailThumbnailCache: new Map(),
	detailThumbnailInFlight: new Map()
};

const DEFAULT_VIEWER_TITLE = 'No document opened yet';
const DEFAULT_VIEWER_SUBTITLE = 'Choose a file from the list to open it in Collabora.';
const DEFAULT_VIEWER_WIDTH = 800;
const OFFICE_THUMBNAIL_EXTENSIONS = new Set([
	'.doc', '.docx', '.odt',
	'.xls', '.xlsx', '.ods',
	'.ppt', '.pptx', '.odp'
]);

const themeController = createThemeController({
	appState: appState,
	themeSelect: elements.themeSelect
});

const viewerLayoutController = createViewerLayoutController({
	layout: elements.layout,
	layoutSplitter: elements.layoutSplitter,
	appState: appState
});

function isFolderEntry(document) {
	return Boolean(document?.isDirectory);
}

function setStatus(message, isError = false) {
	elements.statusMessage.textContent = message;
	elements.statusMessage.classList.toggle('error', isError);
}

const viewerSessionController = createViewerSessionController({
	elements: elements,
	appState: appState,
	requestJson: requestJson,
	viewerLayoutController: viewerLayoutController,
	setStatus: setStatus,
	reloadPage: async function() {
		await loadPage();
	},
	defaultViewerWidth: DEFAULT_VIEWER_WIDTH,
	defaultViewerTitle: DEFAULT_VIEWER_TITLE,
	defaultViewerSubtitle: DEFAULT_VIEWER_SUBTITLE
});

const authController = createAuthController({
	elements: elements,
	appState: appState,
	requestJson: requestJson,
	formatDate: formatDate,
	setStatus: setStatus,
	loadPage: async function() {
		await loadPage();
	},
	closeViewer: async function() {
		await viewerSessionController.closeViewer();
	}
});

const documentListController = createDocumentListController({
	elements: elements,
	appState: appState,
	searchInput: elements.searchInput,
	isFolderEntry: isFolderEntry,
	getDocumentById: getDocumentById,
	getFolderSelectionState: getFolderSelectionState,
	getVisibleTreeEntries: getVisibleTreeEntries,
	buildFolderPictogramSvg: buildFolderPictogramSvg,
	buildFilePreviewSvg: buildFilePreviewSvg,
	folderContainsFiles: folderContainsFiles,
	escapeHtml: escapeHtml,
	formatDate: formatDate,
	formatBytes: formatBytes,
	onCloseOpenContextMenu: closeOpenContextMenu,
	onShowContextMenu: showContextMenu,
	onHandleFileAction: handleFileAction
});

const uploadController = createUploadController({
	elements: elements,
	appState: appState,
	getUploadSummaryLabel: getUploadSummaryLabel,
	normalizeUploadRelativePath: normalizeUploadRelativePath,
	buildUploadDestinationPath: buildUploadDestinationPath,
	collectDroppedUploadItems: collectDroppedUploadItems,
	escapeHtml: escapeHtml,
	formatBytes: formatBytes,
	setStatus: setStatus,
	loadPage: async function() {
		await loadPage();
	},
	onCloseOpenContextMenu: closeOpenContextMenu
});

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

function supportsOfficeDetailsThumbnail(document) {
	if (!document || document.isDirectory) {
		return false;
	}
	return OFFICE_THUMBNAIL_EXTENSIONS.has(String(document.extension || '').toLowerCase());
}

function isThumbnailDebugEnabled() {
	return Boolean(appState.config?.thumbnail?.debug);
}

function syncDetailThumbnailCacheWithDocuments() {
	const currentVersionsByFileId = new Map(
		appState.documents
			.filter((document) => !document.isDirectory)
			.map((document) => [document.id, String(document.version || '')])
	);
	for (const [fileId, cachedValue] of appState.detailThumbnailCache.entries()) {
		const currentVersion = currentVersionsByFileId.get(fileId);
		if (!currentVersion) {
			appState.detailThumbnailCache.delete(fileId);
			continue;
		}
		if (!cachedValue || typeof cachedValue !== 'object' || String(cachedValue.version || '') !== currentVersion) {
			appState.detailThumbnailCache.delete(fileId);
		}
	}
	for (const [fileId] of appState.detailThumbnailInFlight.entries()) {
		if (!currentVersionsByFileId.has(fileId)) {
			appState.detailThumbnailInFlight.delete(fileId);
		}
	}
}

async function loadOfficeDetailsThumbnail(document) {
	if (!supportsOfficeDetailsThumbnail(document)) {
		return;
	}
	const previewImage = elements.detailsPanelContent.querySelector('.details-preview img');
	if (!previewImage) {
		return;
	}
	const requestId = appState.detailThumbnailRequestId + 1;
	appState.detailThumbnailRequestId = requestId;
	const cacheKey = document.id;
	const cachedEntry = appState.detailThumbnailCache.get(cacheKey);
	if (cachedEntry?.thumbnailUrl) {
		previewImage.src = cachedEntry.thumbnailUrl;
		previewImage.classList.remove('folder-icon');
	}
	const existingRequest = appState.detailThumbnailInFlight.get(cacheKey);
	if (existingRequest) {
		try {
			const payload = await existingRequest;
			if (appState.detailThumbnailRequestId === requestId && appState.activeDetailFileId === document.id && payload?.status === 'THUMBNAIL_RENDERED' && payload?.thumbnailUrl) {
				previewImage.src = payload.thumbnailUrl;
				previewImage.classList.remove('folder-icon');
			}
		} catch (error) {
			// Keep fallback icon in the detail panel when thumbnail rendering fails.
		}
		return;
	}
	try {
		const pendingPayload = requestJson(`/api/files/${encodeURIComponent(document.id)}/thumbnail`);
		appState.detailThumbnailInFlight.set(cacheKey, pendingPayload);
		const payload = await pendingPayload;
		appState.detailThumbnailInFlight.delete(cacheKey);
		if (isThumbnailDebugEnabled()) {
			console.info('[thumbnail-debug] details thumbnail response', {
				fileId: document.id,
				version: payload?.version || null,
				status: payload?.status || null,
				hasThumbnailUrl: Boolean(payload?.thumbnailUrl)
			});
		}
		if (appState.detailThumbnailRequestId !== requestId || appState.activeDetailFileId !== document.id) {
			return;
		}
		if (payload.status === 'THUMBNAIL_RENDERED' && payload.thumbnailUrl) {
			appState.detailThumbnailCache.set(cacheKey, {
				version: String(payload.version || document.version || ''),
				thumbnailUrl: payload.thumbnailUrl
			});
			previewImage.src = payload.thumbnailUrl;
			previewImage.classList.remove('folder-icon');
		}
	} catch (error) {
		appState.detailThumbnailInFlight.delete(cacheKey);
		if (isThumbnailDebugEnabled()) {
			console.info('[thumbnail-debug] details thumbnail request failed', {
				fileId: document.id,
				version: String(document.version || ''),
				error: error.message
			});
		}
		// Keep fallback icon in the detail panel when thumbnail rendering fails.
	}
}

function openDetailsPanel(fileId) {
	const document = getDocumentById(fileId);
	if (!document) {
		return;
	}
	if (appState.activeDetailFileId !== fileId) {
		appState.activeDetailTab = 'share';
		appState.activeDetailFileId = fileId;
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

	if (isFolder) {
		const folderActionButtons = `
				<button type="button" class="secondary" data-action="details-move" data-file-id="${document.id}">Move</button>
				<button type="button" class="secondary" data-action="details-copy" data-file-id="${document.id}">Copy</button>
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
				<div class="detail-meta-row"><span>Type</span><strong>Folder</strong></div>
				<div class="detail-meta-row"><span>Path</span><strong>${escapeHtml(document.relativePath)}</strong></div>
			</div>
			<div class="details-actions">
				${folderActionButtons}
			</div>
		</div>
	`;
	} else {
		const activeTab = appState.activeDetailTab || 'share';
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
				<div class="detail-meta-row"><span>Type</span><strong>File</strong></div>
				<div class="detail-meta-row"><span>Path</span><strong>${escapeHtml(document.relativePath)}</strong></div>
			</div>
			<nav class="detail-tabs" aria-label="File detail tabs">
				<button type="button" class="detail-tab-btn${activeTab === 'share' ? ' active' : ''}" data-tab="share" aria-selected="${activeTab === 'share'}">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
					<span>Share</span>
				</button>
				<button type="button" class="detail-tab-btn${activeTab === 'activities' ? ' active' : ''}" data-tab="activities" aria-selected="${activeTab === 'activities'}">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
					<span>Activities</span>
				</button>
				<button type="button" class="detail-tab-btn${activeTab === 'versions' ? ' active' : ''}" data-tab="versions" aria-selected="${activeTab === 'versions'}">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
					<span>Versions</span>
				</button>
			</nav>
			<div class="detail-tab-content" id="detail-tab-content"></div>
		</div>
	`;
		attachDetailTabListeners(document.id);
		switchDetailTab(document.id, activeTab);
	}

	for (const button of elements.detailsPanelContent.querySelectorAll('[data-action][data-file-id]')) {
		button.addEventListener('click', function() {
			handleDetailsAction(button.dataset.action, button.dataset.fileId);
		});
	}
	if (!isFolder) {
		loadOfficeDetailsThumbnail(document);
	}
}

function attachDetailTabListeners(fileId) {
	const tabButtons = elements.detailsPanelContent.querySelectorAll('.detail-tab-btn');
	for (const btn of tabButtons) {
		btn.addEventListener('click', function() {
			const tab = btn.dataset.tab;
			appState.activeDetailTab = tab;
			for (const b of tabButtons) {
				b.classList.toggle('active', b.dataset.tab === tab);
				b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
			}
			switchDetailTab(fileId, tab);
		});
	}
}

function switchDetailTab(fileId, tab) {
	const container = elements.detailsPanelContent.querySelector('#detail-tab-content');
	if (!container) {
		return;
	}
	container.innerHTML = '';
	if (tab === 'share') {
		renderShareTabContent(fileId, container);
	} else if (tab === 'activities') {
		renderActivityTabContent(fileId, container);
	} else if (tab === 'versions') {
		renderVersionsTabContent(fileId, container);
	}
}

function renderShareTabContent(fileId, container) {
	container.innerHTML = `
		<div class="tab-section">
			<p class="tab-section-description">Share this file with others by creating a link.</p>
			<button type="button" class="share-tab-btn" data-share-file-id="${fileId}">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
				Create share link
			</button>
		</div>
	`;
	const shareBtn = container.querySelector('.share-tab-btn');
	shareBtn.addEventListener('click', async function() {
		await createShare(fileId);
	});
}

async function renderActivityTabContent(fileId, container) {
	container.innerHTML = '<div class="tab-loading">Loading activities…</div>';
	try {
		const payload = await requestJson('/api/activities?limit=200');
		const allActivities = Array.isArray(payload.activities) ? payload.activities : [];
		const activities = allActivities.filter((a) => a.fileId === fileId);

		const activityLabels = {
			open: 'Opened',
			edit: 'Edited',
			create: 'Created',
			share: 'Shared',
			move: 'Moved',
			copy: 'Copied',
			rename: 'Renamed',
			download: 'Downloaded',
			upload: 'Uploaded',
			'restore-version': 'Restored version',
			'delete-version': 'Deleted version',
			delete: 'Deleted'
		};

		if (!activities.length) {
			container.innerHTML = '<div class="tab-empty">No activity recorded yet.</div>';
			return;
		}

		container.innerHTML = `
			<ul class="activity-list" aria-label="File activity">
				${activities.map(function(a) {
					const label = activityLabels[a.type] || a.type;
					const countNote = a.count && a.count > 1 ? ` <span class="activity-count">×${a.count}</span>` : '';
					return `
						<li class="activity-item">
							<div class="activity-item-dot" aria-hidden="true"></div>
							<div class="activity-item-body">
								<span class="activity-item-action">${escapeHtml(label)}${countNote}</span>
								<span class="activity-item-meta">
									<span class="activity-item-user">${escapeHtml(a.userName || a.userId || 'Unknown')}</span>
									<span class="activity-item-time">${formatDate(a.createdAt)}</span>
								</span>
							</div>
						</li>
					`;
				}).join('')}
			</ul>
		`;
	} catch (error) {
		container.innerHTML = `<div class="tab-empty tab-error">Could not load activities: ${escapeHtml(error.message)}</div>`;
	}
}

async function renderVersionsTabContent(fileId, container) {
	container.innerHTML = '<div class="tab-loading">Loading versions…</div>';
	try {
		const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions`);
		const fileEntry = getDocumentById(fileId);
		const versions = Array.isArray(payload.versions) ? payload.versions : [];

		container.innerHTML = `
			<div class="version-list">
				${versions.length ? versions.map(function(version, index) {
					const isCurrent = index === 0;
					const versionNumber = isCurrent ? null : versions.length - index;
					return `
						<div class="version-item">
							<div class="version-thumb"><img src="${getPreviewImage(fileEntry)}" alt="Version preview"></div>
							<div class="version-body">
								<h4>${isCurrent ? 'Current version' : `Version ${versionNumber}`}${version.label ? ` — ${escapeHtml(version.label)}` : ''}</h4>
								<small>${escapeHtml(version.createdBy?.name ?? 'Unknown')}</small>
								<small>${formatDate(version.createdAt)} · ${formatBytes(version.size)}</small>
							</div>
							<div class="version-actions" style="position: relative;">
								<button type="button" class="secondary menu-button" data-action="context-menu" data-file-id="${fileId}" data-version-id="${version.id}" aria-label="Open version actions" aria-expanded="false">⋯</button>
							</div>
						</div>
					`;
				}).join('') : '<div class="file-meta">No versions recorded yet.</div>'}
			</div>
		`;

		for (const button of container.querySelectorAll('[data-action="context-menu"][data-version-id]')) {
			button.addEventListener('click', function(event) {
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
			});
		}
	} catch (error) {
		container.innerHTML = `<div class="tab-empty tab-error">Could not load versions: ${escapeHtml(error.message)}</div>`;
	}
}

async function renderVersionList(fileId) {
	openDetailsPanel(fileId);
	appState.activeDetailTab = 'versions';
	const container = elements.detailsPanelContent.querySelector('#detail-tab-content');
	if (container) {
		const tabButtons = elements.detailsPanelContent.querySelectorAll('.detail-tab-btn');
		for (const b of tabButtons) {
			b.classList.toggle('active', b.dataset.tab === 'versions');
			b.setAttribute('aria-selected', b.dataset.tab === 'versions' ? 'true' : 'false');
		}
		await renderVersionsTabContent(fileId, container);
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
			await viewerSessionController.openDocument(fileId, 'view');
			return;
		case 'details-open':
			if (isFolderEntry(document)) {
				setStatus('Folders cannot be opened in Collabora.', true);
				return;
			}
			await viewerSessionController.openDocument(fileId, 'edit');
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
	const selectedDocuments = documentListController.getBulkSelectedDocuments();
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
	const selectedDocuments = documentListController.getBulkSelectedDocuments();
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
			viewerSessionController.submitLaunchPayload(payload);
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
			appState.activeDetailTab = 'versions';
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

function applySearchFilter() {
	documentListController.renderCurrentDocumentList();
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
		syncDetailThumbnailCacheWithDocuments();
		appState.auth.storageContext = config.storageContext || appState.auth.storageContext || 'shared';
		authController.applyPasswordPolicyToForms(config.passwordMinLength);
		authController.renderAuthControls();
		elements.documentRoot.textContent = config.documentRoot;
		elements.appBaseUrl.textContent = config.appBaseUrl;
		elements.collaboraUrl.textContent = config.collaboraPublicUrl;
		documentListController.renderCurrentDocumentList();
		setStatus(`Loaded ${fileList.documents.length} entr${fileList.documents.length === 1 ? 'y' : 'ies'}.`);
	} catch (error) {
		documentListController.renderEmptyState();
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
			viewerSessionController.submitLaunchPayload(payload);
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
			uploadController.openUploadDialog(documentEntry?.relativePath || '');
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
				await viewerSessionController.openDocument(fileId, mode || 'edit');
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

elements.layoutSplitter.addEventListener('pointerdown', viewerLayoutController.startViewerResize);
document.addEventListener('pointermove', viewerLayoutController.updateViewerResize);
document.addEventListener('pointerup', viewerLayoutController.stopViewerResize);
document.addEventListener('pointercancel', viewerLayoutController.stopViewerResize);
window.addEventListener('resize', viewerLayoutController.syncViewerLayout);

elements.refreshButton.addEventListener('click', loadPage);
elements.loginButton.addEventListener('click', function() {
	authController.openLoginModal();
});
elements.logoutButton.addEventListener('click', function() {
	authController.logoutCurrentUser().catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.myFilesButton.addEventListener('click', function() {
	authController.switchStorageContext('personal').catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.sharedFilesButton.addEventListener('click', function() {
	authController.switchStorageContext('shared').catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.accountButton.addEventListener('click', function() {
	authController.openAccountModal();
});
elements.adminButton.addEventListener('click', function() {
	authController.openAdminUserManagement().catch(function(error) {
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
uploadController.openUploadDialog('');
});
elements.bulkActionsMenuButton.addEventListener('click', function(event) {
event.preventDefault();
event.stopPropagation();
toggleBulkActionsMenu(elements.bulkActionsMenuButton);
});
elements.searchInput.addEventListener('input', applySearchFilter);
elements.closeViewerButton.addEventListener('click', function() {
viewerSessionController.closeViewer();
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
uploadController.handleUploadFileSelection(event.target.files);
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
uploadController.setUploadDragActive(true);
});
elements.uploadDropzone.addEventListener('dragleave', function(event) {
if (elements.uploadDropzone.contains(event.relatedTarget)) {
	return;
}
uploadController.setUploadDragActive(false);
});
elements.uploadDropzone.addEventListener('drop', uploadController.handleUploadDrop);
elements.uploadCancel.addEventListener('click', uploadController.closeUploadDialog);
elements.uploadConfirm.addEventListener('click', uploadController.submitUploadDialog);
elements.uploadModal.addEventListener('click', function(event) {
if (event.target === elements.uploadModal) {
	uploadController.closeUploadDialog();
}
});
elements.loginCancel.addEventListener('click', function() {
	authController.closeModal(elements.loginModal);
});
elements.loginForm.addEventListener('submit', function(event) {
	authController.submitLoginForm(event).catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.loginModal.addEventListener('click', function(event) {
	if (event.target === elements.loginModal) {
		authController.closeModal(elements.loginModal);
	}
});
elements.accountCancel.addEventListener('click', function() {
	authController.closeModal(elements.accountModal);
});
elements.accountForm.addEventListener('submit', function(event) {
	authController.submitAccountForm(event).catch(function(error) {
		setStatus(error.message, true);
	});
});
elements.accountModal.addEventListener('click', function(event) {
	if (event.target === elements.accountModal) {
		authController.closeModal(elements.accountModal);
	}
});
elements.adminCancel.addEventListener('click', function() {
	authController.closeModal(elements.adminModal);
});
elements.adminModal.addEventListener('click', function(event) {
	if (event.target === elements.adminModal) {
		authController.closeModal(elements.adminModal);
	}
});
elements.adminCreateGeneratePassword.addEventListener('change', function(event) {
	elements.adminCreatePassword.disabled = event.target.checked;
	if (event.target.checked) {
		elements.adminCreatePassword.value = '';
	}
});
elements.adminCreateUserForm.addEventListener('submit', function(event) {
	authController.submitAdminCreateUserForm(event).catch(function(error) {
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
documentListController.updateBulkActionState(visibleDocuments);
documentListController.renderCurrentDocumentList();
});
elements.themeSelect.addEventListener('change', function(event) {
themeController.applyThemeMode(event.target.value, true);
});

themeController.initializeTheme();
viewerLayoutController.syncViewerLayout();
viewerSessionController.maybeLaunchPublicShare().then(function(launchedFromShare) {
if (!launchedFromShare) {
	loadPage();
}
});
