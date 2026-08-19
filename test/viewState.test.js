'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

let viewStateHelpers;

test.before(async function() {
	viewStateHelpers = await import('../html/javascripts/state/viewState.mjs');
});

test('resetFilesViewState returns to the files view and clears transient selection state', function() {
	const appState = {
		currentView: 'recycle',
		selectedFileIds: new Set(['file-1', 'file-2']),
		activeDetailFileId: 'file-1',
		detailThumbnailCache: new Map([['file-1', { version: '1', thumbnailUrl: 'thumb' }]]),
		detailThumbnailInFlight: new Map([['file-1', Promise.resolve()]])
	};

	viewStateHelpers.resetFilesViewState(appState);

	assert.equal(appState.currentView, 'files');
	assert.equal(appState.selectedFileIds.size, 0);
	assert.equal(appState.activeDetailFileId, null);
	assert.equal(appState.detailThumbnailCache.size, 0);
	assert.equal(appState.detailThumbnailInFlight.size, 0);
});
