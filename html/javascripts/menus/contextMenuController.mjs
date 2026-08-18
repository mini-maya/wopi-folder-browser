export function createContextMenuController({
	appState,
	getDocumentById,
	getBulkSelectedDocuments,
	isFolderEntry,
	onHandleFileAction,
	onOpenDetailsPanel,
	onOpenUploadDialog,
	onCreateDocumentInDirectory,
	onCreateFolderInDirectory,
	onOpenFolderTargetDialog,
	onSaveAsDocument,
	onDeleteDocument,
	onLoadPage,
	onHandleBulkAction
}) {
	function positionContextMenu(menu, button, menuWidth = 220, menuHeight = 320) {
		const buttonRect = button.getBoundingClientRect();
		const left = Math.min(window.innerWidth - menuWidth - 12, Math.max(12, buttonRect.right - menuWidth + 8));
		const top = Math.min(window.innerHeight - menuHeight - 12, Math.max(12, buttonRect.top + 8));
		menu.style.position = 'fixed';
		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;
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
				await onHandleFileAction('favorite', fileId);
				return;
			case 'details':
				onOpenDetailsPanel(fileId);
				return;
			case 'upload':
				onOpenUploadDialog(documentEntry?.relativePath || '');
				return;
			case 'new-document':
				return;
			case 'new-openoffice-text':
				await onCreateDocumentInDirectory('text', documentEntry?.relativePath || '');
				return;
			case 'new-openoffice-spreadsheet':
				await onCreateDocumentInDirectory('spreadsheet', documentEntry?.relativePath || '');
				return;
			case 'new-openoffice-presentation':
				await onCreateDocumentInDirectory('presentation', documentEntry?.relativePath || '');
				return;
			case 'new-microsoft-text':
				await onCreateDocumentInDirectory('microsoft-text', documentEntry?.relativePath || '');
				return;
			case 'new-microsoft-spreadsheet':
				await onCreateDocumentInDirectory('microsoft-spreadsheet', documentEntry?.relativePath || '');
				return;
			case 'new-microsoft-presentation':
				await onCreateDocumentInDirectory('microsoft-presentation', documentEntry?.relativePath || '');
				return;
			case 'new-folder':
				await onCreateFolderInDirectory(documentEntry?.relativePath || '');
				return;
			case 'move':
				await onOpenFolderTargetDialog('move', fileId);
				return;
			case 'copy':
				await onOpenFolderTargetDialog('copy', fileId);
				return;
			case 'save-as':
				await onSaveAsDocument(fileId);
				return;
			case 'download':
				window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
				return;
			case 'delete':
				await onDeleteDocument(fileId);
				await onLoadPage();
				return;
			default:
				return;
		}
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
		positionContextMenu(menu, button, 220, 320);
		document.body.appendChild(menu);
		button.setAttribute('aria-expanded', 'true');
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
				onHandleBulkAction(menuButton.dataset.bulkAction);
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

	return {
		showContextMenu,
		closeOpenContextMenu,
		positionContextMenu,
		toggleBulkActionsMenu,
		toggleNewDocumentMenu
	};
}
