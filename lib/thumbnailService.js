'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const sharp = require('sharp');

const config = require('./config');
const { createAccessToken } = require('./accessToken');
const { createHttpError } = require('./errors');
const { getCollaboraCapabilities, isConvertToAvailable, resolveConvertToPaths } = require('./collaboraCapabilities');
const { getCachedThumbnail, storeThumbnail } = require('./previewStore');

const OFFICE_EXTENSIONS = new Set([
	'.doc', '.docx', '.odt',
	'.xls', '.xlsx', '.ods',
	'.ppt', '.pptx', '.odp'
]);

const THUMBNAIL_STATUS = {
	COLLABORA_UNAVAILABLE: 'COLLABORA_UNAVAILABLE',
	CONVERSION_NOT_SUPPORTED: 'CONVERSION_NOT_SUPPORTED',
	WOPI_ACCESS_FAILED: 'WOPI_ACCESS_FAILED',
	INVALID_FILE: 'INVALID_FILE',
	THUMBNAIL_FAILED: 'THUMBNAIL_FAILED',
	THUMBNAIL_RENDERED: 'THUMBNAIL_RENDERED'
};

const ZIP_MAGIC = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const THUMBNAIL_DEBUG_ENABLED = config.thumbnailDebug;
const CONVERT_MODE_CACHE_TTL_MS = 10 * 60 * 1000;
const convertModeCache = new Map();

function logThumbnailDebug(message, details) {
	if (!THUMBNAIL_DEBUG_ENABLED) {
		return;
	}
	if (details !== undefined) {
		console.info('[thumbnail-debug]', message, details);
		return;
	}
	console.info('[thumbnail-debug]', message);
}

function isOfficeThumbnailCandidate(document) {
	if (!document || document.isDirectory) {
		return false;
	}
	return OFFICE_EXTENSIONS.has(String(document.extension || '').toLowerCase());
}

async function readFileHeader(absolutePath, byteLength) {
	const fileHandle = await fs.open(absolutePath, 'r');
	try {
		const buffer = Buffer.alloc(byteLength);
		const result = await fileHandle.read(buffer, 0, byteLength, 0);
		return buffer.subarray(0, result.bytesRead);
	} finally {
		await fileHandle.close();
	}
}

async function isValidOfficeSourceFile(document) {
	let stats;
	try {
		stats = await fs.stat(document.absolutePath);
	} catch (error) {
		return false;
	}
	if (!stats.isFile() || stats.size < 1) {
		return false;
	}
	const extension = String(document.extension || '').toLowerCase();
	if (extension === '.docx' || extension === '.xlsx' || extension === '.pptx' || extension === '.odt' || extension === '.ods' || extension === '.odp') {
		try {
			const header = await readFileHeader(document.absolutePath, 4);
			if (header.length < 4) {
				return false;
			}
			if (header.subarray(0, 4).equals(ZIP_MAGIC)) {
				return true;
			}
			return false;
		} catch (error) {
			return false;
		}
	}
	if (extension === '.doc' || extension === '.xls' || extension === '.ppt') {
		try {
			const header = await readFileHeader(document.absolutePath, 8);
			if (header.length < 8) {
				return false;
			}
			if (header.equals(OLE_MAGIC)) {
				return true;
			}
			return false;
		} catch (error) {
			return false;
		}
	}
	return true;
}

function buildStrategyBodies(options) {
	const readOnlyToken = options.accessToken;
	const tokenTtl = String(options.accessTokenTtl);
	const wopiSrc = options.wopiSrc;
	return [
		{
			label: 'json-wopiSrc',
			contentType: 'application/json',
			body: Buffer.from(JSON.stringify({
				outputFormat: 'png',
				wopiSrc: wopiSrc,
				accessToken: readOnlyToken,
				accessTokenTtl: tokenTtl
			}), 'utf8')
		},
		{
			label: 'form-WOPISrc',
			contentType: 'application/x-www-form-urlencoded',
			body: Buffer.from(new URLSearchParams({
				format: 'png',
				WOPISrc: wopiSrc,
				access_token: readOnlyToken,
				access_token_ttl: tokenTtl
			}).toString(), 'utf8')
		},
		{
			label: 'form-wopi_src',
			contentType: 'application/x-www-form-urlencoded',
			body: Buffer.from(new URLSearchParams({
				output_format: 'png',
				wopi_src: wopiSrc,
				access_token: readOnlyToken,
				access_token_ttl: tokenTtl
			}).toString(), 'utf8')
		},
		{
			label: 'form-url',
			contentType: 'application/x-www-form-urlencoded',
			body: Buffer.from(new URLSearchParams({
				url: wopiSrc,
				access_token: readOnlyToken,
				access_token_ttl: tokenTtl
			}).toString(), 'utf8')
		}
	];
}

function requestBuffer(url, options) {
	return new Promise(function(resolve, reject) {
		const parsedUrl = new URL(url);
		const client = parsedUrl.protocol === 'https:' ? https : http;
		const request = client.request(parsedUrl, {
			method: options.method || 'GET',
			timeout: options.timeoutMs || 20_000,
			rejectUnauthorized: process.env.DISABLE_TLS_CERT_VALIDATION !== '1',
			headers: options.headers || {}
		}, function(response) {
			const chunks = [];
			response.on('data', function(chunk) {
				chunks.push(chunk);
			});
			response.on('end', function() {
				resolve({
					statusCode: response.statusCode || 0,
					headers: response.headers || {},
					body: Buffer.concat(chunks)
				});
			});
		});
		request.on('timeout', function() {
			request.destroy(new Error('Collabora convert request timed out.'));
		});
		request.on('error', function(error) {
			reject(error);
		});
		if (options.body) {
			request.write(options.body);
		}
		request.end();
	});
}

function shouldRetry(statusCode, error) {
	if (error) {
		return true;
	}
	return statusCode === 429 || statusCode >= 500;
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConvertModeCacheKey(options) {
	return options.collaboraInternalUrl;
}

function getCachedConvertMode(options) {
	const key = getConvertModeCacheKey(options);
	const entry = convertModeCache.get(key);
	if (!entry || entry.expiresAt <= Date.now()) {
		return null;
	}
	return entry.mode;
}

function setCachedConvertMode(options, mode) {
	convertModeCache.set(getConvertModeCacheKey(options), {
		mode: mode,
		expiresAt: Date.now() + CONVERT_MODE_CACHE_TTL_MS
	});
}

function buildMultipartConvertBody(options) {
	const boundary = `----wopi-thumbnail-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
	const fileName = String(options.fileName || 'document.bin').replace(/"/g, '');
	const mimeType = options.mimeType || 'application/octet-stream';
	const prefix = Buffer.from(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="data"; filename="${fileName}"\r\n` +
		`Content-Type: ${mimeType}\r\n\r\n`,
		'utf8'
	);
	const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
	return {
		body: Buffer.concat([prefix, options.fileBuffer, suffix]),
		contentType: `multipart/form-data; boundary=${boundary}`
	};
}

async function callConvertToWithRetry(options) {
	const strategies = buildStrategyBodies(options);
	const convertUrl = options.convertUrl;
	let lastFailure = null;
	for (let attempt = 1; attempt <= options.retryAttempts; attempt += 1) {
		for (const strategy of strategies) {
			logThumbnailDebug('convert attempt', {
				attempt: attempt,
				convertUrl: convertUrl,
				payloadType: strategy.label
			});
			try {
				const response = await requestBuffer(convertUrl, {
					method: 'POST',
					timeoutMs: options.requestTimeoutMs,
					headers: {
						'Content-Type': strategy.contentType,
						'Content-Length': String(strategy.body.length)
					},
					body: strategy.body
				});
				const contentType = String(response.headers['content-type'] || '');
				if (response.statusCode >= 200 && response.statusCode < 300 && (contentType.startsWith('image/') || contentType.startsWith('application/octet-stream'))) {
					logThumbnailDebug('convert attempt succeeded', {
						attempt: attempt,
						convertUrl: convertUrl,
						payloadType: strategy.label,
						statusCode: response.statusCode,
						contentType: contentType
					});
					return response.body;
				}
				logThumbnailDebug('convert attempt returned non-image response', {
					attempt: attempt,
					convertUrl: convertUrl,
					payloadType: strategy.label,
					statusCode: response.statusCode,
					contentType: contentType
				});
				lastFailure = {
					statusCode: response.statusCode,
					contentType: contentType,
					bodyText: response.body.toString('utf8'),
					convertUrl: convertUrl
				};
			} catch (error) {
				logThumbnailDebug('convert attempt failed with network error', {
					attempt: attempt,
					convertUrl: convertUrl,
					payloadType: strategy.label,
					error: error.message
				});
				lastFailure = { error: error, convertUrl: convertUrl };
			}
		}
		if (attempt < options.retryAttempts && shouldRetry(lastFailure?.statusCode, lastFailure?.error)) {
			await wait(options.retryDelayMs);
			continue;
		}
		break;
	}
	const finalError = createHttpError(502, 'Collabora conversion failed.');
	finalError.details = lastFailure;
	throw finalError;
}

async function callMultipartConvertWithRetry(options) {
	let lastFailure = null;
	const multipart = buildMultipartConvertBody({
		fileName: options.fileName,
		fileBuffer: options.fileBuffer,
		mimeType: options.mimeType
	});
	for (let attempt = 1; attempt <= options.retryAttempts; attempt += 1) {
		logThumbnailDebug('multipart convert attempt', {
			attempt: attempt,
			convertUrl: options.convertUrl
		});
		try {
			const response = await requestBuffer(options.convertUrl, {
				method: 'POST',
				timeoutMs: options.requestTimeoutMs,
				headers: {
					'Content-Type': multipart.contentType,
					'Content-Length': String(multipart.body.length)
				},
				body: multipart.body
			});
			const contentType = String(response.headers['content-type'] || '');
			if (response.statusCode >= 200 && response.statusCode < 300 && (contentType.startsWith('image/') || contentType.startsWith('application/octet-stream'))) {
				logThumbnailDebug('multipart convert attempt succeeded', {
					attempt: attempt,
					convertUrl: options.convertUrl,
					statusCode: response.statusCode,
					contentType: contentType
				});
				return response.body;
			}
			logThumbnailDebug('multipart convert attempt returned non-image response', {
				attempt: attempt,
				convertUrl: options.convertUrl,
				statusCode: response.statusCode,
				contentType: contentType
			});
			lastFailure = {
				statusCode: response.statusCode,
				contentType: contentType,
				bodyText: response.body.toString('utf8'),
				convertUrl: options.convertUrl
			};
		} catch (error) {
			logThumbnailDebug('multipart convert attempt failed with network error', {
				attempt: attempt,
				convertUrl: options.convertUrl,
				error: error.message
			});
			lastFailure = { error: error, convertUrl: options.convertUrl };
		}
		if (attempt < options.retryAttempts && shouldRetry(lastFailure?.statusCode, lastFailure?.error)) {
			await wait(options.retryDelayMs);
			continue;
		}
		break;
	}
	const finalError = createHttpError(502, 'Collabora multipart conversion failed.');
	finalError.details = lastFailure;
	throw finalError;
}

async function validateAndResizePng(buffer, maxWidth, maxHeight) {
	let image;
	try {
		image = sharp(buffer, { failOn: 'error' });
	} catch (error) {
		throw createHttpError(422, 'Converted payload is not a valid image.');
	}
	const metadata = await image.metadata();
	if (!metadata.width || !metadata.height) {
		throw createHttpError(422, 'Converted image does not have valid dimensions.');
	}
	const resizedBuffer = await image
		.resize({
			width: maxWidth,
			height: maxHeight,
			fit: 'inside',
			withoutEnlargement: true
		})
		.png()
		.toBuffer();
	const resizedMetadata = await sharp(resizedBuffer).metadata();
	return {
		buffer: resizedBuffer,
		width: resizedMetadata.width,
		height: resizedMetadata.height
	};
}

function classifyConversionFailure(error) {
	if (error?.code === 'COLLABORA_UNAVAILABLE' || error?.details?.error) {
		return THUMBNAIL_STATUS.COLLABORA_UNAVAILABLE;
	}
	const statusCode = error?.details?.statusCode || error?.status || 0;
	if (statusCode === 401 || statusCode === 403) {
		return THUMBNAIL_STATUS.WOPI_ACCESS_FAILED;
	}
	if (statusCode >= 500 || statusCode === 0) {
		return THUMBNAIL_STATUS.COLLABORA_UNAVAILABLE;
	}
	return THUMBNAIL_STATUS.THUMBNAIL_FAILED;
}

async function renderOfficeThumbnail(options) {
	const fileId = options.document.id;
	const version = options.document.version;
	logThumbnailDebug('thumbnail render started', {
		fileId: fileId,
		version: version,
		extension: options.document.extension
	});
	const cached = await getCachedThumbnail(options.documentRoot, fileId, version);
	if (cached) {
		logThumbnailDebug('thumbnail cache hit', {
			fileId: fileId,
			version: version
		});
		return {
			status: THUMBNAIL_STATUS.THUMBNAIL_RENDERED,
			fileId: fileId,
			version: version,
			thumbnailUrl: cached.thumbnailUrl,
			mimeType: cached.mimeType || 'image/png',
			width: cached.width,
			height: cached.height
		};
	}
	if (!isOfficeThumbnailCandidate(options.document)) {
		logThumbnailDebug('thumbnail render rejected: unsupported extension', {
			fileId: fileId,
			version: version,
			extension: options.document.extension
		});
		return {
			status: THUMBNAIL_STATUS.INVALID_FILE,
			fileId: fileId,
			version: version,
			error: 'Unsupported Office file type.'
		};
	}
	const validOfficeFile = await isValidOfficeSourceFile(options.document);
	if (!validOfficeFile) {
		logThumbnailDebug('thumbnail render rejected: invalid office file header', {
			fileId: fileId,
			version: version
		});
		return {
			status: THUMBNAIL_STATUS.INVALID_FILE,
			fileId: fileId,
			version: version,
			error: 'Office file header validation failed.'
		};
	}
	let capabilities;
	try {
		capabilities = await getCollaboraCapabilities(options.collaboraInternalUrl, {
			timeoutMs: options.requestTimeoutMs
		});
	} catch (error) {
		logThumbnailDebug('capabilities request failed', {
			fileId: fileId,
			version: version,
			error: error.message
		});
		return {
			status: THUMBNAIL_STATUS.COLLABORA_UNAVAILABLE,
			fileId: fileId,
			version: version,
			error: error.message
		};
	}
	if (!isConvertToAvailable(capabilities)) {
		logThumbnailDebug('convert-to not available', {
			fileId: fileId,
			version: version
		});
		return {
			status: THUMBNAIL_STATUS.CONVERSION_NOT_SUPPORTED,
			fileId: fileId,
			version: version,
			error: 'Collabora convert-to is not available.'
		};
	}

	const wopiSrc = `${options.appBaseUrl}/wopi/files/${encodeURIComponent(fileId)}`;
	const accessToken = createAccessToken({
		fileId: fileId,
		secret: options.accessTokenSecret,
		ttlMs: options.accessTokenTtlMs,
		claims: {
			userId: options.userId,
			userName: options.userName,
			canWrite: false,
			canRename: false,
			storageContext: options.storageContext
		}
	});
	const convertPaths = resolveConvertToPaths(capabilities);
	logThumbnailDebug('resolved convert-to paths', {
		fileId: fileId,
		version: version,
		convertPaths: convertPaths
	});
	const convertUrl = new URL(convertPaths[0], `${options.collaboraInternalUrl}/`).toString();
	const preferredMode = getCachedConvertMode(options) || 'wopi';
	logThumbnailDebug('selected convert mode', {
		fileId: fileId,
		version: version,
		preferredMode: preferredMode
	});

	let convertedImage;
	let lastConversionError = null;
	const fileName = options.document.name || path.posix.basename(options.document.relativePath || 'document.bin');
	const fileBuffer = preferredMode === 'multipart' ? await fs.readFile(options.document.absolutePath) : null;
	const conversionModes = preferredMode === 'multipart' ? ['multipart', 'wopi'] : ['wopi', 'multipart'];
	for (const mode of conversionModes) {
		try {
			if (mode === 'wopi') {
				convertedImage = await callConvertToWithRetry({
					convertUrl: convertUrl,
					wopiSrc: wopiSrc,
					accessToken: accessToken.token,
					accessTokenTtl: accessToken.expiresAt,
					retryAttempts: options.retryAttempts,
					retryDelayMs: options.retryDelayMs,
					requestTimeoutMs: options.requestTimeoutMs
				});
			} else {
				const multipartBuffer = fileBuffer || await fs.readFile(options.document.absolutePath);
				convertedImage = await callMultipartConvertWithRetry({
					convertUrl: convertUrl,
					retryAttempts: options.retryAttempts,
					retryDelayMs: options.retryDelayMs,
					requestTimeoutMs: options.requestTimeoutMs,
					fileName: fileName,
					fileBuffer: multipartBuffer,
					mimeType: options.document.mimeType || 'application/octet-stream'
				});
			}
			setCachedConvertMode(options, mode);
			break;
		} catch (error) {
			lastConversionError = error;
			logThumbnailDebug('convert mode failed', {
				fileId: fileId,
				version: version,
				mode: mode,
				status: classifyConversionFailure(error),
				error: error.message
			});
		}
	}
	if (!convertedImage) {
		return {
			status: classifyConversionFailure(lastConversionError),
			fileId: fileId,
			version: version,
			error: lastConversionError?.message || 'Collabora conversion failed.'
		};
	}

	let resized;
	try {
		resized = await validateAndResizePng(convertedImage, options.maxWidth, options.maxHeight);
	} catch (error) {
		logThumbnailDebug('png validation/resize failed', {
			fileId: fileId,
			version: version,
			error: error.message
		});
		return {
			status: THUMBNAIL_STATUS.THUMBNAIL_FAILED,
			fileId: fileId,
			version: version,
			error: error.message
		};
	}

	const stored = await storeThumbnail(options.documentRoot, {
		fileId: fileId,
		version: version,
		relativePath: options.document.relativePath,
		buffer: resized.buffer,
		mimeType: 'image/png',
		width: resized.width,
		height: resized.height
	});

	return {
		status: THUMBNAIL_STATUS.THUMBNAIL_RENDERED,
		fileId: fileId,
		version: version,
		thumbnailUrl: stored.thumbnailUrl,
		mimeType: 'image/png',
		width: resized.width,
		height: resized.height
	};
}

module.exports = {
	OFFICE_EXTENSIONS: OFFICE_EXTENSIONS,
	THUMBNAIL_STATUS: THUMBNAIL_STATUS,
	isOfficeThumbnailCandidate: isOfficeThumbnailCandidate,
	renderOfficeThumbnail: renderOfficeThumbnail
};
