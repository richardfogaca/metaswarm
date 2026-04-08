'use strict';

const fs = require('fs');
const path = require('path');

const { ensureRuntimeDirectories } = require('./bootstrap');
const { validateLaunchRecord } = require('./task-definitions');

function buildLaunchRef(runId) {
  return path.posix.join('.metaswarm', 'runtime', 'launches', `${runId}.json`);
}

async function materializeLaunchRecord({ repoRoot = process.cwd(), launchRecord }) {
  const normalizedLaunchRecord = validateLaunchRecord(launchRecord);
  ensureRuntimeDirectories(repoRoot);

  const launchRef = buildLaunchRef(normalizedLaunchRecord.runId);
  const absolutePath = path.join(repoRoot, launchRef);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(normalizedLaunchRecord, null, 2)}\n`);

  return {
    launchRef,
    launchRecord: normalizedLaunchRecord,
  };
}

module.exports = {
  buildLaunchRef,
  materializeLaunchRecord,
};
