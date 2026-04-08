#!/usr/bin/env node
'use strict';

const { Connection, Client } = require('@temporalio/client');
const { Worker, NativeConnection } = require('@temporalio/worker');

const {
  createWorkerBootstrapOptions,
  ensureRuntimeDirectories,
} = require('../lib/runtime/temporal/bootstrap');
const { createTemporalActivities } = require('../lib/runtime/temporal/activities');
const { resolveTemporalRuntimeConfig } = require('../lib/runtime/temporal/runtime-config');

function printUsage() {
  console.error(
    'Usage: node scripts/temporal-worker.js [--check] [--repo-root <path>]'
  );
}

function parseArgs(argv) {
  const args = {
    check: false,
    repoRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--check') {
      args.check = true;
      continue;
    }

    if (arg === '--repo-root') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--repo-root requires a path');
      }
      args.repoRoot = argv[index];
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function buildCheckSummary(repoRoot, env = process.env) {
  const runtimeConfig = resolveTemporalRuntimeConfig({
    repoRoot,
    env,
  });
  const runtimePaths = ensureRuntimeDirectories(runtimeConfig.repoRoot);
  const workerOptions = createWorkerBootstrapOptions({
    repoRoot: runtimeConfig.repoRoot,
    activities: createTemporalActivities({ repoRoot: runtimeConfig.repoRoot }),
  });

  return {
    repoRoot: runtimeConfig.repoRoot,
    taskQueue: workerOptions.taskQueue,
    workflowsPath: workerOptions.workflowsPath,
    activityNames: Object.keys(workerOptions.activities),
    runtimePaths,
    temporal: {
      address: runtimeConfig.address,
      namespace: runtimeConfig.namespace,
      uiUrl: runtimeConfig.uiUrl,
      connectTimeoutMs: runtimeConfig.connectTimeoutMs,
    },
  };
}

async function ensureServerReachable({
  address,
  connectTimeoutMs,
  connectClient = Connection.connect,
} = {}) {
  let connection;
  try {
    connection = await connectClient({
      address,
      connectTimeout: connectTimeoutMs,
    });
  } catch (error) {
    throw new Error(
      `Unable to reach Temporal server at ${address} within ${connectTimeoutMs}ms: ${error.message}`
    );
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

function installShutdownHandlers(worker) {
  const handleShutdownSignal = () => {
    worker.shutdown();
  };

  process.once('SIGINT', handleShutdownSignal);
  process.once('SIGTERM', handleShutdownSignal);

  return () => {
    process.removeListener('SIGINT', handleShutdownSignal);
    process.removeListener('SIGTERM', handleShutdownSignal);
  };
}

async function runWorker({
  repoRoot = process.cwd(),
  env = process.env,
  connectClient = options => Connection.connect(options),
  connectNative = options => NativeConnection.connect(options),
  createWorker = options => Worker.create(options),
  createClient = options => new Client(options),
  createActivities = createTemporalActivities,
} = {}) {
  const runtimeConfig = resolveTemporalRuntimeConfig({
    repoRoot,
    env,
  });
  ensureRuntimeDirectories(runtimeConfig.repoRoot);

  await ensureServerReachable({
    address: runtimeConfig.address,
    connectTimeoutMs: runtimeConfig.connectTimeoutMs,
    connectClient,
  });

  const nativeConnection = await connectNative({
    address: runtimeConfig.address,
  });

  try {
    const client = createClient({
      connection: nativeConnection,
      namespace: runtimeConfig.namespace,
    });
    const workerOptions = createWorkerBootstrapOptions({
      repoRoot: runtimeConfig.repoRoot,
      activities: createActivities({
        repoRoot: runtimeConfig.repoRoot,
        client,
      }),
    });

    const worker = await createWorker({
      ...workerOptions,
      connection: nativeConnection,
      namespace: runtimeConfig.namespace,
    });
    const removeShutdownHandlers = installShutdownHandlers(worker);

    try {
      await worker.run();
    } finally {
      removeShutdownHandlers();
    }
  } finally {
    await nativeConnection.close();
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.check) {
    process.stdout.write(`${JSON.stringify(buildCheckSummary(args.repoRoot), null, 2)}\n`);
    return;
  }

  await runWorker({
    repoRoot: args.repoRoot,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCheckSummary,
  ensureServerReachable,
  parseArgs,
  runWorker,
};
