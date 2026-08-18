export function createAppBootstrap({
	elements,
	appState,
	viewerLayoutController,
	authController,
	uploadController,
	folderTargetController,
	documentListController,
	detailsPanelController,
	viewerSessionController,
	themeController,
	loadPage,
	applySearchFilter,
	closeOpenContextMenu,
	toggleNewDocumentMenu,
	toggleBulkActionsMenu,
	setStatus
}) {
	function bind() {
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
	}

	return { bind };
}
