'use strict';

const http = require('http');
const https = require('https');

const Dom = require('@xmldom/xmldom').DOMParser;
const xpath = require('xpath');

const { createHttpError } = require('./errors');

const DISCOVERY_CACHE_MS = 5 * 60 * 1000;
const discoveryCache = new Map();

function shouldDisableTlsValidation() {
	return process.env.DISABLE_TLS_CERT_VALIDATION === '1';
}

function fetchText(url) {
	return new Promise(function(resolve, reject) {
		const parsedUrl = new URL(url);
		const httpClient = parsedUrl.protocol === 'https:' ? https : http;
		const request = httpClient.get(parsedUrl, {
			rejectUnauthorized: !shouldDisableTlsValidation()
		}, function(response) {
			let data = '';
			response.setEncoding('utf8');
			response.on('data', function(chunk) {
				data += chunk;
			});
			response.on('end', function() {
				if (response.statusCode !== 200) {
					reject(createHttpError(response.statusCode || 502, `Discovery request failed with status ${response.statusCode}.`));
					return;
				}

				resolve(data);
			});
		});

		request.on('error', function(error) {
			reject(createHttpError(502, `Could not reach Collabora discovery: ${error.message}`));
		});
	});
}

async function getDiscoveryDocument(collaboraInternalUrl) {
	const cacheEntry = discoveryCache.get(collaboraInternalUrl);
	if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
		return cacheEntry.document;
	}

	const discoveryUrl = new URL('/hosting/discovery', `${collaboraInternalUrl}/`).toString();
	const xml = await fetchText(discoveryUrl);
	const document = new Dom().parseFromString(xml);
	discoveryCache.set(collaboraInternalUrl, {
		document: document,
		expiresAt: Date.now() + DISCOVERY_CACHE_MS
	});
	return document;
}

function rewriteActionUrl(urlsrc, collaboraPublicUrl) {
	const rewrittenUrl = new URL(collaboraPublicUrl);
	const discoveredUrl = new URL(urlsrc);
	rewrittenUrl.pathname = discoveredUrl.pathname;
	rewrittenUrl.search = discoveredUrl.search;
	rewrittenUrl.hash = discoveredUrl.hash;
	return rewrittenUrl.toString();
}

function getSupportedExtensions(document) {
	const nodes = xpath.select('/wopi-discovery/net-zone/app/action', document);
	const extensions = new Set();
	for (const node of nodes) {
		const ext = node.getAttribute('ext');
		if (ext) {
			extensions.add(`.${ext.toLowerCase()}`);
		}
	}

	return Array.from(extensions).sort();
}

async function getSupportedFormats(collaboraInternalUrl) {
	const document = await getDiscoveryDocument(collaboraInternalUrl);
	return getSupportedExtensions(document);
}

async function getActionUrl(options) {
	const document = await getDiscoveryDocument(options.collaboraInternalUrl);
	const extension = options.extension.replace(/^\./, '').toLowerCase();
	const preferredMode = options.mode === 'view' ? 'view' : 'edit';
	const queries = [
		`/wopi-discovery/net-zone/app/action[@ext='${extension}' and @name='${preferredMode}']`,
		`/wopi-discovery/net-zone/app/action[@ext='${extension}' and @name='edit']`,
		`/wopi-discovery/net-zone/app/action[@ext='${extension}' and @default='true']`,
		`/wopi-discovery/net-zone/app/action[@ext='${extension}' and @name='view']`
	];

	for (const query of queries) {
		const nodes = xpath.select(query, document);
		if (nodes && nodes.length > 0) {
			const urlsrc = nodes[0].getAttribute('urlsrc');
			if (!urlsrc) {
				break;
			}

			return rewriteActionUrl(urlsrc, options.collaboraPublicUrl);
		}
	}

	throw createHttpError(400, `Collabora does not advertise support for .${extension} files.`);
}

module.exports = {
	getActionUrl: getActionUrl,
	getSupportedFormats: getSupportedFormats
};
