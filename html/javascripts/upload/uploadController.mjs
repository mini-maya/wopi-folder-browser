export function createUploadController({
	elements,
	appState,
	getUploadSummaryLabel,
	normalizeUploadRelativePath,
	buildUploadDestinationPath,
	collectDroppedUploadItems,
	escapeHtml,
	formatBytes,
	setStatus,
	loadPage,
	onCloseOpenContextMenu
}) {
	function getUploadTargetLabel() {
		return appState.uploadTargetDirectory || 'Root folder';
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
		onCloseOpenContextMenu();
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

	function setUploadDragActive(isActive) {
		appState.uploadDragActive = isActive;
		renderUploadDialog();
	}

	return {
		openUploadDialog,
		closeUploadDialog,
		handleUploadFileSelection,
		handleUploadDrop,
		submitUploadDialog,
		setUploadDragActive,
		renderUploadDialog
	};
}
