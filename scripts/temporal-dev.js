#!/usr/bin/env node
'use strict';

const { runComposeAction } = require('../lib/runtime/temporal/dev-stack');

function printUsage() {
  console.error(
    'Usage: node scripts/temporal-dev.js <up|down|status> [--repo-root <path>]'
  );
}

function parseArgs(argv) {
  const args = {
    action: null,
    repoRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--repo-root') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--repo-root requires a path');
      }
      args.repoRoot = argv[index];
      continue;
    }

    if (args.action === null) {
      args.action = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['up', 'down', 'status'].includes(args.action)) {
    throw new Error('temporal dev action must be one of: up, down, status');
  }

  return args;
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

  try {
    runComposeAction({
      repoRoot: args.repoRoot,
      action: args.action,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
};
