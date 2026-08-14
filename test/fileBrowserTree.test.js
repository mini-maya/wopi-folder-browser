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
