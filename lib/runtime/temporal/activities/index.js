'use strict';

function notImplementedActivity(name) {
  return async function phaseZeroPlaceholderActivity() {
    throw new Error(`${name} is not implemented yet. Phase 0 only provides the Temporal runtime scaffold.`);
  };
}

const bootstrapActivities = {
  emitRunSummary: notImplementedActivity('emitRunSummary'),
  lookupBeadsTarget: notImplementedActivity('lookupBeadsTarget'),
  readWorkflowState: notImplementedActivity('readWorkflowState'),
};

module.exports = {
  bootstrapActivities,
  notImplementedActivity,
};
