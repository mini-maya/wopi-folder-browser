export function createFolderTargetController({
	elements,
	appState,
	requestJson,
	escapeHtml,
	isFolderEntry,
	getDocumentById,
	onSetStatus,
	onLoadPage,
	onRenderVersionList,
	onViewerSubmitLaunchPayload
}) {
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

	function openNameEntryDialog({ action, title, buttonText, defaultValue, fileId, directory, versionId, documentType }) {
		const documentEntry = fileId ? getDocumentById(fileId) : null;
		const needsTargetDirectory = action === 'new-folder';
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
			appState.folderPickerAction === 'new-document'
			|| (selectedDocument && !isFolderEntry(selectedDocument))
		) {
			selectBasenameForInput(elements.folderPickerName, elements.folderPickerName.value);
		}
	}

	async function openFolderTargetDialog(action, fileIds) {
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
		elements.folderPickerConfirm.textContent = 'Create';
		elements.folderPickerTitle.textContent = isBulkMode
			? 'Create new item in folder'
			: 'Create new item in folder';
		elements.folderPickerTarget.closest('.modal-field').classList.remove('hidden');
		elements.folderPickerName.closest('.modal-field').classList.toggle('hidden', isBulkMode);
		populateFolderPicker(selectedDocuments[0], isBulkMode);
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
			onSetStatus('Please enter a name.', true);
			return;
		}

		switch (action) {
			case 'new-document': {
				if (!appState.newDocumentType) {
					onSetStatus('Document type is missing for this creation action.', true);
					return;
				}
				onSetStatus(`Creating ${appState.newDocumentType} document...`);
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
				onViewerSubmitLaunchPayload(payload);
				await onLoadPage();
				closeFolderTargetDialog();
				onSetStatus(`Created and opened ${payload.file.name}.`);
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
				await onLoadPage();
				closeFolderTargetDialog();
				onSetStatus('Folder created.');
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
				await onRenderVersionList(fileId);
				closeFolderTargetDialog();
				onSetStatus('Version renamed.');
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
				await onRenderVersionList(fileId);
				closeFolderTargetDialog();
				onSetStatus('Current version named.');
				return;
			}
		}
	}

	return {
		openNameEntryDialog,
		prepareFolderPickerNameSelection,
		openFolderTargetDialog,
		closeFolderTargetDialog,
		submitFolderTargetDialog
	};
}
