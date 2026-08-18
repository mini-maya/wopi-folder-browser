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
	aboutModal: document.querySelector('#about-modal'),
	aboutCancel: document.querySelector('#about-cancel'),
	aboutVersion: document.querySelector('#about-version')
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

async function deleteDocument(fileId) {
	if (!fileActionsController) {
		return;
	}
	await fileActionsController.deleteDocument(fileId);
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
	onDeleteDocument: deleteDocument,
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
		detailsPanelController.syncDetailThumbnailCacheWithDocuments();
		appState.auth.storageContext = config.storageContext || appState.auth.storageContext || 'shared';
		authController.applyPasswordPolicyToForms(config.passwordMinLength);
		authController.renderAuthControls();
		elements.aboutVersion.textContent = config.appVersion || 'Unknown';
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
appBootstrap.bind();