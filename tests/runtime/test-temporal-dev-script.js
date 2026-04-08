#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { parseArgs } = require(path.join(ROOT, 'scripts/temporal-dev.js'));

test('temporal-dev script accepts up, down, and status actions', () => {
  assert.deepEqual(parseArgs(['up']), {
    action: 'up',
    repoRoot: process.cwd(),
  });
  assert.deepEqual(parseArgs(['down', '--repo-root', '/tmp/metaswarm-step9']), {
    action: 'down',
    repoRoot: '/tmp/metaswarm-step9',
  });
  assert.deepEqual(parseArgs(['status']), {
    action: 'status',
    repoRoot: process.cwd(),
  });
});

test('temporal-dev script rejects missing or invalid actions', () => {
  assert.throws(() => parseArgs([]), /must be one of/i);
  assert.throws(() => parseArgs(['boot']), /must be one of/i);
  assert.throws(() => parseArgs(['up', '--repo-root']), /requires a path/i);
});
