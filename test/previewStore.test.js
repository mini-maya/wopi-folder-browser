'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	getCachedThumbnail,
	invalidatePreview,
	resolveThumbnailAbsolutePath,
	storeThumbnail
} = require('../lib/previewStore');

const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y8h8AAAAASUVORK5CYII=',
	'base64'
);

test('storeThumbnail persists and getCachedThumbnail resolves entry by fileId+version', async function() {
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

	assert.equal(stored.thumbnailUrl, '/api/thumbnails/file-1/7');
	const cached = await getCachedThumbnail(tempRoot, 'file-1', '7');
	assert.ok(cached);
	assert.equal(cached.width, 1);
	assert.equal(cached.height, 1);
	assert.equal(await resolveThumbnailAbsolutePath(tempRoot, 'file-1', '7'), cached.absolutePath);
});

test('invalidatePreview writes invalidation marker without deleting cached version entries', async function() {
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
		version: '9'
	});
	const cachedOldVersion = await getCachedThumbnail(tempRoot, 'file-2', '8');
	assert.ok(cachedOldVersion);
});

test('storeThumbnail keeps only the latest five versions per file', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-preview-store-'));
	for (let version = 1; version <= 6; version += 1) {
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
	const sixthVersion = await getCachedThumbnail(tempRoot, 'file-gc', '6');
	assert.equal(firstVersion, null);
	assert.ok(secondVersion);
	assert.ok(sixthVersion);
});
