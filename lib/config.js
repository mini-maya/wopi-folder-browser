'use strict';

const path = require('node:path');

function normalizeBaseUrl(value, environmentVariableName) {
	if (!value) {
		return null;
	}

	let url;
	try {
		url = new URL(value);
	} catch (error) {
		throw new Error(`${environmentVariableName} must be a valid absolute http(s) URL.`);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`${environmentVariableName} must use http or https.`);
	}

	url.pathname = url.pathname.replace(/\/+$/, '') || '/';
	url.search = '';
	url.hash = '';
	return url.toString().replace(/\/$/, '');
}

const configuredAppBaseUrl = normalizeBaseUrl(process.env.APP_BASE_URL || null, 'APP_BASE_URL');

function parsePasswordMinLength(value) {
	if (value === undefined || value === null || value === '') {
		return 12;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error('PASSWORD_MIN_LENGTH must be an integer >= 1.');
	}

	return parsed;
}

function parsePositiveInteger(value, defaultValue, variableName) {
	if (value === undefined || value === null || value === '') {
		return defaultValue;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${variableName} must be an integer >= 1.`);
	}
	return parsed;
}

module.exports = {
	documentRoot: path.resolve(process.env.DOCUMENT_ROOT || path.join(__dirname, '..', 'example-documents')),
	templateRoot: path.resolve(process.env.TEMPLATE_ROOT || path.join(process.env.DOCUMENT_ROOT || path.join(__dirname, '..', 'example-documents'), '.templates')),
	maxDocumentSize: process.env.MAX_DOCUMENT_SIZE || '100mb',
	accessTokenSecret: process.env.ACCESS_TOKEN_SECRET || 'change-me-for-real-usage',
	sessionSecret: process.env.SESSION_SECRET || process.env.ACCESS_TOKEN_SECRET || 'change-me-session-secret',
	passwordMinLength: parsePasswordMinLength(process.env.PASSWORD_MIN_LENGTH),
	defaultEditorMode: process.env.DEFAULT_EDITOR_MODE === 'view' ? 'view' : 'edit',
	allowDocumentCreation: process.env.ALLOW_DOCUMENT_CREATION !== '0',
	allowTemplates: process.env.ALLOW_TEMPLATES !== '0',
	allowPdfExport: process.env.ALLOW_PDF_EXPORT !== '0',
	allowPublicEditing: process.env.ALLOW_PUBLIC_EDITING !== '0',
	previewGeneration: process.env.PREVIEW_GENERATION !== '0',
	thumbnailDebug: process.env.THUMBNAIL_DEBUG === '1',
	thumbnailMaxWidth: parsePositiveInteger(process.env.THUMBNAIL_MAX_WIDTH, 1024, 'THUMBNAIL_MAX_WIDTH'),
	thumbnailMaxHeight: parsePositiveInteger(process.env.THUMBNAIL_MAX_HEIGHT, 1024, 'THUMBNAIL_MAX_HEIGHT'),
	thumbnailRetryCount: parsePositiveInteger(process.env.THUMBNAIL_RETRY_COUNT, 3, 'THUMBNAIL_RETRY_COUNT'),
	thumbnailRetryDelayMs: parsePositiveInteger(process.env.THUMBNAIL_RETRY_DELAY_MS, 300, 'THUMBNAIL_RETRY_DELAY_MS'),
	thumbnailRequestTimeoutMs: parsePositiveInteger(process.env.THUMBNAIL_REQUEST_TIMEOUT_MS, 15000, 'THUMBNAIL_REQUEST_TIMEOUT_MS'),
	thumbnailTokenTtlMs: parsePositiveInteger(process.env.THUMBNAIL_TOKEN_TTL_MS, 60000, 'THUMBNAIL_TOKEN_TTL_MS'),
	defaultTextDocumentName: process.env.DEFAULT_TEXT_DOCUMENT_NAME || 'Untitled document',
	defaultSpreadsheetName: process.env.DEFAULT_SPREADSHEET_NAME || 'Untitled spreadsheet',
	defaultPresentationName: process.env.DEFAULT_PRESENTATION_NAME || 'Untitled presentation',
	collaboraInternalUrl: normalizeBaseUrl(
		process.env.COLLABORA_INTERNAL_URL || process.env.COLLABORA_URL || 'http://localhost:9980',
		'COLLABORA_INTERNAL_URL'
	),
	collaboraPublicUrl: normalizeBaseUrl(
		process.env.COLLABORA_PUBLIC_URL || process.env.COLLABORA_URL || 'http://localhost:9980',
		'COLLABORA_PUBLIC_URL'
	),
	getRequestOrigin: function(req) {
		const forwardedProto = req.get('x-forwarded-proto');
		const forwardedHost = req.get('x-forwarded-host');
		const protocol = (forwardedProto || req.protocol).split(',')[0].trim();
		const host = (forwardedHost || req.get('host')).split(',')[0].trim();
		return `${protocol}://${host}`;
	},
	getPublicAppBaseUrl: function(req) {
		return this.getRequestOrigin(req);
	},
	getAppBaseUrl: function(req) {
		if (configuredAppBaseUrl) {
			return configuredAppBaseUrl;
		}

		return this.getRequestOrigin(req);
	}
};
