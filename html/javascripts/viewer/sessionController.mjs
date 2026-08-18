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
	function isShareSessionPath() {
		return window.location.pathname.startsWith('/share/');
	}

	function setViewerMode(mode) {
		const isShareSession = isShareSessionPath();
		const isFullscreenMode = isShareSession || mode === 'edit';
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
		appState.viewerPanelWidth = defaultViewerWidth;
		appState.viewerOpen = true;
		viewerLayoutController.syncViewerLayout();
		setViewerMode(payload.mode);
		elements.collaboraForm.requestSubmit();
	}

	async function closeViewer() {
		document.body.classList.remove('editor-fullscreen');
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
		window.history.replaceState(null, '', '/');
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

		setStatus('Loading public share...');
		try {
			const payload = await requestJson(`/api/shares/${encodeURIComponent(pathMatch[1])}/launch?lang=${encodeURIComponent(navigator.language || 'en-US')}`);
			submitLaunchPayload(payload);
			setStatus(`Opened share ${payload.file.name}.`);
			return true;
		} catch (error) {
			setStatus(error.message, true);
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
