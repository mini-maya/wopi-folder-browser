import { getFolderSelectionState, getFolderSizeBytes, getVisibleTreeEntries } from './tree/fileBrowserTree.mjs';
import { requestJson } from './api/requestJson.mjs';
import { collectDroppedUploadItems } from './upload/dropItems.mjs';
import { buildUploadDestinationPath, getUploadSummaryLabel, normalizeUploadRelativePath } from './upload/uploadPaths.mjs';
import { createUploadController } from './upload/uploadController.mjs';
import { createFileActionsController } from './actions/fileActionsController.mjs';
import { createContextMenuController } from './menus/contextMenuController.mjs';
import { buildFilePreviewSvg, buildFolderPictogramSvg, folderContainsFiles } from './ui/filePreviews.mjs';
import { escapeHtml, formatBytes, formatDate } from './ui/formatting.mjs';
import { createDocumentListController } from './documents/listController.mjs';
import { createDetailsPanelController } from './documents/detailsPanelController.mjs';
import { createFolderTargetController } from './dialogs/folderTargetController.mjs';
import { createAuthController } from './auth/authController.mjs';
import { createThemeController } from './ui/themeController.mjs';
import { createViewerLayoutController } from './viewer/layoutController.mjs';
import { createViewerSessionController } from './viewer/sessionController.mjs';
import { createAppBootstrap } from './app/bootstrap.mjs';
import { clearSelectionAndDetailState, resetFilesViewState } from './state/viewState.mjs';

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
	storageSelect: document.querySelector('#storage-select'),
	recycleButton: document.querySelector('#recycle-button'),
	newMenuButton: document.querySelector('#new-menu-button'),
	uploadButton: document.querySelector('#upload-button'),
	myFilesButton: document.querySelector('#my-files-button'),
	sharedFilesButton: document.querySelector('#shared-files-button'),
	adminButton: document.querySelector('#admin-button'),
	accountButton: document.querySelector('#account-button'),
	loginButton: document.querySelector('#login-button'),
	logoutButton: document.querySelector('#logout-button'),
	aboutButton: document.querySelector('#about-button'),
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
	sharePasswordModal: document.querySelector('#share-password-modal'),
	sharePasswordCancel: document.querySelector('#share-password-cancel'),
	sharePasswordForm: document.querySelector('#share-password-form'),
	sharePasswordInput: document.querySelector('#share-password-input'),
	sharePasswordError: document.querySelector('#share-password-error'),
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
	adminUsersBody: document.querySelector('#admin-users-body'),
	missingEntriesModal: document.querySelector('#missing-entries-modal'),
	missingEntriesCancel: document.querySelector('#missing-entries-cancel'),
	missingEntriesClose: document.querySelector('#missing-entries-close'),
	missingEntriesPrune: document.querySelector('#missing-entries-prune'),
	missingEntriesPruneConfirm: document.querySelector('#missing-entries-prune-confirm'),
	missingEntriesSummary: document.querySelector('#missing-entries-summary'),
	missingEntriesList: document.querySelector('#missing-entries-list'),
	aboutModal: document.querySelector('#about-modal'),
	aboutCancel: document.querySelector('#about-cancel'),
	aboutVersion: document.querySelector('#about-version'),
	columnPath: document.querySelector('#column-path'),
	columnDate: document.querySelector('#column-date')
};

const appState = {
	documents: [],
	visibleDocuments: [],
	config: null,
	storages: [],
	currentStorageId: 'documents',
	themeMode: 'auto',
	currentView: 'files',
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
		storageId: 'documents'
	},
	adminUsers: [],
	recycleEntries: [],
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

function getStorageIdFromLocation() {
	const match = window.location.pathname.match(/^\/storage\/([^/]+)/);
	return match?.[1] ? decodeURIComponent(match[1]) : 'documents';
}

function updateStoragePath(storageId) {
	const encodedStorageId = encodeURIComponent(storageId || 'documents');
	const nextPath = `/storage/${encodedStorageId}`;
	if (window.location.pathname !== nextPath) {
		window.history.replaceState({}, '', nextPath);
	}
}

function renderStorageSelector() {
	if (!elements.storageSelect) {
		return;
	}
	const storages = Array.isArray(appState.storages) ? appState.storages : [];
	elements.storageSelect.innerHTML = '';
	for (const storage of storages) {
		const option = document.createElement('option');
		option.value = storage.id;
		option.textContent = storage.available === false
			? `${storage.name} (Unavailable)`
			: `${storage.name}${storage.readOnly ? ' (Read-only)' : ''}`;
		option.disabled = storage.available === false || storage.enabled === false;
		elements.storageSelect.appendChild(option);
	}
	if (!storages.some((storage) => storage.id === appState.currentStorageId && storage.available !== false && storage.enabled !== false)) {
		const fallback = storages.find((storage) => storage.available !== false && storage.enabled !== false);
		if (fallback) {
			appState.currentStorageId = fallback.id;
		}
	}
	elements.storageSelect.value = appState.currentStorageId;
	updateWriteActionButtons();
}

function updateWriteActionButtons() {
	const currentStorage = appState.storages?.find((s) => s.id === appState.currentStorageId);
	const isReadOnly = currentStorage?.readOnly === true;
	const isUnauthenticated = !appState.auth?.authenticated;

	if (elements.newMenuButton) {
		elements.newMenuButton.disabled = isReadOnly || isUnauthenticated;
	}
	if (elements.uploadButton) {
		elements.uploadButton.disabled = isReadOnly || isUnauthenticated;
	}
}

function syncRecycleButtonState() {
	if (!elements.recycleButton) {
		return;
	}
	const recycleCount = Array.isArray(appState.recycleEntries) ? appState.recycleEntries.length : 0;
	const recycleCountElement = elements.recycleButton.querySelector('[data-recycle-count]');
	if (recycleCountElement) {
		recycleCountElement.textContent = String(recycleCount);
		recycleCountElement.hidden = recycleCount === 0;
	}
	elements.recycleButton.classList.toggle('is-active', appState.currentView === 'recycle');
	elements.recycleButton.setAttribute('aria-pressed', appState.currentView === 'recycle' ? 'true' : 'false');
	elements.recycleButton.setAttribute('aria-label', recycleCount === 0 ? 'Recycle Bin' : `Recycle Bin, ${recycleCount} items`);
	elements.recycleButton.title = recycleCount === 0 ? 'Recycle Bin' : `Recycle Bin (${recycleCount})`;
}

let fileActionsController = null;
let contextMenuController = null;

function getRecycleEntryById(entryId) {
	return appState.recycleEntries.find((entry) => entry.id === entryId) || null;
}

async function handleFileAction(action, fileId, mode) {
	if (!fileActionsController) {
		return;
	}
	await fileActionsController.handleFileAction(action, fileId, mode);
}

async function createShare(fileId) {
	if (!fileActionsController) {
		return;
	}
	await fileActionsController.createShare(fileId);
}

async function deleteDocument(fileId) {
	if (!fileActionsController) {
		return;
	}
	await fileActionsController.deleteDocument(fileId);
}

async function openRecycleEntryDetails(entryId) {
	const entry = getRecycleEntryById(entryId);
	if (!entry) {
		return;
	}
	const fallbackPreviewSrc = buildFilePreviewSvg({ mimeType: entry.mimeType || '' });
	elements.detailsPanel.classList.remove('hidden');
	elements.detailsPanelContent.innerHTML = `
		<div class="details-card">
			<div class="details-preview">
				<img src="${fallbackPreviewSrc}" alt="${escapeHtml(entry.originalName || 'recycled file')} preview">
			</div>
			<div class="details-header">
				<h3>${escapeHtml(entry.originalName || 'Recovered file')}</h3>
			</div>
			<div class="detail-meta">
				<div class="detail-meta-row"><span>Original path</span><strong>${escapeHtml(entry.originalPath || '')}</strong></div>
				<div class="detail-meta-row"><span>Deleted at</span><strong>${formatDate(entry.deletedAt)}</strong></div>
				<div class="detail-meta-row"><span>Size</span><strong>${entry.versionSize != null ? formatBytes(entry.versionSize) : '—'}</strong></div>
			</div>
			<div class="details-actions">
				<button type="button" class="secondary" data-recycle-action="restore" data-entry-id="${entry.id}">Restore</button>
				<button type="button" class="danger" data-recycle-action="delete-finally" data-entry-id="${entry.id}">Delete finally</button>
			</div>
		</div>
	`;
	const previewImage = elements.detailsPanelContent.querySelector('.details-preview img');
	if (previewImage && entry.thumbnailUrl) {
		previewImage.addEventListener('error', function handleRecyclePreviewError() {
			previewImage.src = fallbackPreviewSrc;
			previewImage.removeEventListener('error', handleRecyclePreviewError);
		});
		previewImage.src = entry.thumbnailUrl;
	}
	for (const button of elements.detailsPanelContent.querySelectorAll('[data-recycle-action]')) {
		button.addEventListener('click', async function() {
			await handleRecycleAction(button.dataset.recycleAction, button.dataset.entryId);
		});
	}
}

function closeActiveDetailsPanel() {
	appState.activeDetailFileId = null;
	elements.detailsPanel.classList.add('hidden');
}

async function handleRecycleAction(action, entryId) {
	const entry = getRecycleEntryById(entryId);
	if (!entry) {
		return;
	}
	if (action === 'details') {
		await openRecycleEntryDetails(entryId);
		return;
	}
	if (action === 'restore') {
		try {
			await requestJson(`/api/recycle/${encodeURIComponent(entryId)}/restore`, { method: 'POST' });
			await loadPage();
			closeActiveDetailsPanel();
			setStatus('Restored successfully.');
		} catch (error) {
			if (error?.payload?.error === 'FILE_CONFLICT' && fileActionsController?.showConflictDialog) {
				const resolution = await fileActionsController.showConflictDialog(error.payload, 'Restore');
				if (!resolution) {
					return;
				}
				try {
					const retryResult = await requestJson(`/api/recycle/${encodeURIComponent(entryId)}/restore`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ conflictResolution: resolution })
					});
					await loadPage();
					if (!retryResult?.skipped) {
						closeActiveDetailsPanel();
					}
					setStatus(retryResult?.skipped ? 'Restore skipped.' : 'Restored successfully.');
				} catch (retryError) {
					setStatus(retryError.message, true);
				}
				return;
			}
			setStatus(error.message, true);
		}
		return;
	}
	if (action === 'delete-finally') {
		if (!window.confirm('Delete this document permanently?')) {
			return;
		}
		try {
			await requestJson(`/api/recycle/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
			await loadPage();
			closeActiveDetailsPanel();
			setStatus('Deleted permanently.');
		} catch (error) {
			setStatus(error.message, true);
		}
	}
}

async function handleRecycleBulkAction(action) {
	const selectedIds = Array.from(appState.selectedFileIds);
	if (!selectedIds.length) {
		return;
	}
	const count = selectedIds.length;
	const label = count === 1 ? '1 item' : `${count} items`;
	if (action === 'restore') {
		try {
			let skippedCount = 0;
			for (const id of selectedIds) {
				try {
					const result = await requestJson(`/api/recycle/${encodeURIComponent(id)}/restore`, { method: 'POST' });
					if (result?.skipped) {
						skippedCount++;
					}
				} catch (error) {
					if (error?.payload?.error === 'FILE_CONFLICT' && fileActionsController?.showConflictDialog) {
						const resolution = await fileActionsController.showConflictDialog(error.payload, 'Restore');
						if (!resolution) {
							skippedCount++;
							continue;
						}
						const retryResult = await requestJson(`/api/recycle/${encodeURIComponent(id)}/restore`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ conflictResolution: resolution })
						});
						if (retryResult?.skipped) {
							skippedCount++;
						}
					} else {
						setStatus(error.message, true);
						return;
					}
				}
			}
			appState.selectedFileIds.clear();
			await loadPage();
			setStatus(skippedCount > 0 ? `Restored ${count - skippedCount} of ${label}.` : `Restored ${label}.`);
		} catch (error) {
			setStatus(error.message, true);
		}
		return;
	}
	if (action === 'delete-finally') {
		if (!window.confirm(`Permanently delete ${label}?`)) {
			return;
		}
		try {
			for (const id of selectedIds) {
				await requestJson(`/api/recycle/${encodeURIComponent(id)}`, { method: 'DELETE' });
			}
			appState.selectedFileIds.clear();
			await loadPage();
			setStatus(`Deleted ${label} permanently.`);
		} catch (error) {
			setStatus(error.message, true);
		}
	}
}

async function saveAsDocument(fileId) {
	if (!fileActionsController) {
		return;
	}
	await fileActionsController.saveAsDocument(fileId);
}

async function showContextMenu(fileId, button) {
	if (!contextMenuController) {
		return;
	}
	await contextMenuController.showContextMenu(fileId, button);
}

function closeOpenContextMenu() {
	if (!contextMenuController) {
		return;
	}
	contextMenuController.closeOpenContextMenu();
}

function positionContextMenu(menu, button, menuWidth = 220, menuHeight = 320) {
	if (!contextMenuController) {
		return;
	}
	contextMenuController.positionContextMenu(menu, button, menuWidth, menuHeight);
}

function toggleBulkActionsMenu(button) {
	if (!contextMenuController) {
		return;
	}
	contextMenuController.toggleBulkActionsMenu(button);
}

function toggleNewDocumentMenu(button) {
	if (!contextMenuController) {
		return;
	}
	contextMenuController.toggleNewDocumentMenu(button);
}

function openAboutDialog() {
	elements.aboutModal.classList.remove('hidden');
	elements.aboutModal.setAttribute('aria-hidden', 'false');
	elements.aboutCancel.focus();
}

function closeAboutDialog() {
	elements.aboutModal.classList.add('hidden');
	elements.aboutModal.setAttribute('aria-hidden', 'true');
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
	resetFilesViewState: function() {
		resetFilesViewState(appState);
	},
	clearDocuments: function() {
		appState.documents = [];
		appState.storages = [];
		appState.auth = null;
		documentListController.renderCurrentDocumentList();
	},
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
	onHandleFileAction: handleFileAction,
	onHandleRecycleAction: handleRecycleAction
});

const detailsPanelController = createDetailsPanelController({
	elements: elements,
	appState: appState,
	requestJson: requestJson,
	getDocumentById: getDocumentById,
	isFolderEntry: isFolderEntry,
	getFolderSizeBytes: getFolderSizeBytes,
	buildFolderPictogramSvg: buildFolderPictogramSvg,
	buildFilePreviewSvg: buildFilePreviewSvg,
	escapeHtml: escapeHtml,
	formatBytes: formatBytes,
	formatDate: formatDate,
	onSetStatus: setStatus,
	onCreateShare: createShare,
	onHandleFileAction: handleFileAction,
	onOpenFolderTargetDialog: async function(action, fileIds) {
		await folderTargetController.openFolderTargetDialog(action, fileIds);
	},
	onDeleteDocument: deleteDocument,
	onHandleRecycleAction: handleRecycleAction,
	onLoadPage: async function() {
		await loadPage();
	},
	onSaveAsDocument: saveAsDocument,
	onViewerOpenDocument: async function(fileId, mode) {
		await viewerSessionController.openDocument(fileId, mode);
	},
	onViewerSubmitLaunchPayload: function(payload) {
		viewerSessionController.submitLaunchPayload(payload);
	},
	onCloseOpenContextMenu: closeOpenContextMenu,
	onPositionContextMenu: positionContextMenu,
	onOpenNameEntryDialog: function(options) {
		folderTargetController.openNameEntryDialog(options);
	}
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

const folderTargetController = createFolderTargetController({
	elements: elements,
	appState: appState,
	requestJson: requestJson,
	escapeHtml: escapeHtml,
	isFolderEntry: isFolderEntry,
	getDocumentById: getDocumentById,
	onSetStatus: setStatus,
	onLoadPage: async function() {
		await loadPage();
	},
	onMoveDocuments: async function(documents, targetDirectory) {
		await fileActionsController.moveDocuments(documents, targetDirectory);
	},
	onCopyDocuments: async function(documents, targetDirectory) {
		await fileActionsController.copyDocuments(documents, targetDirectory);
	},
	onMoveDocument: async function(fileId, targetNameOverride, targetDirectoryOverride) {
		await fileActionsController.moveDocument(fileId, targetNameOverride, targetDirectoryOverride);
	},
	onCopyDocument: async function(fileId, targetNameOverride, targetDirectoryOverride) {
		await fileActionsController.copyDocument(fileId, targetNameOverride, targetDirectoryOverride);
	},
	onRenderVersionList: async function(fileId) {
		await detailsPanelController.renderVersionList(fileId);
	},
	onViewerSubmitLaunchPayload: function(payload) {
		viewerSessionController.submitLaunchPayload(payload);
	}
});

fileActionsController = createFileActionsController({
	appState: appState,
	requestJson: requestJson,
	escapeHtml: escapeHtml,
	formatBytes: formatBytes,
	formatDate: formatDate,
	getDocumentById: getDocumentById,
	getBulkSelectedDocuments: function() {
		return documentListController.getBulkSelectedDocuments();
	},
	setStatus: setStatus,
	loadPage: async function() {
		await loadPage();
	},
	onCloseDetailsPanel: function() {
		detailsPanelController.closeDetailsPanel();
	},
	onOpenDetailsPanel: function(fileId) {
		detailsPanelController.openDetailsPanel(fileId);
	},
	onOpenFolderTargetDialog: async function(action, fileIds) {
		await folderTargetController.openFolderTargetDialog(action, fileIds);
	},
	onOpenDocument: async function(fileId, mode) {
		await viewerSessionController.openDocument(fileId, mode);
	}
});

contextMenuController = createContextMenuController({
	appState: appState,
	getDocumentById: getDocumentById,
	getBulkSelectedDocuments: function() {
		return documentListController.getBulkSelectedDocuments();
	},
	getBulkSelectedRecycleEntries: function() {
		return documentListController.getBulkSelectedRecycleEntries();
	},
	isFolderEntry: isFolderEntry,
	onHandleFileAction: handleFileAction,
	onHandleRecycleAction: handleRecycleAction,
	onHandleRecycleBulkAction: handleRecycleBulkAction,
	onOpenDetailsPanel: function(fileId) {
		detailsPanelController.openDetailsPanel(fileId);
	},
	onOpenUploadDialog: function(targetDirectory) {
		uploadController.openUploadDialog(targetDirectory);
	},
	onCreateDocumentInDirectory: async function(type, directory) {
		await createDocumentInDirectory(type, directory);
	},
	onCreateFolderInDirectory: async function(directory) {
		await createFolderInDirectory(directory);
	},
	onOpenFolderTargetDialog: async function(action, fileIds) {
		await folderTargetController.openFolderTargetDialog(action, fileIds);
	},
	onSaveAsDocument: saveAsDocument,
	onDeleteDocument: deleteDocument,
	onLoadPage: async function() {
		await loadPage();
	},
	onHandleBulkAction: async function(action) {
		await fileActionsController.handleBulkAction(action);
	}
});

function getDocumentById(fileId) {
	return appState.documents.find((document) => document.id === fileId) || null;
}

function applySearchFilter() {
	documentListController.renderCurrentDocumentList();
}

async function toggleRecycleView() {
	if (!appState.auth?.authenticated) {
		appState.currentView = 'files';
		documentListController.renderCurrentDocumentList();
		syncRecycleButtonState();
		return;
	}
	appState.currentView = appState.currentView === 'recycle' ? 'files' : 'recycle';
	clearSelectionAndDetailState(appState);
	await loadPage();
}

function getMissingDocuments() {
	return (appState.documents || []).filter((document) => document && document.isMissingOnDisk);
}

function closeMissingEntriesModal() {
	if (!elements.missingEntriesModal) {
		return;
	}
	elements.missingEntriesModal.classList.add('hidden');
	elements.missingEntriesModal.setAttribute('aria-hidden', 'true');
	if (elements.missingEntriesPruneConfirm) {
		elements.missingEntriesPruneConfirm.checked = false;
	}
	if (elements.missingEntriesPrune) {
		elements.missingEntriesPrune.disabled = true;
	}
}

function openMissingEntriesModal(missingEntries) {
	if (!elements.missingEntriesModal) {
		return;
	}
	const entries = Array.isArray(missingEntries) ? missingEntries : [];
	const count = entries.length;
	if (count === 0) {
		return;
	}
	if (elements.missingEntriesSummary) {
		elements.missingEntriesSummary.textContent = `${count} missing entr${count === 1 ? 'y' : 'ies'} found in the current storage context.`;
	}
	if (elements.missingEntriesList) {
		const previewEntries = entries.slice(0, 10);
		const rows = previewEntries.map((entry) => `<tr><td>${escapeHtml(entry.relativePath || entry.name || entry.id)}</td></tr>`).join('');
		elements.missingEntriesList.innerHTML = `
			<table class="admin-users-table">
				<thead><tr><th>Missing path</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
			${count > previewEntries.length ? `<div class="file-meta">+${count - previewEntries.length} more entries</div>` : ''}
		`;
	}
	if (elements.missingEntriesPruneConfirm) {
		elements.missingEntriesPruneConfirm.checked = false;
	}
	if (elements.missingEntriesPrune) {
		elements.missingEntriesPrune.disabled = true;
	}
	elements.missingEntriesModal.classList.remove('hidden');
	elements.missingEntriesModal.setAttribute('aria-hidden', 'false');
	elements.missingEntriesClose.focus();
}

async function pruneMissingEntries() {
	const payload = await requestJson('/api/files/prune-missing', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({})
	});
	const removedCount = Array.isArray(payload.removedFileIds) ? payload.removedFileIds.length : 0;
	const checkedCount = Number(payload.missingEntryCount || 0);
	setStatus(removedCount > 0
		? `Pruned ${removedCount} stale entr${removedCount === 1 ? 'y' : 'ies'} from ${checkedCount} missing entr${checkedCount === 1 ? 'y' : 'ies'}.`
		: 'No stale entries were pruned.');
}

async function pruneMissingEntriesFromModal() {
	if (!elements.missingEntriesPruneConfirm?.checked) {
		return;
	}
	await pruneMissingEntries();
	closeMissingEntriesModal();
	await loadPage();
}

async function handleRefreshClick() {
	await loadPage();
	const missingEntries = getMissingDocuments();
	if (missingEntries.length > 0) {
		openMissingEntriesModal(missingEntries);
	}
}

async function loadPage() {
	setStatus('Loading documents...');
	try {
		const [authState, config, storages] = await Promise.all([
			requestJson('/api/auth/me'),
			requestJson('/api/config'),
			requestJson('/api/storages')
		]);

		const selectedStorageId = getStorageIdFromLocation();
		appState.storages = Array.isArray(storages) ? storages : [];
		appState.currentStorageId = selectedStorageId || config.storageId || 'documents';
		appState.auth = authState;
		appState.config = config;

		const hasAccessibleStorage = appState.storages.some((s) => s.available !== false && s.enabled !== false);
		if (!hasAccessibleStorage && !authState.authenticated) {
			authController.renderAuthControls();
			authController.openLoginModal();
			setStatus('');
			return;
		}

		renderStorageSelector();
		updateStoragePath(appState.currentStorageId);

		if (!authState.authenticated) {
			appState.currentView = 'files';
		}
		if (appState.currentView === 'recycle' && !authState.authenticated) {
			appState.currentView = 'files';
		}
		let filesResponse = { documents: [] };
		try {
			filesResponse = await requestJson('/api/files');
		} catch (error) {
			if (error.status !== 503) {
				throw error;
			}
			filesResponse = { documents: [] };
		}
		const recycleResponse = authState.authenticated
			? await requestJson('/api/recycle')
			: { entries: [] };
		const loadedDocuments = Array.isArray(filesResponse.documents) ? filesResponse.documents : [];
		const loadedRecycleEntries = Array.isArray(recycleResponse.entries) ? recycleResponse.entries : [];
		appState.documents = loadedDocuments;
		appState.recycleEntries = loadedRecycleEntries;
		detailsPanelController.syncDetailThumbnailCacheWithDocuments();
		authController.applyPasswordPolicyToForms(config.passwordMinLength);
		authController.renderAuthControls();
		elements.aboutVersion.textContent = config.appVersion || 'Unknown';
		elements.documentRoot.textContent = `${config.storageName || appState.currentStorageId}${config.storageReadOnly ? ' (read-only)' : ''}`;
		elements.appBaseUrl.textContent = config.appBaseUrl;
		elements.collaboraUrl.textContent = config.collaboraPublicUrl;
		documentListController.renderCurrentDocumentList();
		syncRecycleButtonState();
		const count = appState.currentView === 'recycle' ? appState.recycleEntries.length : appState.documents.length;
		if (config.storageAvailable === false) {
			setStatus(`${config.storageName || appState.currentStorageId} is currently unavailable.`, true);
		} else {
			setStatus(`Loaded ${count} entr${count === 1 ? 'y' : 'ies'}.`);
		}
	} catch (error) {
		documentListController.renderEmptyState();
		setStatus(error.message, true);
	}
}

async function createDocumentInDirectory(type, directory) {
	folderTargetController.openNameEntryDialog({
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
	folderTargetController.openNameEntryDialog({
		action: 'new-folder',
		title: 'Create new folder',
		buttonText: 'Create folder',
		defaultValue: '',
		directory: directory || '',
		fileId: null
	});
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

const appBootstrap = createAppBootstrap({
	elements: elements,
	appState: appState,
	viewerLayoutController: viewerLayoutController,
	authController: authController,
	uploadController: uploadController,
	folderTargetController: folderTargetController,
	documentListController: documentListController,
	detailsPanelController: detailsPanelController,
	viewerSessionController: viewerSessionController,
	themeController: themeController,
	loadPage: loadPage,
	onRefreshClick: handleRefreshClick,
	closeMissingEntriesModal: closeMissingEntriesModal,
	pruneMissingEntriesFromModal: pruneMissingEntriesFromModal,
	applySearchFilter: applySearchFilter,
	closeOpenContextMenu: closeOpenContextMenu,
	toggleNewDocumentMenu: toggleNewDocumentMenu,
	toggleBulkActionsMenu: toggleBulkActionsMenu,
	setStatus: setStatus
});
elements.recycleButton?.addEventListener('click', toggleRecycleView);
elements.storageSelect?.addEventListener('change', function(event) {
	const nextStorageId = String(event.target.value || '').trim();
	if (!nextStorageId) {
		return;
	}
	appState.currentStorageId = nextStorageId;
	updateStoragePath(nextStorageId);
	loadPage();
});
elements.aboutButton.addEventListener('click', openAboutDialog);
elements.aboutCancel.addEventListener('click', closeAboutDialog);
elements.aboutModal.addEventListener('click', function(event) {
	if (event.target === elements.aboutModal) {
		closeAboutDialog();
	}
});
elements.missingEntriesModal?.addEventListener('click', function(event) {
	if (event.target === elements.missingEntriesModal) {
		closeMissingEntriesModal();
	}
});
appBootstrap.bind();
