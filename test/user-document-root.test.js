'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getDocumentRoot } = require('../routes/apiDocuments');

test('authenticated mount requests resolve to the selected mount root', () => {
  const req = {
    auth: { authenticated: true, user: { id: 'user-42' } },
    mount: { id: 'documents', root: '/mnt/documents' }
  };
 
  assert.equal(getDocumentRoot(req), '/mnt/documents');
});

test('authenticated requests without a mount are rejected', () => {
  const req = {
    auth: { authenticated: true, user: { id: 'user-42' } }
  };

  assert.throws(() => getDocumentRoot(req), { status: 403 });
});
 
test('requests without a mount fall back to the mount root container path', () => {
  const req = {
    auth: { authenticated: false, user: null },
  };
 
  assert.equal(getDocumentRoot(req), '/mnt');
});
