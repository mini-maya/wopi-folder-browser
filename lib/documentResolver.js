'use strict';

const { getDocumentById } = require('./documentStore');

async function resolveDocumentById(storageRoot, fileId) {
	return getDocumentById(storageRoot, fileId);
}

module.exports = {
	resolveDocumentById
};
