'use strict';

const { getDocumentById } = require('./documentStore');

async function resolveDocumentById(documentRoot, fileId, options = {}) {
	if (options.mountId && typeof options.mountId !== 'string') {
		throw new Error('mountId must be a string when provided.');
	}
	return getDocumentById(documentRoot, fileId);
}

module.exports = {
	resolveDocumentById
};
