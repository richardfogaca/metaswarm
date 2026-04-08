'use strict';

const {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} = require('@temporalio/workflow');

const {
  buildStep1ReviewArtifact,
  buildStep4ReviewArtifact,
  buildTerminalWorkflowResult,
  validateIssueWorkflowInput,
} = require('../contracts');

const {
  emitRunSummary,
  readBeadsWorkflowState,
  refreshExternalObservation,
} = proxyActivities({
  startToCloseTimeout: '1 minute',
});

const humanApprovalSignal = defineSignal('human_approval');
const externalObservationChangedSignal = defineSignal('external_observation_changed');
const manualResumeSignal = defineSignal('manual_resume');

function nowIso() {
  return new Date(Date.now()).toISOString();
}

async function runStep4WorkflowLoop(input) {
  const wakeups = {
    human: 0,
    external: 0,
  };

  setHandler(humanApprovalSignal, () => {
    wakeups.human += 1;
  });
  setHandler(manualResumeSignal, () => {
    wakeups.human += 1;
  });
  setHandler(externalObservationChangedSignal, () => {
    wakeups.external += 1;
  });

  while (true) {
    const workflowState = await readBeadsWorkflowState({
      beadsId: input.beadsTarget.beadsId,
      runId: input.runId,
      taskDefinitionId: input.taskDefinitionId,
      scheduleId: input.scheduleId,
    });

    const artifact = buildStep4ReviewArtifact({
      input,
      workflowState,
      endedAt: nowIso(),
    });
    const { summaryRef } = await emitRunSummary(artifact);

    if (workflowState.kind === 'complete') {
      return buildTerminalWorkflowResult({
        runId: input.runId,
        beadsId: input.beadsTarget.beadsId,
        terminalStatus: 'completed',
        summaryRef,
      });
    }

    if (workflowState.kind === 'sleep_until') {
      const durationMs = Date.parse(workflowState.sleepUntil) - Date.now();
      if (durationMs > 0) {
        await sleep(durationMs);
      }
      continue;
    }

    if (workflowState.kind === 'await_human_approval') {
      await condition(() => wakeups.human > 0);
      wakeups.human = 0;
      continue;
    }

    await condition(() => wakeups.external > 0);
    wakeups.external = 0;
    await refreshExternalObservation({
      beadsId: input.beadsTarget.beadsId,
      runId: input.runId,
      taskDefinitionId: input.taskDefinitionId,
      scheduleId: input.scheduleId,
      observedAt: nowIso(),
    });
  }
}

async function issueWorkflow(rawInput) {
  const input = validateIssueWorkflowInput(rawInput);

  if (input.runtimeSkeleton === undefined) {
    return runStep4WorkflowLoop(input);
  }

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
  externalObservationChangedSignal,
  humanApprovalSignal,
  issueWorkflow,
  manualResumeSignal,
};
