'use strict';

const { materializeRunSummary } = require('../review-artifacts');

function notImplementedActivity(name) {
  return async function phaseZeroPlaceholderActivity() {
    throw new Error(`${name} is not implemented yet in the current Temporal runtime slice.`);
  };
}

function createTemporalActivities({ repoRoot = process.cwd() } = {}) {
  return {
    async emitRunSummary(artifact) {
      return materializeRunSummary({
        repoRoot,
        artifact,
      });
    },
    async lookupBeadsTarget(target) {
      return target;
    },
    async readWorkflowState(input) {
      return {
        status: 'step1-unimplemented',
        input,
      };
    },
  };
}

const bootstrapActivities = createTemporalActivities();

module.exports = {
  bootstrapActivities,
  createTemporalActivities,
  notImplementedActivity,
};
