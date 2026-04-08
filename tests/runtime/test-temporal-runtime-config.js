#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  DEFAULT_TEMPORAL_ADDRESS,
  DEFAULT_TEMPORAL_CONNECT_TIMEOUT_MS,
  DEFAULT_TEMPORAL_NAMESPACE,
  DEFAULT_TEMPORAL_UI_URL,
  resolveTemporalRuntimeConfig,
} = require(path.join(ROOT, 'lib/runtime/temporal/runtime-config'));

test('resolveTemporalRuntimeConfig uses local defaults', () => {
  const config = resolveTemporalRuntimeConfig({
    repoRoot: '/tmp/metaswarm-step9',
    env: {},
  });

  assert.equal(config.repoRoot, '/tmp/metaswarm-step9');
  assert.equal(config.address, DEFAULT_TEMPORAL_ADDRESS);
  assert.equal(config.namespace, DEFAULT_TEMPORAL_NAMESPACE);
  assert.equal(config.uiUrl, DEFAULT_TEMPORAL_UI_URL);
  assert.equal(config.connectTimeoutMs, DEFAULT_TEMPORAL_CONNECT_TIMEOUT_MS);
});

test('resolveTemporalRuntimeConfig accepts standard Temporal env overrides', () => {
  const config = resolveTemporalRuntimeConfig({
    repoRoot: '/tmp/metaswarm-step9',
    env: {
      TEMPORAL_ADDRESS: 'temporal.internal:8233',
      TEMPORAL_NAMESPACE: 'metaswarm-dev',
    },
  });

  assert.equal(config.address, 'temporal.internal:8233');
  assert.equal(config.namespace, 'metaswarm-dev');
});

test('resolveTemporalRuntimeConfig accepts metaswarm-specific aliases', () => {
  const config = resolveTemporalRuntimeConfig({
    repoRoot: '/tmp/metaswarm-step9',
    env: {
      METASWARM_TEMPORAL_ADDRESS: 'localhost:9133',
      METASWARM_TEMPORAL_NAMESPACE: 'metaswarm-local',
      TEMPORAL_ADDRESS: 'ignored:7233',
      TEMPORAL_NAMESPACE: 'ignored',
    },
  });

  assert.equal(config.address, 'localhost:9133');
  assert.equal(config.namespace, 'metaswarm-local');
});
