'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function sign(encodedPayload, secret) {
	return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function createAccessToken(options) {
	const payload = {
		fileId: options.fileId,
		exp: Date.now() + (options.ttlMs || DEFAULT_TTL_MS),
		...options.claims
	};
	const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const signature = sign(encodedPayload, options.secret);
	return {
		token: `${encodedPayload}.${signature}`,
		expiresAt: payload.exp
	};
}

function verifyAccessToken(token, options) {
	if (!token) {
		const error = new Error('Missing WOPI access token.');
		error.status = 401;
		throw error;
	}

	const parts = token.split('.');
	if (parts.length !== 2) {
		const error = new Error('Malformed WOPI access token.');
		error.status = 401;
		throw error;
	}

	const encodedPayload = parts[0];
	const actualSignature = parts[1];
	const expectedSignature = sign(encodedPayload, options.secret);
	const actualSignatureBuffer = Buffer.from(actualSignature);
	const expectedSignatureBuffer = Buffer.from(expectedSignature);
	if (
		actualSignatureBuffer.length !== expectedSignatureBuffer.length ||
		!crypto.timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)
	) {
		const error = new Error('Invalid WOPI access token signature.');
		error.status = 401;
		throw error;
	}

	let payload;
	try {
		payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
	} catch (parseError) {
		const error = new Error('Invalid WOPI access token payload.');
		error.status = 401;
		throw error;
	}

	if (payload.fileId !== options.fileId) {
		const error = new Error('WOPI access token does not match the requested file.');
		error.status = 403;
		throw error;
	}

	if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
		const error = new Error('WOPI access token has expired.');
		error.status = 401;
		throw error;
	}

	if (typeof options.validate === 'function') {
		options.validate(payload);
	}

	return payload;
}

module.exports = {
	createAccessToken: createAccessToken,
	verifyAccessToken: verifyAccessToken
};
