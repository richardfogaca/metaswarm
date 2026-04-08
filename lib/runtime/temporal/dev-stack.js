'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_TEMPORAL_COMPOSE_FILENAME = 'compose.temporal.yaml';

function resolveTemporalComposeFile(repoRoot = process.cwd()) {
  return path.join(path.resolve(repoRoot), DEFAULT_TEMPORAL_COMPOSE_FILENAME);
}

function assertTemporalComposeFileExists(repoRoot = process.cwd()) {
  const composeFile = resolveTemporalComposeFile(repoRoot);
  if (!fs.existsSync(composeFile)) {
    throw new Error(`Temporal compose file not found at ${composeFile}`);
  }

  return composeFile;
}

function detectComposeCommand({
  execFileSyncImpl = execFileSync,
} = {}) {
  try {
    execFileSyncImpl('docker', ['compose', 'version'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return {
      command: 'docker',
      argsPrefix: ['compose'],
      displayName: 'docker compose',
    };
  } catch (dockerComposePluginError) {
    try {
      execFileSyncImpl('docker-compose', ['version'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      return {
        command: 'docker-compose',
        argsPrefix: [],
        displayName: 'docker-compose',
      };
    } catch (legacyComposeError) {
      throw new Error(
        'Docker Compose is required. Install Docker with the compose plugin or docker-compose.'
      );
    }
  }
}

function buildComposeInvocation({
  repoRoot = process.cwd(),
  action,
  execFileSyncImpl = execFileSync,
} = {}) {
  const composeCommand = detectComposeCommand({
    execFileSyncImpl,
  });
  const composeFile = assertTemporalComposeFileExists(repoRoot);

  let actionArgs;
  if (action === 'up') {
    actionArgs = ['-f', composeFile, 'up', '-d'];
  } else if (action === 'down') {
    actionArgs = ['-f', composeFile, 'down', '--remove-orphans'];
  } else if (action === 'status') {
    actionArgs = ['-f', composeFile, 'ps'];
  } else {
    throw new Error(`Unsupported temporal dev action: ${action}`);
  }

  return {
    command: composeCommand.command,
    args: [...composeCommand.argsPrefix, ...actionArgs],
    composeFile,
    composeDisplayName: composeCommand.displayName,
  };
}

function runComposeAction({
  repoRoot = process.cwd(),
  action,
  execFileSyncImpl = execFileSync,
  stdio = 'inherit',
} = {}) {
  const invocation = buildComposeInvocation({
    repoRoot,
    action,
    execFileSyncImpl,
  });

  execFileSyncImpl(invocation.command, invocation.args, {
    stdio,
    encoding: 'utf8',
  });

  return invocation;
}

module.exports = {
  DEFAULT_TEMPORAL_COMPOSE_FILENAME,
  buildComposeInvocation,
  detectComposeCommand,
  resolveTemporalComposeFile,
  runComposeAction,
};
