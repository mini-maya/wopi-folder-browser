import { getIcon } from '../icons/iconRegistry.mjs';

const menuIcons = new Proxy({}, {
	get(target, prop) {
		return getIcon(prop);
	}
});

function createMenuItem(action, fileId, label) {
	const icon = menuIcons[action] || '';
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.dataset.contextAction = action;
	if (fileId) {
		btn.dataset.fileId = fileId;
	}
	btn.innerHTML = `${icon}${label}`;
	return btn;
}

function createBulkMenuItem(action, label) {
	const icon = menuIcons[action] || '';
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.dataset.bulkAction = action;
	btn.innerHTML = `${icon}${label}`;
	return btn;
}

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
		if (documentEntry?.isMissingOnDisk && action !== 'details') {
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
			case 'download':
				window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
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
		const isMissingOnDisk = Boolean(documentEntry.isMissingOnDisk);
		const menu = document.createElement('div');
		menu.className = 'context-menu';
		if (isMissingOnDisk) {
			menu.appendChild(createMenuItem('details', documentEntry.id, 'Details'));
		} else {
			menu.appendChild(createMenuItem('favorite', documentEntry.id, documentEntry.favorite ? 'Remove from favorites' : 'Add to favorites'));
			if (isFolder) {
				const newDocBtn = createMenuItem('new-document', documentEntry.id, 'New...');
				newDocBtn.classList.add('has-submenu');
				menu.appendChild(newDocBtn);
				const submenu = document.createElement('div');
				submenu.className = 'context-menu-submenu hidden';
				submenu.dataset.submenu = 'new-document';
				submenu.setAttribute('aria-label', 'New document submenu');
				submenu.appendChild(createMenuItem('new-folder', documentEntry.id, 'New folder'));
				submenu.appendChild(document.createElement('div')).className = 'context-menu-separator';
				submenu.appendChild(createMenuItem('new-openoffice-text', documentEntry.id, 'New OpenOffice text document'));
				submenu.appendChild(createMenuItem('new-openoffice-spreadsheet', documentEntry.id, 'New OpenOffice spreadsheet'));
				submenu.appendChild(createMenuItem('new-openoffice-presentation', documentEntry.id, 'New OpenOffice presentation'));
				submenu.appendChild(document.createElement('div')).className = 'context-menu-separator';
				submenu.appendChild(createMenuItem('new-microsoft-text', documentEntry.id, 'New Microsoft Word document'));
				submenu.appendChild(createMenuItem('new-microsoft-spreadsheet', documentEntry.id, 'New Microsoft Excel spreadsheet'));
				submenu.appendChild(createMenuItem('new-microsoft-presentation', documentEntry.id, 'New Microsoft PowerPoint presentation'));
				menu.appendChild(submenu);
				menu.appendChild(createMenuItem('upload', documentEntry.id, 'Upload...'));
			}
			menu.appendChild(createMenuItem('download', documentEntry.id, 'Download'));
			menu.appendChild(document.createElement('div')).className = 'context-menu-separator';
			menu.appendChild(createMenuItem('details', documentEntry.id, 'Details'));
		}
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
		menu.appendChild(createBulkMenuItem('favorite', 'Add to favorites'));
		menu.appendChild(createBulkMenuItem('download', 'Download'));
		for (const menuButton of menu.querySelectorAll('[data-bulk-action]')) {
			menuButton.addEventListener('click', function(event) {
				event.preventDefault();
				event.stopPropagation();
				closeOpenContextMenu();
				onHandleBulkAction(menuButton.dataset.bulkAction);
			});
		}
		positionContextMenu(menu, button, 220, 160);
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
		menu.appendChild(createMenuItem('new-folder', null, 'New folder'));
		menu.appendChild(document.createElement('div')).className = 'context-menu-separator';
		menu.appendChild(createMenuItem('new-openoffice-text', null, 'New OpenOffice text document'));
		menu.appendChild(createMenuItem('new-openoffice-spreadsheet', null, 'New OpenOffice spreadsheet'));
		menu.appendChild(createMenuItem('new-openoffice-presentation', null, 'New OpenOffice presentation'));
		menu.appendChild(document.createElement('div')).className = 'context-menu-separator';
		menu.appendChild(createMenuItem('new-microsoft-text', null, 'New Microsoft Word document'));
		menu.appendChild(createMenuItem('new-microsoft-spreadsheet', null, 'New Microsoft Excel spreadsheet'));
		menu.appendChild(createMenuItem('new-microsoft-presentation', null, 'New Microsoft PowerPoint presentation'));
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
