const OFFICE_THUMBNAIL_EXTENSIONS = new Set([
	'.doc', '.docx', '.odt',
	'.xls', '.xlsx', '.ods',
	'.ppt', '.pptx', '.odp'
]);

export function createDetailsPanelController({
	elements,
	appState,
	requestJson,
	getDocumentById,
	isFolderEntry,
	getFolderSizeBytes,
	buildFolderPictogramSvg,
	buildFilePreviewSvg,
	escapeHtml,
	formatBytes,
	formatDate,
	onSetStatus,
	onCreateShare,
	onHandleFileAction,
	onOpenFolderTargetDialog,
	onDeleteDocument,
	onLoadPage,
	onSaveAsDocument,
	onViewerOpenDocument,
	onViewerSubmitLaunchPayload,
	onCloseOpenContextMenu,
	onPositionContextMenu,
	onOpenNameEntryDialog
}) {
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
			await onCreateShare(fileId);
		});
	}

	async function renderActivityTabContent(fileId, container) {
		container.innerHTML = '<div class="tab-loading">Loading activities…</div>';
		try {
			const payload = await requestJson('/api/activities?limit=200');
			const allActivities = Array.isArray(payload.activities) ? payload.activities : [];
			const activities = allActivities.filter((activityEntry) => activityEntry.fileId === fileId);

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
					${activities.map(function(activityEntry) {
						const label = activityLabels[activityEntry.type] || activityEntry.type;
						const countNote = activityEntry.count && activityEntry.count > 1 ? ` <span class="activity-count">×${activityEntry.count}</span>` : '';
						return `
							<li class="activity-item">
								<div class="activity-item-dot" aria-hidden="true"></div>
								<div class="activity-item-body">
									<span class="activity-item-action">${escapeHtml(label)}${countNote}</span>
									<span class="activity-item-meta">
										<span class="activity-item-user">${escapeHtml(activityEntry.userName || activityEntry.userId || 'Unknown')}</span>
										<span class="activity-item-time">${formatDate(activityEntry.createdAt)}</span>
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

					onCloseOpenContextMenu();
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
							onCloseOpenContextMenu();
							handleVersionAction(menuButton.dataset.contextAction, fileId, version.id);
						});
					}
					onPositionContextMenu(menu, button, 220, 220);
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
			for (const button of tabButtons) {
				button.classList.toggle('active', button.dataset.tab === 'versions');
				button.setAttribute('aria-selected', button.dataset.tab === 'versions' ? 'true' : 'false');
			}
			await renderVersionsTabContent(fileId, container);
		}
	}

	async function handleDetailsAction(action, fileId) {
		const document = getDocumentById(fileId);
		switch (action) {
			case 'details-toggle-favorite':
				await onHandleFileAction('favorite', fileId);
				openDetailsPanel(fileId);
				return;
			case 'details-view':
				if (isFolderEntry(document)) {
					onSetStatus('Folders cannot be previewed.', true);
					return;
				}
				await onViewerOpenDocument(fileId, 'view');
				return;
			case 'details-open':
				if (isFolderEntry(document)) {
					onSetStatus('Folders cannot be opened in Collabora.', true);
					return;
				}
				await onViewerOpenDocument(fileId, 'edit');
				return;
			case 'details-share':
				if (isFolderEntry(document)) {
					onSetStatus('Folders cannot be shared.', true);
					return;
				}
				await onCreateShare(fileId);
				return;
			case 'details-move':
				await onOpenFolderTargetDialog('move', fileId);
				return;
			case 'details-copy':
				await onOpenFolderTargetDialog('copy', fileId);
				return;
			case 'details-download':
				if (isFolderEntry(document)) {
					onSetStatus('Folders cannot be downloaded.', true);
					return;
				}
				window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
				return;
			case 'details-delete':
				await onDeleteDocument(fileId);
				await onLoadPage();
				closeDetailsPanel();
				return;
			case 'details-save-as':
				await onSaveAsDocument(fileId);
				return;
			case 'details-versions':
				await renderVersionList(fileId);
				return;
			default:
				return;
		}
	}

	async function getVersionLabel(fileId, versionId) {
		const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/versions`);
		const version = payload.versions.find((entry) => entry.id === versionId);
		return version?.label ?? '';
	}

	async function handleVersionAction(action, fileId, versionId) {
		if (!versionId) {
			return;
		}
		switch (action) {
			case 'version-rename': {
				const initialName = await getVersionLabel(fileId, versionId);
				onOpenNameEntryDialog({
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
				onViewerSubmitLaunchPayload(payload);
				return;
			}
			case 'version-name-current': {
				const initialName = await getVersionLabel(fileId, versionId);
				onOpenNameEntryDialog({
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
				await onLoadPage();
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

	return {
		syncDetailThumbnailCacheWithDocuments,
		openDetailsPanel,
		closeDetailsPanel,
		renderVersionList
	};
}
