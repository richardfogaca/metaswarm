#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Connection } = require('@temporalio/client');
const { NativeConnection } = require('@temporalio/worker');

const ROOT = path.resolve(__dirname, '../..');
const {
  buildCheckSummary,
  ensureServerReachable,
  parseArgs,
  runWorker,
} = require(path.join(ROOT, 'scripts/temporal-worker.js'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step9-worker-'));
}

test('parseArgs supports check mode and explicit repo roots', () => {
  assert.deepEqual(parseArgs([]), {
    check: false,
    repoRoot: process.cwd(),
  });

  assert.deepEqual(parseArgs(['--check', '--repo-root', '/tmp/metaswarm-step9']), {
    check: true,
    repoRoot: '/tmp/metaswarm-step9',
  });
});

test('parseArgs rejects malformed flags', () => {
  assert.throws(() => parseArgs(['--repo-root']), /requires a path/i);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/i);
});

test('buildCheckSummary reports the effective Temporal runtime config', () => {
  const repoRoot = makeRepoRoot();
  const summary = buildCheckSummary(repoRoot, {
    METASWARM_TEMPORAL_ADDRESS: 'localhost:9133',
    METASWARM_TEMPORAL_NAMESPACE: 'metaswarm-dev',
  });

  assert.equal(summary.repoRoot, repoRoot);
  assert.equal(summary.temporal.address, 'localhost:9133');
  assert.equal(summary.temporal.namespace, 'metaswarm-dev');
  assert.equal(summary.temporal.uiUrl, 'http://localhost:8080');
  assert.ok(summary.activityNames.includes('emitRunSummary'));
});

test('ensureServerReachable fails within the bounded startup path', async () => {
  await assert.rejects(
    ensureServerReachable({
      address: 'localhost:7233',
      connectTimeoutMs: 2500,
      connectClient: async () => {
        throw new Error('connection refused');
      },
    }),
    /Unable to reach Temporal server at localhost:7233 within 2500ms/i
  );
});

test('runWorker creates a real worker with one shared connection and namespace', async () => {
  const repoRoot = makeRepoRoot();
  const events = [];

  const fakeNativeConnection = {
    async close() {
      events.push('connection:close');
    },
  };

  await runWorker({
    repoRoot,
    env: {
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'metaswarm-local',
    },
    connectClient: async () => ({
      async close() {
        events.push('preflight:close');
      },
    }),
    connectNative: async (options) => {
      events.push(`native-connect:${options.address}`);
      return fakeNativeConnection;
    },
    createClient(options) {
      events.push(`client:${options.namespace}`);
      assert.equal(options.connection, fakeNativeConnection);
      return {
        workflow: {},
      };
    },
    createActivities({ repoRoot: configuredRepoRoot, client }) {
      events.push(`activities:${configuredRepoRoot}`);
      assert.equal(configuredRepoRoot, repoRoot);
      assert.ok(client);
      return {
        emitRunSummary() {},
      };
    },
    async createWorker(options) {
      events.push(`worker-create:${options.namespace}`);
      assert.equal(options.namespace, 'metaswarm-local');
      assert.equal(options.connection, fakeNativeConnection);
      assert.equal(options.repoRoot, repoRoot);
      return {
        shutdown() {
          events.push('worker:shutdown');
        },
        async run() {
          events.push('worker:run');
        },
      };
    },
  });

  assert.deepEqual(events, [
    'preflight:close',
    'native-connect:localhost:7233',
    'client:metaswarm-local',
    `activities:${repoRoot}`,
    'worker-create:metaswarm-local',
    'worker:run',
    'connection:close',
  ]);
});

test('runWorker preserves Temporal SDK static-method bindings in the default startup path', async () => {
  const repoRoot = makeRepoRoot();
  const events = [];
  const originalClientConnect = Connection.connect;
  const originalNativeConnect = NativeConnection.connect;
  const originalWorkerCreate = require('@temporalio/worker').Worker.create;

  Connection.connect = async function connect(options) {
    assert.equal(this, Connection);
    events.push(`preflight:${options.address}`);
    return {
      async close() {
        events.push('preflight:close');
      },
    };
  };

  NativeConnection.connect = async function connect(options) {
    assert.equal(this, NativeConnection);
    events.push(`native:${options.address}`);
    return {
      async close() {
        events.push('native:close');
      },
    };
  };

  require('@temporalio/worker').Worker.create = async function create() {
    assert.equal(this, require('@temporalio/worker').Worker);
    return {
      shutdown() {},
      async run() {
        events.push('worker:run');
      },
    };
  };

  try {
    await runWorker({
      repoRoot,
      env: {
        TEMPORAL_ADDRESS: 'localhost:9233',
        TEMPORAL_NAMESPACE: 'default',
      },
      createClient() {
        return {
          workflow: {},
        };
      },
      createActivities() {
        return {
          emitRunSummary() {},
        };
      },
    });
  } finally {
    Connection.connect = originalClientConnect;
    NativeConnection.connect = originalNativeConnect;
    require('@temporalio/worker').Worker.create = originalWorkerCreate;
  }

  assert.deepEqual(events, [
    'preflight:localhost:9233',
    'preflight:close',
    'native:localhost:9233',
    'worker:run',
    'native:close',
  ]);
});
