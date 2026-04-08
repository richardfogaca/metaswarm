'use strict';

const fs = require('fs');
const path = require('path');

const { ensureRuntimeDirectories } = require('./bootstrap');
const { validateSpecToPlanAction } = require('./contracts');

function buildPlanningArtifactRef(artifactKey) {
  const normalizedAction = validateSpecToPlanAction({
    kind: 'draft_plan',
    actionKey: 'normalize-planning-artifact-ref',
    artifactKey,
  });

  return path.posix.join(
    '.metaswarm',
    'runtime',
    'planning-artifacts',
    `${normalizedAction.artifactKey}.json`
  );
}

async function executeIdempotentSpecToPlanAction({
  repoRoot = process.cwd(),
  runId,
  beadsId,
  action,
  performSpecToPlanAction,
} = {}) {
  const normalizedAction = validateSpecToPlanAction(action, 'action');
  ensureRuntimeDirectories(repoRoot);

  const artifactRef = buildPlanningArtifactRef(normalizedAction.artifactKey);
  const absolutePath = path.join(repoRoot, artifactRef);

  if (fs.existsSync(absolutePath)) {
    return {
      artifactRef,
      artifact: JSON.parse(fs.readFileSync(absolutePath, 'utf8')),
      reused: true,
    };
  }

  const result = await (performSpecToPlanAction ?? (async () => ({
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
  buildPlanningArtifactRef,
  executeIdempotentSpecToPlanAction,
};
