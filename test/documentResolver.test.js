'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDocumentByType, getDocumentById } = require('../lib/documentStore');
const { resolveDocumentById } = require('../lib/documentResolver');

test('resolveDocumentById resolves a document with mount context', async function() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wopi-document-resolver-'));
	const document = await createDocumentByType(tempRoot, {
		documentType: 'text',
		baseName: 'notes'
	});

	const resolved = await resolveDocumentById(tempRoot, document.id, { mountId: 'documents' });
	assert.equal(resolved.id, document.id);
	assert.equal(resolved.relativePath, 'notes.odt');
	assert.deepEqual(await getDocumentById(tempRoot, document.id), resolved);
});

test('resolveDocumentById rejects a non-string mount id', async function() {
	await assert.rejects(
		() => resolveDocumentById('/tmp/document-root', 'file-id', { mountId: 123 }),
		/mountId must be a string/i
	);
});
