export function createFileActionsController({
	appState,
	requestJson,
	escapeHtml,
	formatBytes,
	formatDate,
	getDocumentById,
	getBulkSelectedDocuments,
	setStatus,
	loadPage,
	onCloseDetailsPanel,
	onOpenDetailsPanel,
	onOpenFolderTargetDialog,
	onOpenDocument
}) {
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
					appState.applyConflictToAll = !!modal.querySelector('#conflict-apply-all')?.checked;
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

	async function setFavoriteState(fileId, favorite) {
		await requestJson(`/api/files/${encodeURIComponent(fileId)}/favorite`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ favorite: favorite })
		});
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
		onCloseDetailsPanel();
		await loadPage();
		setStatus(`Deleted ${documents.length} selected item${documents.length === 1 ? '' : 's'}.`);
	}

	async function saveAsDocument(fileId) {
		const document = getDocumentById(fileId);
		if (!document) {
			setStatus('The document could not be found.', true);
			return;
		}
		await onOpenFolderTargetDialog('save-as', fileId);
	}

	async function deleteDocument(fileId) {
		if (!window.confirm('Delete this document?')) {
			return;
		}

		await requestJson(`/api/files/${encodeURIComponent(fileId)}`, {
			method: 'DELETE'
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

	async function handleBulkAction(action) {
		const selectedDocuments = getBulkSelectedDocuments();
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
				await onOpenFolderTargetDialog('move', selectedDocuments.map((document) => document.id));
				return;
			case 'copy':
				await onOpenFolderTargetDialog('copy', selectedDocuments.map((document) => document.id));
				return;
			case 'delete':
				await deleteSelectedDocuments(selectedDocuments);
				return;
			default:
				return;
		}
	}

	async function handleFileAction(action, fileId, mode) {
		try {
			switch (action) {
				case 'open':
					await onOpenDocument(fileId, mode || 'edit');
					return;
				case 'details':
					onOpenDetailsPanel(fileId);
					return;
				case 'download':
					window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
					return;
				case 'copy':
					await onOpenFolderTargetDialog('copy', fileId);
					break;
				case 'move':
					await onOpenFolderTargetDialog('move', fileId);
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

	return {
		moveDocument,
		copyDocument,
		moveDocuments,
		copyDocuments,
		deleteDocument,
		saveAsDocument,
		createShare,
		handleBulkAction,
		handleFileAction
	};
}
