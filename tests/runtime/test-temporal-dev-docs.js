#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

test('temporal local development docs reference the implemented commands', () => {
  const docs = fs.readFileSync(path.join(ROOT, 'docs/temporal-dev.md'), 'utf8');
  const compose = fs.readFileSync(path.join(ROOT, 'compose.temporal.yaml'), 'utf8');

  assert.match(docs, /npm run temporal:dev:up/);
  assert.match(docs, /npm run temporal:dev:status/);
  assert.match(docs, /npm run temporal:worker/);
  assert.match(docs, /npm run temporal:dev:down/);
  assert.match(docs, /metaswarm temporal status/);
  assert.match(docs, /METASWARM_TEMPORAL_PORT=8233/);
  assert.match(compose, /\$\{METASWARM_TEMPORAL_PORT:-7233\}:7233/);
  assert.match(compose, /\$\{METASWARM_TEMPORAL_UI_PORT:-8080\}:8080/);
});
