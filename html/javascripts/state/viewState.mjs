export function clearSelectionAndDetailState(appState) {
	appState.selectedFileIds.clear();
	appState.activeDetailFileId = null;
	appState.detailThumbnailCache.clear();
	appState.detailThumbnailInFlight.clear();
}

export function resetFilesViewState(appState) {
	appState.currentView = 'files';
	clearSelectionAndDetailState(appState);
}
