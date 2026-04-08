'use strict';

const fs = require('fs');
const path = require('path');

const { ensureRuntimeDirectories } = require('./bootstrap');
const { validateWorkUnitAction } = require('./contracts');

function buildWorkUnitArtifactRef(artifactKey) {
  const normalizedAction = validateWorkUnitAction({
    kind: 'implement',
    workUnitId: 'normalize-work-unit-artifact-ref',
    actionKey: 'normalize-work-unit-action',
    artifactKey,
  });

  return path.posix.join(
    '.metaswarm',
    'runtime',
    'work-unit-artifacts',
    `${normalizedAction.artifactKey}.json`
  );
}

async function executeIdempotentWorkUnitAction({
  repoRoot = process.cwd(),
  runId,
  beadsId,
  action,
  performWorkUnitAction,
} = {}) {
  const normalizedAction = validateWorkUnitAction(action, 'action');
  ensureRuntimeDirectories(repoRoot);

  const artifactRef = buildWorkUnitArtifactRef(normalizedAction.artifactKey);
  const absolutePath = path.join(repoRoot, artifactRef);

  if (fs.existsSync(absolutePath)) {
    return {
      artifactRef,
      artifact: JSON.parse(fs.readFileSync(absolutePath, 'utf8')),
      reused: true,
    };
  }

  const result = await (performWorkUnitAction ?? (async () => ({
    status: 'placeholder',
    performed: false,
  })))(normalizedAction);

  const artifact = {
    version: 1,
    runId,
    beadsId,
    action: normalizedAction,
    generatedAt: new Date().toISOString(),
    result,
  };

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`);

  return {
    artifactRef,
    artifact,
    reused: false,
  };
}

module.exports = {
  buildWorkUnitArtifactRef,
  executeIdempotentWorkUnitAction,
};
