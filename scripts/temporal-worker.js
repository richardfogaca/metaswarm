#!/usr/bin/env node
'use strict';

const {
  createWorkerBootstrapOptions,
  ensureRuntimeDirectories,
} = require('../lib/runtime/temporal/bootstrap');
const { bootstrapActivities } = require('../lib/runtime/temporal/activities');

function printUsage() {
  console.error('Usage: node scripts/temporal-worker.js --check [--repo-root <path>]');
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

function buildCheckSummary(repoRoot) {
  const runtimePaths = ensureRuntimeDirectories(repoRoot);
  const workerOptions = createWorkerBootstrapOptions({
    repoRoot,
    activities: bootstrapActivities,
  });

  return {
    repoRoot,
    taskQueue: workerOptions.taskQueue,
    workflowsPath: workerOptions.workflowsPath,
    activityNames: Object.keys(workerOptions.activities),
    runtimePaths,
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!args.check) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${JSON.stringify(buildCheckSummary(args.repoRoot), null, 2)}\n`);
}

if (require.main === module) {
  main();
}
