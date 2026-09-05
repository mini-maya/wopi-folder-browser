import { getFileTypeKey } from '../ui/filePreviews.mjs';

export function createViewerSessionController({
	elements,
	appState,
	requestJson,
	viewerLayoutController,
	setStatus,
	reloadPage,
	defaultViewerWidth,
	defaultViewerTitle,
	defaultViewerSubtitle
}) {
	const FILE_TYPE_CLASS = new Set(['text', 'spreadsheet', 'presentation']);
	const SHARE_PASSWORD_REQUIRED = 'SHARE_PASSWORD_REQUIRED';
	const INVALID_SHARE_PASSWORD = 'INVALID_SHARE_PASSWORD';

	function isShareSessionPath() {
		return window.location.pathname.startsWith('/share/');
	}

	function hideAppLayout() {
		if (!elements.layout) {
			return;
		}
		elements.layout.classList.add('hidden');
	}

	function revealAppLayout() {
		if (!elements.layout) {
			return;
		}
		elements.layout.classList.remove('hidden');
	}

	function showSharePasswordPage() {
		if (!elements.sharePasswordPage) {
			return;
		}
		elements.sharePasswordPage.classList.remove('hidden');
		elements.sharePasswordPage.setAttribute('aria-hidden', 'false');
	}

	function hideSharePasswordPage() {
		if (!elements.sharePasswordPage) {
			return;
		}
		elements.sharePasswordPage.classList.add('hidden');
		elements.sharePasswordPage.setAttribute('aria-hidden', 'true');
	}

	function setSharePasswordModalError(message) {
		if (!elements.sharePasswordError) {
			return;
		}
		const hasMessage = Boolean(String(message || '').trim());
		elements.sharePasswordError.textContent = hasMessage ? String(message) : '';
		elements.sharePasswordError.classList.toggle('hidden', !hasMessage);
	}

	function showSharePasswordFatalError(message) {
		if (elements.sharePasswordTitle) {
			elements.sharePasswordTitle.textContent = 'Share link unavailable';
		}
		if (elements.sharePasswordDescription) {
			elements.sharePasswordDescription.classList.add('hidden');
		}
		if (elements.sharePasswordField) {
			elements.sharePasswordField.classList.add('hidden');
		}
		if (elements.sharePasswordSubmit) {
			elements.sharePasswordSubmit.classList.add('hidden');
		}
		setSharePasswordModalError(message || 'This share link could not be opened.');
		showSharePasswordPage();
	}

	function getShareLaunchErrorCode(error) {
		return String(error?.payload?.error || error?.message || '').trim();
	}

	async function promptSharePassword(message) {
		if (!elements.sharePasswordPage || !elements.sharePasswordForm || !elements.sharePasswordInput) {
			return window.prompt(message || 'Please enter the share password') || null;
		}
		elements.sharePasswordForm.reset();
		setSharePasswordModalError(message || '');
		showSharePasswordPage();
		elements.sharePasswordInput.focus();

		return new Promise((resolve) => {
			function cleanup() {
				elements.sharePasswordForm.removeEventListener('submit', onSubmit);
			}

			function finish(value) {
				cleanup();
				hideSharePasswordPage();
				resolve(value);
			}

			function onSubmit(event) {
				event.preventDefault();
				const password = String(elements.sharePasswordInput.value || '');
				if (!password) {
					setSharePasswordModalError('Please enter the password.');
					return;
				}
				finish(password);
			}

			elements.sharePasswordForm.addEventListener('submit', onSubmit);
		});
	}

	function setViewerDocumentType(fileDocument) {
		const typeKey = getFileTypeKey(fileDocument);
		if (FILE_TYPE_CLASS.has(typeKey)) {
			document.body.dataset.viewerDocumentType = typeKey;
			return;
		}
		delete document.body.dataset.viewerDocumentType;
	}

	function setViewerMode(mode) {
		const isShareSession = isShareSessionPath();
		const isFullscreenMode = isShareSession || mode === 'edit';
		if (isShareSession) {
			// The layout was hidden up-front for anonymous share visitors; only
			// reveal it once a document actually launched (share-session CSS
			// below hides the sidebar/table, leaving just the fullscreen viewer).
			revealAppLayout();
		}
		document.body.classList.toggle('share-session', isShareSession);
		document.body.classList.toggle('editor-fullscreen', isFullscreenMode);
		if (isShareSession) {
			elements.closeViewerButton.classList.add('hidden');
			elements.closeViewerButton.setAttribute('aria-label', 'Close shared document');
			return;
		}
		elements.closeViewerButton.classList.toggle('hidden', !appState.viewerOpen);
		elements.closeViewerButton.setAttribute('aria-label', 'Close document');
	}

	function submitLaunchPayload(payload) {
		elements.collaboraForm.action = payload.actionUrl;
		elements.accessToken.value = payload.accessToken;
		elements.accessTokenTtl.value = String(payload.accessTokenTtl);
		elements.viewerTitle.textContent = `${payload.file.name} (${payload.mode})`;
		elements.viewerSubtitle.textContent = payload.file.relativePath;
		setViewerDocumentType(payload.file);
		appState.viewerPanelWidth = defaultViewerWidth;
		appState.viewerOpen = true;
		viewerLayoutController.syncViewerLayout();
		setViewerMode(payload.mode);
		elements.collaboraForm.requestSubmit();
	}

	async function closeViewer() {
		document.body.classList.remove('editor-fullscreen');
		delete document.body.dataset.viewerDocumentType;
		if (isShareSessionPath()) {
			document.body.classList.add('share-session');
			elements.closeViewerButton.classList.add('hidden');
			try {
				window.close();
			} catch (error) {
				// Browsers may block programmatic tab-closing; fall back to the blank share state.
			}
			elements.viewerTitle.textContent = defaultViewerTitle;
			elements.viewerSubtitle.textContent = defaultViewerSubtitle;
			elements.viewerFrame.src = 'about:blank';
			setStatus('Share session closed.');
			return;
		}
		document.body.classList.remove('share-session');
		appState.viewerOpen = false;
		viewerLayoutController.syncViewerLayout();
		elements.closeViewerButton.classList.add('hidden');
		elements.viewerTitle.textContent = defaultViewerTitle;
		elements.viewerSubtitle.textContent = defaultViewerSubtitle;
		elements.viewerFrame.src = 'about:blank';
		await reloadPage();
		setStatus('Closed document.');
	}

	async function openDocument(fileId, mode) {
		setStatus('Preparing Collabora launch...');
		try {
			const language = navigator.language || 'en-US';
			const payload = await requestJson(`/api/files/${encodeURIComponent(fileId)}/launch?lang=${encodeURIComponent(language)}&mode=${encodeURIComponent(mode)}`);
			submitLaunchPayload(payload);
			setStatus(`Opened ${payload.file.name} in ${payload.mode} mode.`);
			await reloadPage();
		} catch (error) {
			setStatus(error.message, true);
		}
	}

	async function maybeLaunchPublicShare() {
		const pathMatch = window.location.pathname.match(/^\/share\/([^/]+)$/);
		if (!pathMatch) {
			return false;
		}

		// Keep the folder browser fully hidden for anonymous share visitors
		// until (and unless) a document actually launches successfully.
		hideAppLayout();
		setStatus('Loading public share...');
		let password = null;
		const shareToken = encodeURIComponent(pathMatch[1]);
		const language = encodeURIComponent(navigator.language || 'en-US');
		try {
			while (true) {
				try {
					const payload = await requestJson(`/api/shares/${shareToken}/launch?lang=${language}`, {
						headers: password ? { 'X-Share-Password': password } : undefined
					});
					submitLaunchPayload(payload);
					setStatus(`Opened share ${payload.file.name}.`);
					return true;
				} catch (error) {
					const errorCode = getShareLaunchErrorCode(error);
					if (errorCode === SHARE_PASSWORD_REQUIRED || errorCode === INVALID_SHARE_PASSWORD) {
						password = await promptSharePassword(
							errorCode === INVALID_SHARE_PASSWORD
								? 'The password is incorrect. Please try again.'
								: 'This public link is password-protected.'
						);
						if (!password) {
							setStatus('Share opening cancelled.');
							return true;
						}
						continue;
					}
					showSharePasswordFatalError(error.message);
					setStatus(error.message, true);
					return true;
				}
			}
		} catch (error) {
			showSharePasswordFatalError(error.message || 'Could not open public share.');
			setStatus(error.message || 'Could not open public share.', true);
			return true;
		}
	}

	return {
		submitLaunchPayload,
		closeViewer,
		openDocument,
		maybeLaunchPublicShare
	};
}
