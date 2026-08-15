'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

let treeHelpers;

test.before(async function() {
	treeHelpers = await import('../html/javascripts/fileBrowserTree.mjs');
});

test('getParentPath returns the parent folder path', function() {
	assert.equal(treeHelpers.getParentPath(''), '');
	assert.equal(treeHelpers.getParentPath('archive'), '');
	assert.equal(treeHelpers.getParentPath('archive/nested/report.odt'), 'archive/nested');
});

test('buildDocumentTree groups direct children by parent path', function() {
	const documents = [
		{ id: 'file-1', name: 'report.odt', relativePath: 'report.odt', isDirectory: false },
		{ id: 'folder-1', name: 'archive', relativePath: 'archive', isDirectory: true },
		{ id: 'file-2', name: 'nested.odt', relativePath: 'archive/nested/nested.odt', isDirectory: false },
		{ id: 'folder-2', name: 'nested', relativePath: 'archive/nested', isDirectory: true }
	];

	const tree = treeHelpers.buildDocumentTree(documents);
	assert.deepEqual(tree.get('').map((entry) => entry.name), ['archive', 'report.odt']);
	assert.deepEqual(tree.get('archive').map((entry) => entry.name), ['nested']);
	assert.deepEqual(tree.get('archive/nested').map((entry) => entry.name), ['nested.odt']);
});

test('getVisibleTreeEntries expands nested folders recursively', function() {
	const documents = [
		{ id: 'folder-1', name: 'archive', relativePath: 'archive', isDirectory: true },
		{ id: 'folder-2', name: 'nested', relativePath: 'archive/nested', isDirectory: true },
		{ id: 'file-1', name: 'report.odt', relativePath: 'archive/nested/report.odt', isDirectory: false },
		{ id: 'file-2', name: 'root.odt', relativePath: 'root.odt', isDirectory: false }
	];

	const expandedFolderIds = new Set(['folder-1', 'folder-2']);
	const visibleEntries = treeHelpers.getVisibleTreeEntries(documents, expandedFolderIds);

	assert.deepEqual(
		visibleEntries.map((entry) => `${entry.depth}:${entry.document.relativePath}`),
		[
			'0:archive',
			'1:archive/nested',
			'2:archive/nested/report.odt',
			'0:root.odt'
		]
	);
});

test('getFolderSelectionState reflects direct folder selection only', function() {
	const documents = [
		{ id: 'folder-1', name: 'archive', relativePath: 'archive', isDirectory: true },
		{ id: 'folder-2', name: 'nested', relativePath: 'archive/nested', isDirectory: true },
		{ id: 'file-1', name: 'a.txt', relativePath: 'archive/a.txt', isDirectory: false },
		{ id: 'file-2', name: 'b.txt', relativePath: 'archive/nested/b.txt', isDirectory: false },
		{ id: 'file-3', name: 'c.txt', relativePath: 'archive/nested/c.txt', isDirectory: false }
	];

	assert.deepEqual(treeHelpers.getFolderSelectionState(documents[0], documents, new Set(['file-1'])), {
		checked: false
	});

	assert.deepEqual(treeHelpers.getFolderSelectionState(documents[0], documents, new Set(['folder-1'])), {
		checked: true
	});

	assert.deepEqual(treeHelpers.getFolderSelectionState(documents[1], documents, new Set(['file-2', 'file-3'])), {
		checked: false
	});

	assert.deepEqual(treeHelpers.getFolderSelectionState(documents[1], documents, new Set(['folder-2'])), {
		checked: true
	});
});

test('getFolderSizeBytes sums all descendant files recursively', function() {
	const documents = [
		{ id: 'folder-1', name: 'archive', relativePath: 'archive', isDirectory: true },
		{ id: 'folder-2', name: 'nested', relativePath: 'archive/nested', isDirectory: true },
		{ id: 'file-1', name: 'a.txt', relativePath: 'archive/a.txt', isDirectory: false, size: 200 },
		{ id: 'file-2', name: 'b.txt', relativePath: 'archive/nested/b.txt', isDirectory: false, size: 25 },
		{ id: 'file-3', name: 'c.txt', relativePath: 'archive/nested/c.txt', isDirectory: false, size: 75 },
		{ id: 'file-4', name: 'outside.txt', relativePath: 'outside.txt', isDirectory: false, size: 999 }
	];

	assert.equal(treeHelpers.getFolderSizeBytes(documents[0], documents), 300);
	assert.equal(treeHelpers.getFolderSizeBytes(documents[1], documents), 100);
	assert.equal(treeHelpers.getFolderSizeBytes(documents[4], documents), 0);
});
