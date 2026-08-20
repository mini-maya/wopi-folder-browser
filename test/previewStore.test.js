'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	getCachedThumbnail,
	getThumbnailPublicUrl,
	invalidatePreview,
	resolveThumbnailAbsolutePath,
	storeThumbnail
} = require('../lib/previewStore');

const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y8h8AAAAASUVORK5CYII=',
	'base64'
);

test('storeThumbnail persists the current preview for a file version', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-preview-store-'));
	const stored = await storeThumbnail(tempRoot, {
		fileId: 'file-1',
		version: '7',
		relativePath: 'archive/report.docx',
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});

	assert.equal(stored.thumbnailUrl, '/storage/documents/thumbnails/file-1/7');
	const cached = await getCachedThumbnail(tempRoot, 'file-1', '7', 'documents');
	assert.ok(cached);
	assert.equal(cached.width, 1);
	assert.equal(cached.height, 1);
	assert.equal(await resolveThumbnailAbsolutePath(tempRoot, 'file-1', '7'), cached.absolutePath);
});

test('getThumbnailPublicUrl builds the preview URL from file id and version', function() {
	assert.equal(getThumbnailPublicUrl('file-2', '8', 'documents'), '/storage/documents/thumbnails/file-2/8');
	assert.equal(getThumbnailPublicUrl('file-2', '1787136501718-2048', 'external'), '/storage/external/thumbnails/file-2/1787136501718-2048');
});

test('invalidatePreview removes the current preview for a file', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-preview-store-'));
	await storeThumbnail(tempRoot, {
		fileId: 'file-2',
		version: '8',
		relativePath: 'slides.pptx',
		buffer: ONE_PIXEL_PNG,
		mimeType: 'image/png',
		width: 1,
		height: 1
	});
	await invalidatePreview(tempRoot, {
		id: 'file-2',
		relativePath: 'slides.pptx',
		version: '8'
	});
	const cachedCurrentVersion = await getCachedThumbnail(tempRoot, 'file-2', '8');
	assert.equal(cachedCurrentVersion, null);
	assert.equal(await resolveThumbnailAbsolutePath(tempRoot, 'file-2', '8'), null);
});

test('storeThumbnail overwrites stale previews when the file version changes', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-preview-store-'));
	for (let version = 1; version <= 3; version += 1) {
		await storeThumbnail(tempRoot, {
			fileId: 'file-gc',
			version: String(version),
			relativePath: 'sheet.xlsx',
			buffer: ONE_PIXEL_PNG,
			mimeType: 'image/png',
			width: 1,
			height: 1
		});
	}
	const firstVersion = await getCachedThumbnail(tempRoot, 'file-gc', '1');
	const secondVersion = await getCachedThumbnail(tempRoot, 'file-gc', '2');
	const thirdVersion = await getCachedThumbnail(tempRoot, 'file-gc', '3');
	assert.equal(firstVersion, null);
	assert.equal(secondVersion, null);
	assert.ok(thirdVersion);
});
