'use strict';

const fs = require('fs');
const path = require('path');

const { ensureRuntimeDirectories } = require('./bootstrap');
const { validateMorningReviewArtifact } = require('./contracts');

function buildSummaryRef(runId) {
  return path.posix.join('.metaswarm', 'runtime', 'reviews', `${runId}.json`);
}

async function materializeRunSummary({ repoRoot = process.cwd(), artifact }) {
  const normalizedArtifact = validateMorningReviewArtifact(artifact);
  ensureRuntimeDirectories(repoRoot);

  const summaryRef = buildSummaryRef(normalizedArtifact.runId);
  const absolutePath = path.join(repoRoot, summaryRef);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(normalizedArtifact, null, 2)}\n`);

  return {
    summaryRef,
    artifact: normalizedArtifact,
  };
}

module.exports = {
  buildSummaryRef,
  materializeRunSummary,
};
