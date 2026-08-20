import { getActivityLabel } from './activityLabels.mjs';

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
		const isMissingOnDisk = Boolean(document.isMissingOnDisk);
		const folderSizeBytes = isFolder ? getFolderSizeBytes(document, appState.documents) : document.size;
		const previewClass = isFolder ? 'folder-icon' : '';
		const favoriteLabel = document.favorite ? '★ Favorite' : '☆ Favorite';
		if (isMissingOnDisk) {
			elements.detailsPanelContent.innerHTML = `
				<div class="details-card">
					<div class="details-preview">
						<img class="${previewClass}" src="${getPreviewImage(document)}" alt="${escapeHtml(document.name)} preview">
					</div>
					<div class="details-header">
						<h3>${escapeHtml(document.name)}</h3>
					</div>
					<div class="detail-meta">
						<div class="detail-meta-row"><span>Status</span><strong>Missing on disk</strong></div>
						<div class="detail-meta-row"><span>Type</span><strong>${isFolder ? 'Folder' : 'File'}</strong></div>
						<div class="detail-meta-row"><span>Path</span><strong>${escapeHtml(document.relativePath)}</strong></div>
					</div>
					<p class="tab-empty tab-error">This entry is currently not available in the filesystem. Only details are shown.</p>
				</div>
			`;
			return;
		}

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
		if (!isFolder && !isMissingOnDisk) {
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

	function formatShareStatus(status) {
		const normalized = String(status || 'active').toLowerCase();
		if (normalized === 'expired') {
			return 'Expired';
		}
		if (normalized === 'exhausted') {
			return 'Exhausted';
		}
		if (normalized === 'revoked') {
			return 'Revoked';
		}
		return 'Active';
	}

	function toDateInputValue(isoValue) {
		if (!isoValue) {
			return '';
		}
		const date = new Date(isoValue);
		if (Number.isNaN(date.getTime())) {
			return '';
		}
		return date.toISOString().slice(0, 10);
	}

	function parseDateInputValue(value) {
		const normalized = String(value || '').trim();
		if (!normalized) {
			return null;
		}
		const date = new Date(`${normalized}T23:59:59Z`);
		if (Number.isNaN(date.getTime())) {
			return null;
		}
		return date.toISOString();
	}

	function setShareFieldEnabled(section, selector, enabled) {
		const field = section.querySelector(selector);
		if (!field) {
			return;
		}
		field.disabled = !enabled;
		if (!enabled) {
			field.value = '';
		}
	}

	function setShareTabMessage(container, message, isError = false) {
		const element = container.querySelector('.share-tab-message');
		if (!element) {
			return;
		}
		const text = String(message || '').trim();
		element.textContent = text;
		element.classList.toggle('is-error', isError);
		element.classList.toggle('is-visible', Boolean(text));
	}

	function setSectionBusyState(section, isBusy) {
		section.classList.toggle('is-busy', isBusy);
		for (const control of section.querySelectorAll('button, input, select, textarea')) {
			if (isBusy) {
				control.dataset.busyWasDisabled = control.disabled ? '1' : '0';
				control.disabled = true;
				continue;
			}
			const wasDisabled = control.dataset.busyWasDisabled === '1';
			delete control.dataset.busyWasDisabled;
			control.disabled = wasDisabled;
		}
	}

	async function copyShareLinkToClipboard(url) {
		try {
			await navigator.clipboard.writeText(url);
			onSetStatus('Share link copied to clipboard.');
		} catch (error) {
			window.prompt('Copy share link', url);
		}
	}

	function renderShareListMarkup(fileId, shares) {
		const shareCards = shares.length
			? shares.map((share) => {
				const statusClass = String(share.status || 'active').toLowerCase();
				return `
					<div class="share-link-card" data-share-id="${share.id}">
						<div class="share-link-header">
							<span class="share-status-badge status-${escapeHtml(statusClass)}">${escapeHtml(formatShareStatus(share.status))}</span>
							<small class="share-access-count">${escapeHtml(String(share.accessCount || 0))}${share.maxAccessCount ? ` / ${escapeHtml(String(share.maxAccessCount))}` : ''} accesses</small>
						</div>
						<label class="share-field">
							<span>Public link</span>
							<input type="text" class="share-url-input" value="${escapeHtml(share.url || '')}" readonly>
						</label>
						<div class="share-actions-inline">
							<button type="button" class="secondary" data-share-action="copy-link">Copy link</button>
						</div>
						<div class="share-grid">
							<label class="share-field">
								<span>Permission</span>
								<select class="share-permission-select">
									<option value="read"${share.permission === 'read' ? ' selected' : ''}>Read</option>
									<option value="read_write"${share.permission === 'read_write' ? ' selected' : ''}>Read & write</option>
								</select>
							</label>
							<label class="share-field checkbox">
								<input type="checkbox" class="share-download-enabled"${share.downloadEnabled !== false ? ' checked' : ''}>
								<span>Download enabled</span>
							</label>
						</div>
						<div class="share-grid">
							<label class="share-field checkbox">
								<input type="checkbox" class="share-password-enabled"${share.passwordEnabled ? ' checked' : ''}>
								<span>Password protect</span>
							</label>
							<label class="share-field">
								<span>New password</span>
								<input type="password" class="share-password-input" placeholder="${share.passwordEnabled ? 'Leave empty to keep current password' : 'Optional'}">
							</label>
						</div>
						<div class="share-grid">
							<label class="share-field checkbox">
								<input type="checkbox" class="share-expiry-enabled"${share.expiresAt ? ' checked' : ''}>
								<span>Expires</span>
							</label>
							<label class="share-field">
								<span>Expiry date</span>
								<input type="date" class="share-expiry-input" value="${escapeHtml(toDateInputValue(share.expiresAt))}">
							</label>
						</div>
						<div class="share-grid">
							<label class="share-field checkbox">
								<input type="checkbox" class="share-limit-enabled"${share.maxAccessCount ? ' checked' : ''}>
								<span>Access limit</span>
							</label>
							<label class="share-field">
								<span>Max accesses</span>
								<input type="number" class="share-limit-input" min="1" step="1" value="${share.maxAccessCount ? escapeHtml(String(share.maxAccessCount)) : ''}">
							</label>
						</div>
						<label class="share-field">
							<span>Note</span>
							<textarea class="share-note-input" rows="2">${escapeHtml(share.note || '')}</textarea>
						</label>
						<div class="share-actions-inline">
							<button type="button" data-share-action="save">Save</button>
							<button type="button" class="secondary" data-share-action="revoke">Revoke</button>
							<button type="button" class="danger" data-share-action="delete">Delete</button>
						</div>
					</div>
				`;
			}).join('')
			: '<div class="tab-empty">No public links for this file yet.</div>';

		return `
			<div class="tab-section">
				<p class="tab-section-description">Create and manage public links for this file.</p>
				<div class="share-tab-message" role="status" aria-live="polite"></div>
				<form class="share-create-form" data-share-file-id="${fileId}">
					<div class="share-grid">
						<label class="share-field">
							<span>Permission</span>
							<select name="permission">
								<option value="read" selected>Read</option>
								<option value="read_write">Read & write</option>
							</select>
						</label>
						<label class="share-field">
							<span>Password (optional)</span>
							<input type="password" name="password" placeholder="Optional">
						</label>
					</div>
					<div class="share-grid">
						<label class="share-field checkbox">
							<input type="checkbox" name="downloadEnabled" checked>
							<span>Download enabled</span>
						</label>
						<label class="share-field checkbox">
							<input type="checkbox" name="expiresEnabled">
							<span>Expires</span>
						</label>
					</div>
					<div class="share-grid">
						<label class="share-field">
							<span>Expiry date</span>
							<input type="date" name="expiresAt">
						</label>
						<label class="share-field checkbox">
							<input type="checkbox" name="limitEnabled">
							<span>Access limit</span>
						</label>
					</div>
					<div class="share-grid">
						<label class="share-field">
							<span>Max accesses</span>
							<input type="number" min="1" step="1" name="maxAccessCount" placeholder="Unlimited">
						</label>
						<label class="share-field">
							<span>Note</span>
							<input type="text" name="note" placeholder="Optional note">
						</label>
					</div>
					<div class="share-actions-inline">
						<button type="submit">Create public link</button>
					</div>
				</form>
				<div class="share-list">
					${shareCards}
				</div>
			</div>
		`;
	}

	async function renderShareTabContent(fileId, container) {
		container.innerHTML = '<div class="tab-loading">Loading shares…</div>';
		try {
			const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/public-shares`);
			const shares = Array.isArray(payload?.shares) ? payload.shares : [];
			container.innerHTML = renderShareListMarkup(fileId, shares);

			const createForm = container.querySelector('.share-create-form');
			if (createForm) {
				const expiresEnabledInput = createForm.querySelector('input[name="expiresEnabled"]');
				const expiresAtInput = createForm.querySelector('input[name="expiresAt"]');
				const limitEnabledInput = createForm.querySelector('input[name="limitEnabled"]');
				const maxAccessInput = createForm.querySelector('input[name="maxAccessCount"]');
				expiresEnabledInput?.addEventListener('change', function() {
					setShareFieldEnabled(createForm, 'input[name="expiresAt"]', expiresEnabledInput.checked);
				});
				limitEnabledInput?.addEventListener('change', function() {
					setShareFieldEnabled(createForm, 'input[name="maxAccessCount"]', limitEnabledInput.checked);
				});
				if (expiresAtInput) {
					expiresAtInput.disabled = !expiresEnabledInput?.checked;
				}
				if (maxAccessInput) {
					maxAccessInput.disabled = !limitEnabledInput?.checked;
				}
				createForm.addEventListener('submit', async function(event) {
					event.preventDefault();
					const formData = new FormData(createForm);
					const expiresEnabled = formData.get('expiresEnabled') === 'on';
					const limitEnabled = formData.get('limitEnabled') === 'on';
					const rawMax = String(formData.get('maxAccessCount') || '').trim();
					if (limitEnabled && (!rawMax || Number.parseInt(rawMax, 10) < 1)) {
						setShareTabMessage(container, 'Max accesses must be an integer >= 1.', true);
						onSetStatus('Max accesses must be an integer >= 1.', true);
						return;
					}
					if (expiresEnabled && !parseDateInputValue(formData.get('expiresAt'))) {
						setShareTabMessage(container, 'Please provide a valid expiry date.', true);
						onSetStatus('Please provide a valid expiry date.', true);
						return;
					}
					const body = {
						permission: String(formData.get('permission') || 'read'),
						password: String(formData.get('password') || '').trim() || null,
						downloadEnabled: formData.get('downloadEnabled') === 'on',
						expiresAt: expiresEnabled ? parseDateInputValue(formData.get('expiresAt')) : null,
						maxAccessCount: limitEnabled ? Number.parseInt(rawMax, 10) : null,
						note: String(formData.get('note') || '').trim() || null
					};
					setShareTabMessage(container, '');
					setSectionBusyState(createForm, true);
					try {
						await requestJson(`/api/files/${encodeURIComponent(fileId)}/public-share`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(body)
						});
						await renderShareTabContent(fileId, container);
						onSetStatus('Public link created.');
					} catch (error) {
						setShareTabMessage(container, error.message || 'Could not create public link.', true);
						onSetStatus(error.message || 'Could not create public link.', true);
					} finally {
						setSectionBusyState(createForm, false);
					}
				});
			}

			for (const card of container.querySelectorAll('.share-link-card')) {
				const shareId = card.getAttribute('data-share-id');
				const copyButton = card.querySelector('[data-share-action="copy-link"]');
				const saveButton = card.querySelector('[data-share-action="save"]');
				const revokeButton = card.querySelector('[data-share-action="revoke"]');
				const deleteButton = card.querySelector('[data-share-action="delete"]');
				const urlInput = card.querySelector('.share-url-input');
				const passwordEnabledInput = card.querySelector('.share-password-enabled');
				const passwordInput = card.querySelector('.share-password-input');
				const expiryEnabledInput = card.querySelector('.share-expiry-enabled');
				const expiryInput = card.querySelector('.share-expiry-input');
				const limitEnabledInput = card.querySelector('.share-limit-enabled');
				const limitInput = card.querySelector('.share-limit-input');
				passwordEnabledInput?.addEventListener('change', function() {
					setShareFieldEnabled(card, '.share-password-input', passwordEnabledInput.checked);
				});
				expiryEnabledInput?.addEventListener('change', function() {
					setShareFieldEnabled(card, '.share-expiry-input', expiryEnabledInput.checked);
				});
				limitEnabledInput?.addEventListener('change', function() {
					setShareFieldEnabled(card, '.share-limit-input', limitEnabledInput.checked);
				});
				if (passwordInput) {
					passwordInput.disabled = !passwordEnabledInput?.checked;
				}
				if (expiryInput) {
					expiryInput.disabled = !expiryEnabledInput?.checked;
				}
				if (limitInput) {
					limitInput.disabled = !limitEnabledInput?.checked;
				}
				const isRevoked = card.querySelector('.share-status-badge')?.classList.contains('status-revoked');
				if (isRevoked) {
					for (const control of card.querySelectorAll('input, select, textarea, button')) {
						if (control !== copyButton && control !== deleteButton) {
							control.disabled = true;
						}
					}
				}

				copyButton?.addEventListener('click', async function() {
					await copyShareLinkToClipboard(urlInput?.value || '');
				});

				saveButton?.addEventListener('click', async function() {
					const permission = card.querySelector('.share-permission-select')?.value || 'read';
					const downloadEnabled = card.querySelector('.share-download-enabled')?.checked === true;
					const passwordEnabled = passwordEnabledInput?.checked === true;
					const expiresEnabled = expiryEnabledInput?.checked === true;
					const limitEnabled = limitEnabledInput?.checked === true;
					const note = card.querySelector('.share-note-input')?.value || '';
					const payload = {
						permission: permission,
						downloadEnabled: downloadEnabled,
						expiresAt: expiresEnabled ? parseDateInputValue(expiryInput?.value) : null,
						maxAccessCount: limitEnabled
							? Number.parseInt(String(limitInput?.value || '').trim(), 10)
							: null,
						note: note.trim() || null
					};
					if (limitEnabled && (!Number.isInteger(payload.maxAccessCount) || payload.maxAccessCount < 1)) {
						setShareTabMessage(container, 'Max accesses must be an integer >= 1.', true);
						onSetStatus('Max accesses must be an integer >= 1.', true);
						return;
					}
					if (expiresEnabled && !payload.expiresAt) {
						setShareTabMessage(container, 'Please provide a valid expiry date.', true);
						onSetStatus('Please provide a valid expiry date.', true);
						return;
					}
					if (!passwordEnabled) {
						payload.password = null;
					} else if (String(passwordInput?.value || '').trim()) {
						payload.password = String(passwordInput.value).trim();
					}
					setShareTabMessage(container, '');
					setSectionBusyState(card, true);
					try {
						await requestJson(`/api/public-shares/${encodeURIComponent(shareId)}`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(payload)
						});
						await renderShareTabContent(fileId, container);
						onSetStatus('Public link updated.');
					} catch (error) {
						setShareTabMessage(container, error.message || 'Could not update public link.', true);
						onSetStatus(error.message || 'Could not update public link.', true);
					} finally {
						setSectionBusyState(card, false);
					}
				});

				revokeButton?.addEventListener('click', async function() {
					setShareTabMessage(container, '');
					setSectionBusyState(card, true);
					try {
						await requestJson(`/api/public-shares/${encodeURIComponent(shareId)}`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ status: 'revoked' })
						});
						await renderShareTabContent(fileId, container);
						onSetStatus('Public link revoked.');
					} catch (error) {
						setShareTabMessage(container, error.message || 'Could not revoke public link.', true);
						onSetStatus(error.message || 'Could not revoke public link.', true);
					} finally {
						setSectionBusyState(card, false);
					}
				});

				deleteButton?.addEventListener('click', async function() {
					if (!window.confirm('Delete this public link?')) {
						return;
					}
					setShareTabMessage(container, '');
					setSectionBusyState(card, true);
					try {
						await requestJson(`/api/public-shares/${encodeURIComponent(shareId)}`, {
							method: 'DELETE'
						});
						await renderShareTabContent(fileId, container);
						onSetStatus('Public link deleted.');
					} catch (error) {
						setShareTabMessage(container, error.message || 'Could not delete public link.', true);
						onSetStatus(error.message || 'Could not delete public link.', true);
					} finally {
						setSectionBusyState(card, false);
					}
				});
			}
		} catch (error) {
			container.innerHTML = `<div class="tab-empty tab-error">Could not load shares: ${escapeHtml(error.message)}</div>`;
		}
	}

	async function renderActivityTabContent(fileId, container) {
		container.innerHTML = '<div class="tab-loading">Loading activities…</div>';
		try {
			const payload = await requestJson('/api/activities?limit=200');
			const allActivities = Array.isArray(payload.activities) ? payload.activities : [];
			const activities = allActivities.filter((activityEntry) => activityEntry.fileId === fileId);

			if (!activities.length) {
				container.innerHTML = '<div class="tab-empty">No activity recorded yet.</div>';
				return;
			}

			container.innerHTML = `
				<ul class="activity-list" aria-label="File activity">
					${activities.map(function(activityEntry) {
						const label = getActivityLabel(activityEntry.type);
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
		if (document?.isMissingOnDisk) {
			onSetStatus('This entry is currently missing on disk. Only details are available.', true);
			return;
		}
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
