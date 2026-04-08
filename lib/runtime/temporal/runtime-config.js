'use strict';

const path = require('path');

const DEFAULT_TEMPORAL_ADDRESS = 'localhost:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_UI_URL = 'http://localhost:8080';
const DEFAULT_TEMPORAL_CONNECT_TIMEOUT_MS = 10_000;

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  return null;
}

function resolveTemporalRuntimeConfig({
  repoRoot = process.cwd(),
  env = process.env,
} = {}) {
  const address = firstNonEmptyString(
    env.METASWARM_TEMPORAL_ADDRESS,
    env.TEMPORAL_ADDRESS
  ) ?? DEFAULT_TEMPORAL_ADDRESS;
  const namespace = firstNonEmptyString(
    env.METASWARM_TEMPORAL_NAMESPACE,
    env.TEMPORAL_NAMESPACE
  ) ?? DEFAULT_TEMPORAL_NAMESPACE;

  return {
    repoRoot: path.resolve(repoRoot),
    address,
    namespace,
    uiUrl: DEFAULT_TEMPORAL_UI_URL,
    connectTimeoutMs: DEFAULT_TEMPORAL_CONNECT_TIMEOUT_MS,
  };
}

module.exports = {
  DEFAULT_TEMPORAL_ADDRESS,
  DEFAULT_TEMPORAL_CONNECT_TIMEOUT_MS,
  DEFAULT_TEMPORAL_NAMESPACE,
  DEFAULT_TEMPORAL_UI_URL,
  resolveTemporalRuntimeConfig,
};
