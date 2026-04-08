'use strict';

const { proxyActivities, sleep } = require('@temporalio/workflow');

const {
  buildStep1ReviewArtifact,
  buildTerminalWorkflowResult,
  validateIssueWorkflowInput,
} = require('../contracts');

const { emitRunSummary } = proxyActivities({
  startToCloseTimeout: '1 minute',
});

function nowIso() {
  return new Date(Date.now()).toISOString();
}

async function issueWorkflow(rawInput) {
  const input = validateIssueWorkflowInput(rawInput);
  const beadsId = input.beadsTarget.beadsId;
  let summaryRef;

  if (input.runtimeSkeleton.mode === 'sleep_until') {
    const sleepingArtifact = buildStep1ReviewArtifact({
      input,
      runtimeStatus: 'sleeping',
      endedAt: nowIso(),
      blockers: [input.runtimeSkeleton.reason || 'Waiting for timer wakeup'],
      humanActionRequired: null,
    });

    ({ summaryRef } = await emitRunSummary(sleepingArtifact));

    const durationMs = Date.parse(input.runtimeSkeleton.sleepUntil) - Date.now();
    if (durationMs > 0) {
      await sleep(durationMs);
    }
  }

  const completedArtifact = buildStep1ReviewArtifact({
    input,
    runtimeStatus: 'completed',
    endedAt: nowIso(),
    blockers: [],
    humanActionRequired: null,
  });

  ({ summaryRef } = await emitRunSummary(completedArtifact));

  return buildTerminalWorkflowResult({
    runId: input.runId,
    beadsId,
    terminalStatus: 'completed',
    summaryRef,
  });
}

module.exports = {
  issueWorkflow,
};
