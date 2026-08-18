'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { renderOfficeThumbnail } = require('../lib/thumbnailService');

const SMALL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y8h8AAAAASUVORK5CYII=',
	'base64'
);

test('renderOfficeThumbnail returns THUMBNAIL_RENDERED and stores PNG', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-thumbnail-service-'));
	const sourcePath = path.join(tempRoot, 'invoice.docx');
	await fs.writeFile(sourcePath, Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(16)]));

	const server = http.createServer(function(req, res) {
		if (req.url === '/hosting/capabilities') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ 'convert-to': { available: true } }));
			return;
		}
		if (req.url === '/cool/convert-to/png') {
			res.writeHead(200, { 'Content-Type': 'image/png' });
			res.end(SMALL_PNG);
			return;
		}
		res.writeHead(404);
		res.end();
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const collaboraUrl = `http://127.0.0.1:${address.port}`;

	try {
		const result = await renderOfficeThumbnail({
			documentRoot: tempRoot,
			document: {
				id: 'file-123',
				version: '7',
				relativePath: 'invoice.docx',
				absolutePath: sourcePath,
				extension: '.docx',
				isDirectory: false
			},
			appBaseUrl: 'http://localhost:3000',
			accessTokenSecret: 'thumbnail-secret',
			accessTokenTtlMs: 60_000,
			collaboraInternalUrl: collaboraUrl,
			maxWidth: 512,
			maxHeight: 512,
			retryAttempts: 2,
			retryDelayMs: 10,
			requestTimeoutMs: 5000,
			userId: 'user-1',
			userName: 'User One',
			storageContext: 'shared'
		});

		assert.equal(result.status, 'THUMBNAIL_RENDERED');
		assert.equal(result.mimeType, 'image/png');
		assert.equal(result.thumbnailUrl, '/api/thumbnails/file-123/7');
		assert.ok(result.width <= 512);
		assert.ok(result.height <= 512);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

test('renderOfficeThumbnail returns CONVERSION_NOT_SUPPORTED when capabilities disable convert-to', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-thumbnail-service-'));
	const sourcePath = path.join(tempRoot, 'deck.pptx');
	await fs.writeFile(sourcePath, Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(16)]));

	const server = http.createServer(function(req, res) {
		if (req.url === '/hosting/capabilities') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ 'convert-to': { available: false } }));
			return;
		}
		res.writeHead(404);
		res.end();
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const collaboraUrl = `http://127.0.0.1:${server.address().port}`;

	try {
		const result = await renderOfficeThumbnail({
			documentRoot: tempRoot,
			document: {
				id: 'file-456',
				version: '9',
				relativePath: 'deck.pptx',
				absolutePath: sourcePath,
				extension: '.pptx',
				isDirectory: false
			},
			appBaseUrl: 'http://localhost:3000',
			accessTokenSecret: 'thumbnail-secret',
			accessTokenTtlMs: 60_000,
			collaboraInternalUrl: collaboraUrl,
			maxWidth: 512,
			maxHeight: 512,
			retryAttempts: 2,
			retryDelayMs: 10,
			requestTimeoutMs: 5000,
			userId: 'user-1',
			userName: 'User One',
			storageContext: 'shared'
		});

		assert.equal(result.status, 'CONVERSION_NOT_SUPPORTED');
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

test('renderOfficeThumbnail returns INVALID_FILE when Office signature is invalid', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-thumbnail-service-'));
	const sourcePath = path.join(tempRoot, 'bad.docx');
	await fs.writeFile(sourcePath, Buffer.from('not-an-office-file'));

	const result = await renderOfficeThumbnail({
		documentRoot: tempRoot,
		document: {
			id: 'file-bad',
			version: '1',
			relativePath: 'bad.docx',
			absolutePath: sourcePath,
			extension: '.docx',
			isDirectory: false
		},
		appBaseUrl: 'http://localhost:3000',
		accessTokenSecret: 'thumbnail-secret',
		accessTokenTtlMs: 60_000,
		collaboraInternalUrl: 'http://127.0.0.1:65534',
		maxWidth: 512,
		maxHeight: 512,
		retryAttempts: 2,
		retryDelayMs: 10,
		requestTimeoutMs: 300,
		userId: 'user-1',
		userName: 'User One',
		storageContext: 'shared'
	});

	assert.equal(result.status, 'INVALID_FILE');
});

test('renderOfficeThumbnail tries alternative payload strategies after 400 response', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-thumbnail-service-'));
	const sourcePath = path.join(tempRoot, 'sheet.xlsx');
	await fs.writeFile(sourcePath, Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(16)]));
	let sawJsonPayload = false;
	let sawFormPayload = false;

	const server = http.createServer(function(req, res) {
		if (req.url === '/hosting/capabilities') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ 'convert-to': { available: true, endpoint: '/cool/convert-to' } }));
			return;
		}
		if (req.url.startsWith('/cool/convert-to')) {
			const contentType = String(req.headers['content-type'] || '');
			if (contentType.startsWith('application/json')) {
				sawJsonPayload = true;
				res.writeHead(400);
				res.end('bad request');
				return;
			}
			sawFormPayload = true;
			res.writeHead(200, { 'Content-Type': 'image/png' });
			res.end(SMALL_PNG);
			return;
		}
		res.writeHead(404);
		res.end();
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const collaboraUrl = `http://127.0.0.1:${server.address().port}`;

	try {
		const result = await renderOfficeThumbnail({
			documentRoot: tempRoot,
			document: {
				id: 'file-loop-fix',
				version: '3',
				relativePath: 'sheet.xlsx',
				absolutePath: sourcePath,
				extension: '.xlsx',
				isDirectory: false
			},
			appBaseUrl: 'http://localhost:3000',
			accessTokenSecret: 'thumbnail-secret',
			accessTokenTtlMs: 60_000,
			collaboraInternalUrl: collaboraUrl,
			maxWidth: 512,
			maxHeight: 512,
			retryAttempts: 1,
			retryDelayMs: 10,
			requestTimeoutMs: 5000,
			userId: 'user-1',
			userName: 'User One',
			storageContext: 'shared'
		});

		assert.equal(result.status, 'THUMBNAIL_RENDERED');
		assert.equal(sawJsonPayload, true);
		assert.equal(sawFormPayload, true);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

test('renderOfficeThumbnail falls back to multipart upload after WOPI convert 400 responses', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-thumbnail-service-'));
	const sourcePath = path.join(tempRoot, 'table.xlsx');
	await fs.writeFile(sourcePath, Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(16)]));
	let sawWopiAttempt = false;
	let sawMultipartAttempt = false;

	const server = http.createServer(function(req, res) {
		if (req.url === '/hosting/capabilities') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ 'convert-to': { available: true, endpoint: '/cool/convert-to' } }));
			return;
		}
		if (req.url.startsWith('/cool/convert-to')) {
			const contentType = String(req.headers['content-type'] || '');
			if (contentType.startsWith('multipart/form-data')) {
				sawMultipartAttempt = true;
				res.writeHead(200, { 'Content-Type': 'image/png' });
				res.end(SMALL_PNG);
				return;
			}
			sawWopiAttempt = true;
			res.writeHead(400);
			res.end('bad request');
			return;
		}
		res.writeHead(404);
		res.end();
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const collaboraUrl = `http://127.0.0.1:${server.address().port}`;

	try {
		const result = await renderOfficeThumbnail({
			documentRoot: tempRoot,
			document: {
				id: 'file-multipart-fallback',
				version: '6',
				relativePath: 'table.xlsx',
				absolutePath: sourcePath,
				extension: '.xlsx',
				isDirectory: false,
				name: 'table.xlsx',
				mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			},
			appBaseUrl: 'http://localhost:3000',
			accessTokenSecret: 'thumbnail-secret',
			accessTokenTtlMs: 60_000,
			collaboraInternalUrl: collaboraUrl,
			maxWidth: 512,
			maxHeight: 512,
			retryAttempts: 1,
			retryDelayMs: 10,
			requestTimeoutMs: 5000,
			userId: 'user-1',
			userName: 'User One',
			storageContext: 'shared'
		});

		assert.equal(result.status, 'THUMBNAIL_RENDERED');
		assert.equal(sawWopiAttempt, true);
		assert.equal(sawMultipartAttempt, true);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
