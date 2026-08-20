'use strict';

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const { getDocumentRoot } = require('../routes/apiDocuments');

test('authenticated documents requests resolve to a user-scoped root', () => {
  const req = {
    auth: { authenticated: true, user: { id: 'user-42' } },
    session: { userId: 'user-42' },
    storage: { id: 'documents', root: config.documentRoot }
  };

  assert.equal(getDocumentRoot(req), path.join(config.documentRoot, 'users', 'user-42'));
});

test('anonymous requests still fall back to the shared base root when no user is present', () => {
  const req = {
    auth: { authenticated: false, user: null },
    storage: { id: 'documents', root: config.documentRoot }
  };

  assert.equal(getDocumentRoot(req), config.documentRoot);
});
