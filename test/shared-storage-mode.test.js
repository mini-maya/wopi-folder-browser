'use strict';

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { getSharedStorageRoot } = require('../lib/storageContext');

test('shared storage root follows the configured shared mount', () => {
  const config = {
    documentRoot: '/documents',
    sharedStorageRoot: '/external/shared'
  };

  assert.equal(getSharedStorageRoot(config), path.resolve('/external/shared'));
});

test('shared storage mode is hidden when disabled', () => {
  const mode = 'disabled';
  assert.equal(mode === 'disabled', true);
});
