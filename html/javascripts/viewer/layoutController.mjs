export function createViewerLayoutController({
	layout,
	layoutSplitter,
	appState,
	minViewerWidth = 480,
	minSidebarWidth = 480,
	splitterWidth = 12
}) {
	function getLayoutHorizontalPadding() {
		const layoutStyles = window.getComputedStyle(layout);
		return parseFloat(layoutStyles.paddingLeft) + parseFloat(layoutStyles.paddingRight);
	}

	function syncViewerLayout() {
		const layoutPadding = getLayoutHorizontalPadding();
		const layoutWidth = layout.getBoundingClientRect().width - layoutPadding;
		const maximumWidth = Math.max(minViewerWidth, layoutWidth - splitterWidth - minSidebarWidth);
		const width = appState.viewerOpen
			? Math.min(Math.max(minViewerWidth, appState.viewerPanelWidth), maximumWidth)
			: 0;
		appState.viewerPanelWidth = width;
		layout.style.setProperty('--viewer-width', `${width}px`);
		layout.style.gridTemplateColumns = appState.viewerOpen
			? `${width}px ${splitterWidth}px minmax(${minSidebarWidth}px, 1fr)`
			: 'minmax(0, 1fr)';
		layout.classList.toggle('viewer-open', appState.viewerOpen);
		layoutSplitter.classList.toggle('hidden', !appState.viewerOpen);
	}

	function startViewerResize(event) {
		if (!appState.viewerOpen) {
			return;
		}
		appState.isResizingViewer = true;
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
		event.preventDefault();
		event.stopPropagation();
		layoutSplitter.setPointerCapture?.(event.pointerId);
	}

	function updateViewerResize(event) {
		if (!appState.isResizingViewer) {
			return;
		}
		const layoutBounds = layout.getBoundingClientRect();
		const layoutWidth = layoutBounds.width - getLayoutHorizontalPadding();
		const maximumWidth = Math.max(minViewerWidth, layoutWidth - splitterWidth - minSidebarWidth);
		const nextWidth = Math.min(
			Math.max(minViewerWidth, event.clientX - layoutBounds.left - splitterWidth),
			maximumWidth
		);
		appState.viewerPanelWidth = nextWidth;
		syncViewerLayout();
	}

	function stopViewerResize() {
		if (!appState.isResizingViewer) {
			return;
		}
		appState.isResizingViewer = false;
		document.body.style.userSelect = '';
		document.body.style.cursor = '';
	}

	return {
		syncViewerLayout,
		startViewerResize,
		updateViewerResize,
		stopViewerResize
	};
}
