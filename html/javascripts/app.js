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
import { createToastController } from './ui/toastController.mjs';
import { createViewerLayoutController } from './viewer/layoutController.mjs';
import { createViewerSessionController } from './viewer/sessionController.mjs';
import { createAppBootstrap } from './app/bootstrap.mjs';
import { resetFilesViewState } from './state/viewState.mjs';
import { setCurrentMountId } from './state/currentMount.mjs';

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
	mountSelector: document.querySelector('#mount-selector'),
	newMenuButton: document.querySelector('#new-menu-button'),
	uploadButton: document.querySelector('#upload-button'),
	adminButton: document.querySelector('#admin-button'),
	accountButton: document.querySelector('#account-button'),
	loginButton: document.querySelector('#login-button'),
	logoutButton: document.querySelector('#logout-button'),
	userMenu: document.querySelector('#user-menu'),
	userMenuButton: document.querySelector('#user-menu-button'),
	userMenuDropdown: document.querySelector('#user-menu-dropdown'),
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
	loginPage: document.querySelector('#login-page'),
	loginForm: document.querySelector('#login-form'),
	loginUsername: document.querySelector('#login-username'),
	loginPassword: document.querySelector('#login-password'),
	loginError: document.querySelector('#login-error'),
	sharePasswordPage: document.querySelector('#share-password-page'),
	sharePasswordTitle: document.querySelector('#share-password-title'),
	sharePasswordDescription: document.querySelector('#share-password-description'),
	sharePasswordField: document.querySelector('#share-password-field'),
	sharePasswordForm: document.querySelector('#share-password-form'),
	sharePasswordInput: document.querySelector('#share-password-input'),
	sharePasswordSubmit: document.querySelector('#share-password-submit'),
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
	columnDate: document.querySelector('#column-date'),
	toastContainer: document.querySelector('#toast-container')
};

const appState = {
	documents: [],
	visibleDocuments: [],
	config: null,
	mounts: [],
	currentMountId: 'documents',
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
		mountId: 'documents'
	},
	adminUsers: [],
	adminMounts: [],
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

const toastController = createToastController({
	container: elements.toastContainer
});

const viewerLayoutController = createViewerLayoutController({
	layout: elements.layout,
	layoutSplitter: elements.layoutSplitter,
	appState: appState
});

function isFolderEntry(document) {
	return Boolean(document?.isDirectory);
}

// Persistent, page-level state (e.g. "Loading documents...", "Loaded 12
// entries.") shown inline in the sidebar. Only used for loadPage()'s own
// current-view-state messages, which should stay visible/readable in
// context rather than disappearing like a one-off notification.
function setInlineStatus(message, isError = false) {
	elements.statusMessage.textContent = message;
	elements.statusMessage.classList.toggle('error', isError);
}

// Transient action feedback (e.g. "Uploaded 3 files.", "Password
// updated.", "Share link copied to clipboard."). Injected into every
// sub-controller as `setStatus`/`onSetStatus`, so changing this single
// function routes all of that feedback through toasts without touching
// every call site.
function setStatus(message, isError = false) {
	toastController.showToast(message, isError ? 'error' : 'info');
}

// Above this many accessible mounts, tabs stop being practical (would wrap
// into multiple toolbar rows or overflow) - switch to a compact dropdown
// instead. Adjust as needed if the typical number of mounts changes.
const MOUNT_TABS_THRESHOLD = 5;

function renderMountSelector() {
	if (!elements.mountSelector) {
		return;
	}
	const mounts = Array.isArray(appState.mounts) ? appState.mounts : [];
	elements.mountSelector.innerHTML = '';
	if (mounts.length === 0) {
		const empty = document.createElement('span');
		empty.className = 'theme-label';
		empty.textContent = appState.auth?.authenticated ? 'No mounts assigned' : 'No mounts available';
		elements.mountSelector.appendChild(empty);
		return;
	}

	if (mounts.length > MOUNT_TABS_THRESHOLD) {
		renderMountSelectorAsDropdown(mounts);
	} else {
		renderMountSelectorAsTabs(mounts);
	}

	if (!mounts.some((mount) => mount.id === appState.currentMountId && mount.available !== false && mount.enabled !== false)) {
		const fallback = mounts.find((mount) => mount.available !== false && mount.enabled !== false);
		if (fallback) {
			appState.currentMountId = fallback.id;
			setCurrentMountId(fallback.id);
		}
	}
	updateWriteActionButtons();
}

function getMountOptionLabel(mount) {
	return mount.available === false
		? `${mount.name} (Unavailable)`
		: `${mount.name}${mount.readOnly ? ' (Read-only)' : ''}`;
}

function switchToMount(mountId) {
	if (!mountId || appState.currentMountId === mountId) {
		return;
	}
	appState.currentMountId = mountId;
	setCurrentMountId(mountId);
	loadPage();
}

function renderMountSelectorAsTabs(mounts) {
	for (const mount of mounts) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'secondary mount-selector-button';
		button.setAttribute('role', 'tab');
		button.setAttribute('aria-pressed', String(mount.id === appState.currentMountId));
		button.classList.toggle('is-active', mount.id === appState.currentMountId);
		button.disabled = mount.available === false || mount.enabled === false;
		button.textContent = getMountOptionLabel(mount);
		button.addEventListener('click', function() {
			if (button.disabled) {
				return;
			}
			switchToMount(mount.id);
		});
		elements.mountSelector.appendChild(button);
	}
}

function renderMountSelectorAsDropdown(mounts) {
	const select = document.createElement('select');
	select.className = 'mount-selector-dropdown';
	select.setAttribute('aria-label', 'Mounts');
	for (const mount of mounts) {
		const option = document.createElement('option');
		option.value = mount.id;
		option.disabled = mount.available === false || mount.enabled === false;
		option.selected = mount.id === appState.currentMountId;
		option.textContent = getMountOptionLabel(mount);
		select.appendChild(option);
	}
	select.addEventListener('change', function() {
		switchToMount(select.value);
	});
	elements.mountSelector.appendChild(select);
}

function updateWriteActionButtons() {
	const currentMount = appState.mounts?.find((mount) => mount.id === appState.currentMountId);
	const isReadOnly = currentMount?.readOnly === true;
	const isUnauthenticated = !appState.auth?.authenticated;

	if (elements.newMenuButton) {
		elements.newMenuButton.disabled = isReadOnly || isUnauthenticated;
	}
	if (elements.uploadButton) {
		elements.uploadButton.disabled = isReadOnly || isUnauthenticated;
	}
}

let fileActionsController = null;
let contextMenuController = null;

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
		appState.mounts = [];
		appState.auth = null;
		// Reset the remembered mount selection so a different user logging in
		// afterwards (in the same tab, without a full page reload) doesn't
		// keep sending the previous user's (possibly inaccessible) mount id
		// as an X-Mount-Id hint, which would surface a spurious "no access to
		// mount X" error and leave the stale mount button in the selector.
		appState.currentMountId = null;
		setCurrentMountId(null);
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
	onHandleFileAction: handleFileAction
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
	onLoadPage: async function() {
		await loadPage();
	},
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
		elements.missingEntriesSummary.textContent = `${count} missing entr${count === 1 ? 'y' : 'ies'} found in the current mount context.`;
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
	setInlineStatus('Loading documents...');
	try {
		const authState = await requestJson('/api/auth/me');
		const config = await requestJson('/api/config');
		appState.auth = authState;
		appState.config = config;

		if (!authState.authenticated) {
			appState.mounts = [];
			documentListController.renderEmptyState();
			authController.renderAuthControls();
			authController.showLoginPage();
			setInlineStatus('');
			return;
		}

		authController.hideLoginPage();
		const mounts = await requestJson('/api/mounts');
		appState.mounts = Array.isArray(mounts) ? mounts : [];
		if (!appState.currentMountId) {
			appState.currentMountId = config.mountId || 'documents';
		}

		const accessibleMounts = appState.mounts.filter((mount) => mount.available !== false && mount.enabled !== false);
		const hasAccessibleMount = accessibleMounts.length > 0;
		const selectedMount = appState.mounts.find((mount) => mount.id === appState.currentMountId && mount.available !== false && mount.enabled !== false) || null;
		if (!selectedMount && hasAccessibleMount) {
			const fallbackMount = accessibleMounts[0];
			appState.currentMountId = fallbackMount.id;
			setInlineStatus('You do not have access to that mount. Switched to an available mount.', true);
		}
		setCurrentMountId(appState.currentMountId);

		renderMountSelector();
		if (authState.authenticated && !hasAccessibleMount) {
			documentListController.renderEmptyState();
			authController.renderAuthControls();
			setInlineStatus('No mounts are assigned to your account.', true);
			return;
		}

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
		const loadedDocuments = Array.isArray(filesResponse.documents) ? filesResponse.documents : [];
		appState.documents = loadedDocuments;
		detailsPanelController.syncDetailThumbnailCacheWithDocuments();
		authController.applyPasswordPolicyToForms(config.passwordMinLength);
		authController.renderAuthControls();
		elements.aboutVersion.textContent = config.appVersion || 'Unknown';
		elements.documentRoot.textContent = `${config.mountName || appState.currentMountId}${config.mountAvailable === false ? ' (unavailable)' : ''}`;
		elements.appBaseUrl.textContent = config.appBaseUrl;
		elements.collaboraUrl.textContent = config.collaboraPublicUrl;
		documentListController.renderCurrentDocumentList();
		const count = appState.documents.length;
		if (config.mountAvailable === false) {
			setInlineStatus(`${config.mountName || appState.currentMountId} is currently unavailable.`, true);
		} else {
			setInlineStatus(`Loaded ${count} entr${count === 1 ? 'y' : 'ies'}.`);
		}
	} catch (error) {
		documentListController.renderEmptyState();
		setInlineStatus(error.message, true);
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
