import { getFolderSelectionState, getFolderSizeBytes, getVisibleTreeEntries } from './tree/fileBrowserTree.mjs';
import { requestJson } from './api/requestJson.mjs';
import { collectDroppedUploadItems } from './upload/dropItems.mjs';
import { buildUploadDestinationPath, getUploadSummaryLabel, normalizeUploadRelativePath } from './upload/uploadPaths.mjs';
import { createUploadController } from './upload/uploadController.mjs';
import { buildFilePreviewSvg, buildFolderPictogramSvg, folderContainsFiles } from './ui/filePreviews.mjs';
import { escapeHtml, formatBytes, formatDate } from './ui/formatting.mjs';
import { createDocumentListController } from './documents/listController.mjs';
import { createDetailsPanelController } from './documents/detailsPanelController.mjs';
import { createFolderTargetController } from './dialogs/folderTargetController.mjs';
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
	onMoveDocuments: moveDocuments,
	onCopyDocuments: copyDocuments,
	onMoveDocument: moveDocument,
	onCopyDocument: copyDocument,
	onRenderVersionList: async function(fileId) {
		await detailsPanelController.renderVersionList(fileId);
	},
	onViewerSubmitLaunchPayload: function(payload) {
		viewerSessionController.submitLaunchPayload(payload);
	}
});

function getDocumentById(fileId) {
	return appState.documents.find((document) => document.id === fileId) || null;
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
			await folderTargetController.openFolderTargetDialog('move', selectedDocuments.map((document) => document.id));
			return;
		case 'copy':
			await folderTargetController.openFolderTargetDialog('copy', selectedDocuments.map((document) => document.id));
			return;
		case 'delete':
			await deleteSelectedDocuments(selectedDocuments);
			return;
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
		detailsPanelController.syncDetailThumbnailCacheWithDocuments();
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
	detailsPanelController.closeDetailsPanel();
	await loadPage();
	setStatus(`Deleted ${documents.length} selected item${documents.length === 1 ? '' : 's'}.`);
}

async function saveAsDocument(fileId) {
	const document = getDocumentById(fileId);
	if (!document) {
		setStatus('The document could not be found.', true);
		return;
	}
	folderTargetController.openFolderTargetDialog('save-as', fileId);
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
			detailsPanelController.openDetailsPanel(fileId);
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
			await folderTargetController.openFolderTargetDialog('move', fileId);
			return;
		case 'copy':
			await folderTargetController.openFolderTargetDialog('copy', fileId);
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
				detailsPanelController.openDetailsPanel(fileId);
				return;
			case 'download':
				window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
				return;
			case 'copy':
				await folderTargetController.openFolderTargetDialog('copy', fileId);
				break;
			case 'move':
				await folderTargetController.openFolderTargetDialog('move', fileId);
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
elements.folderPickerCancel.addEventListener('click', folderTargetController.closeFolderTargetDialog);
elements.folderPickerForm.addEventListener('submit', folderTargetController.submitFolderTargetDialog);
elements.folderPickerName.addEventListener('focus', folderTargetController.prepareFolderPickerNameSelection);
elements.folderPickerModal.addEventListener('click', function(event) {
if (event.target === elements.folderPickerModal) {
	folderTargetController.closeFolderTargetDialog();
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
elements.closeDetailsPanelButton.addEventListener('click', detailsPanelController.closeDetailsPanel);
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
