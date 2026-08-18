'use strict';

const http = require('node:http');
const https = require('node:https');

const { createHttpError } = require('./errors');

const CAPABILITY_CACHE_MS = 60 * 1000;
const capabilityCache = new Map();

function requestJson(url, options = {}) {
	return new Promise(function(resolve, reject) {
		const parsedUrl = new URL(url);
		const client = parsedUrl.protocol === 'https:' ? https : http;
		const request = client.get(parsedUrl, {
			timeout: options.timeoutMs || 15_000,
			rejectUnauthorized: process.env.DISABLE_TLS_CERT_VALIDATION !== '1'
		}, function(response) {
			const chunks = [];
			response.on('data', function(chunk) {
				chunks.push(chunk);
			});
			response.on('end', function() {
				const buffer = Buffer.concat(chunks);
				if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
					const error = createHttpError(response.statusCode || 502, `Collabora capabilities returned status ${response.statusCode || 0}.`);
					error.code = 'COLLABORA_CAPABILITIES_FAILED';
					reject(error);
					return;
				}
				try {
					resolve(JSON.parse(buffer.toString('utf8')));
				} catch (parseError) {
					const error = createHttpError(502, 'Collabora capabilities response is not valid JSON.');
					error.code = 'COLLABORA_CAPABILITIES_INVALID';
					reject(error);
				}
			});
		});
		request.on('timeout', function() {
			request.destroy(new Error('Collabora capabilities request timed out.'));
		});
		request.on('error', function(error) {
			const wrappedError = createHttpError(503, `Could not reach Collabora capabilities: ${error.message}`);
			wrappedError.code = 'COLLABORA_UNAVAILABLE';
			reject(wrappedError);
		});
	});
}

function isConvertToAvailable(capabilities) {
	if (!capabilities || typeof capabilities !== 'object') {
		return false;
	}
	const advertised = [
		capabilities['convert-to'],
		capabilities.convert_to,
		capabilities.convertTo
	].filter(Boolean);
	if (advertised.length > 0) {
		return !advertised.some((entry) => entry?.available === false || entry?.enabled === false);
	}
	if (capabilities.features?.['convert-to'] === true || capabilities.features?.convertTo === true) {
		return true;
	}
	return capabilities.features?.['convert-to'] !== false && capabilities.features?.convertTo !== false
		? Boolean(capabilities.conversion || capabilities.convert || capabilities['convert-to'])
		: false;
}

function resolveConvertToPaths(capabilities) {
	return ['/cool/convert-to/png'];
}

async function getCollaboraCapabilities(collaboraInternalUrl, options = {}) {
	const cacheKey = collaboraInternalUrl;
	const cacheEntry = capabilityCache.get(cacheKey);
	if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
		return cacheEntry.capabilities;
	}
	const capabilitiesUrl = new URL('/hosting/capabilities', `${collaboraInternalUrl}/`).toString();
	const capabilities = await requestJson(capabilitiesUrl, {
		timeoutMs: options.timeoutMs
	});
	capabilityCache.set(cacheKey, {
		capabilities: capabilities,
		expiresAt: Date.now() + (options.cacheMs || CAPABILITY_CACHE_MS)
	});
	return capabilities;
}

module.exports = {
	getCollaboraCapabilities: getCollaboraCapabilities,
	isConvertToAvailable: isConvertToAvailable,
	resolveConvertToPaths: resolveConvertToPaths
};
