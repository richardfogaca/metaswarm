#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  DEFAULT_TEMPORAL_COMPOSE_FILENAME,
  buildComposeInvocation,
  detectComposeCommand,
  resolveTemporalComposeFile,
} = require(path.join(ROOT, 'lib/runtime/temporal/dev-stack'));

function makeRepoRoot() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step9-compose-'));
  fs.writeFileSync(path.join(repoRoot, DEFAULT_TEMPORAL_COMPOSE_FILENAME), 'services:\n  test:\n');
  return repoRoot;
}

test('resolveTemporalComposeFile uses the documented stable filename', () => {
  const repoRoot = '/tmp/metaswarm-step9';
  assert.equal(
    resolveTemporalComposeFile(repoRoot),
    path.join(repoRoot, DEFAULT_TEMPORAL_COMPOSE_FILENAME)
  );
});

test('detectComposeCommand prefers docker compose when available', () => {
  const calls = [];
  const compose = detectComposeCommand({
    execFileSyncImpl(command, args) {
      calls.push([command, args]);
      if (command === 'docker' && args[0] === 'compose') {
        return 'Docker Compose version v5.0.1';
      }
      throw new Error('unexpected fallback');
    },
  });

  assert.deepEqual(compose, {
    command: 'docker',
    argsPrefix: ['compose'],
    displayName: 'docker compose',
  });
  assert.deepEqual(calls, [['docker', ['compose', 'version']]]);
});

test('detectComposeCommand falls back to docker-compose when needed', () => {
  const calls = [];
  const compose = detectComposeCommand({
    execFileSyncImpl(command, args) {
      calls.push([command, args]);
      if (command === 'docker') {
        throw new Error('no compose plugin');
      }
      return 'docker-compose version 1.29';
    },
  });

  assert.deepEqual(compose, {
    command: 'docker-compose',
    argsPrefix: [],
    displayName: 'docker-compose',
  });
  assert.deepEqual(calls, [
    ['docker', ['compose', 'version']],
    ['docker-compose', ['version']],
  ]);
});

test('buildComposeInvocation maps up, down, and status onto one compose file', () => {
  const repoRoot = makeRepoRoot();

  const up = buildComposeInvocation({
    repoRoot,
    action: 'up',
    execFileSyncImpl() {
      return 'Docker Compose version v5.0.1';
    },
  });
  const down = buildComposeInvocation({
    repoRoot,
    action: 'down',
    execFileSyncImpl() {
      return 'Docker Compose version v5.0.1';
    },
  });
  const status = buildComposeInvocation({
    repoRoot,
    action: 'status',
    execFileSyncImpl() {
      return 'Docker Compose version v5.0.1';
    },
  });

  const composeFile = path.join(repoRoot, DEFAULT_TEMPORAL_COMPOSE_FILENAME);
  assert.deepEqual(up, {
    command: 'docker',
    args: ['compose', '-f', composeFile, 'up', '-d'],
    composeFile,
    composeDisplayName: 'docker compose',
  });
  assert.deepEqual(down.args, ['compose', '-f', composeFile, 'down', '--remove-orphans']);
  assert.deepEqual(status.args, ['compose', '-f', composeFile, 'ps']);
});

test('buildComposeInvocation fails clearly when docker compose is unavailable', () => {
  const repoRoot = makeRepoRoot();

  assert.throws(
    () =>
      buildComposeInvocation({
        repoRoot,
        action: 'up',
        execFileSyncImpl() {
          throw new Error('missing');
        },
      }),
    /Docker Compose is required/i
  );
});
