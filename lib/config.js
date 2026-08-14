'use strict';

const path = require('path');

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

module.exports = {
	documentRoot: path.resolve(process.env.DOCUMENT_ROOT || path.join(__dirname, '..', 'example-documents')),
	templateRoot: path.resolve(process.env.TEMPLATE_ROOT || path.join(process.env.DOCUMENT_ROOT || path.join(__dirname, '..', 'example-documents'), '.templates')),
	maxDocumentSize: process.env.MAX_DOCUMENT_SIZE || '100mb',
	accessTokenSecret: process.env.ACCESS_TOKEN_SECRET || 'change-me-for-real-usage',
	defaultEditorMode: process.env.DEFAULT_EDITOR_MODE === 'view' ? 'view' : 'edit',
	allowDocumentCreation: process.env.ALLOW_DOCUMENT_CREATION !== '0',
	allowTemplates: process.env.ALLOW_TEMPLATES !== '0',
	allowPdfExport: process.env.ALLOW_PDF_EXPORT !== '0',
	allowPublicEditing: process.env.ALLOW_PUBLIC_EDITING !== '0',
	previewGeneration: process.env.PREVIEW_GENERATION !== '0',
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
	getAppBaseUrl: function(req) {
		if (configuredAppBaseUrl) {
			return configuredAppBaseUrl;
		}

		return `${req.protocol}://${req.get('host')}`;
	}
};
