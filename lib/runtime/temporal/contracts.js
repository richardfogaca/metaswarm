'use strict';

const WORKFLOW_TRIGGER_TYPES = new Set(['ad_hoc', 'scheduled_once', 'recurring', 'resume_signal']);
const WORKFLOW_INITIATORS = new Set(['operator', 'schedule', 'signal']);
const WORKFLOW_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const REVIEW_ARTIFACT_STATUSES = new Set(['completed', 'sleeping', 'blocked', 'failed', 'cancelled']);
const RUNTIME_SKELETON_MODES = new Set(['complete', 'sleep_until']);
const STEP4_WORKFLOW_STATE_KINDS = new Set([
  'complete',
  'sleep_until',
  'await_human_approval',
  'await_external_observation',
]);

function assertRecord(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function assertEnum(value, acceptedValues, fieldName) {
  if (!acceptedValues.has(value)) {
    throw new TypeError(`${fieldName} must be one of: ${Array.from(acceptedValues).join(', ')}`);
  }
}

function assertIsoTimestamp(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }
}

function assertStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${fieldName} must be an array of strings`);
  }
}

function assertOptionalString(value, fieldName) {
  if (value !== undefined && value !== null) {
    assertNonEmptyString(value, fieldName);
  }
}

function normalizeValidationSummary(summary) {
  const value = summary ?? {
    testsRun: [],
    checksRun: [],
    passes: [],
    failures: [],
    warnings: [],
  };

  assertRecord(value, 'validationSummary');
  assertStringArray(value.testsRun ?? [], 'validationSummary.testsRun');
  assertStringArray(value.checksRun ?? [], 'validationSummary.checksRun');
  assertStringArray(value.passes ?? [], 'validationSummary.passes');
  assertStringArray(value.failures ?? [], 'validationSummary.failures');
  assertStringArray(value.warnings ?? [], 'validationSummary.warnings');

  return {
    testsRun: value.testsRun ?? [],
    checksRun: value.checksRun ?? [],
    passes: value.passes ?? [],
    failures: value.failures ?? [],
    warnings: value.warnings ?? [],
  };
}

function validateIssueWorkflowInput(input) {
  assertRecord(input, 'input');

  if (input.version !== 1) {
    throw new TypeError('input.version must be 1');
  }

  assertNonEmptyString(input.runId, 'input.runId');
  assertEnum(input.triggerType, WORKFLOW_TRIGGER_TYPES, 'input.triggerType');
  assertIsoTimestamp(input.initiatedAt, 'input.initiatedAt');
  assertEnum(input.initiatedBy, WORKFLOW_INITIATORS, 'input.initiatedBy');
  assertRecord(input.beadsTarget, 'input.beadsTarget');

  if (input.beadsTarget.kind !== 'existing') {
    throw new TypeError('Step 1 only supports beadsTarget.kind = existing');
  }

  assertNonEmptyString(input.beadsTarget.beadsId, 'input.beadsTarget.beadsId');

  if (input.runtimeSkeleton !== undefined) {
    assertRecord(input.runtimeSkeleton, 'input.runtimeSkeleton');
    assertEnum(input.runtimeSkeleton.mode, RUNTIME_SKELETON_MODES, 'input.runtimeSkeleton.mode');

    if (input.runtimeSkeleton.mode === 'sleep_until') {
      assertIsoTimestamp(input.runtimeSkeleton.sleepUntil, 'input.runtimeSkeleton.sleepUntil');
      if (Date.parse(input.runtimeSkeleton.sleepUntil) <= Date.parse(input.initiatedAt)) {
        throw new TypeError('input.runtimeSkeleton.sleepUntil must be later than initiatedAt');
      }
    }

    if (input.runtimeSkeleton.reason !== undefined) {
      assertNonEmptyString(input.runtimeSkeleton.reason, 'input.runtimeSkeleton.reason');
    }
  }

  if (input.taskDefinitionId !== undefined) {
    assertNonEmptyString(input.taskDefinitionId, 'input.taskDefinitionId');
  }

  if (input.scheduleId !== undefined) {
    assertNonEmptyString(input.scheduleId, 'input.scheduleId');
  }

  return {
    version: 1,
    runId: input.runId,
    triggerType: input.triggerType,
    taskDefinitionId: input.taskDefinitionId,
    scheduleId: input.scheduleId,
    beadsTarget: {
      kind: 'existing',
      beadsId: input.beadsTarget.beadsId,
    },
    initiatedAt: input.initiatedAt,
    initiatedBy: input.initiatedBy,
    runtimeSkeleton:
      input.runtimeSkeleton === undefined
        ? undefined
        : {
            mode: input.runtimeSkeleton.mode,
            sleepUntil: input.runtimeSkeleton.sleepUntil,
            reason: input.runtimeSkeleton.reason,
          },
  };
}

function validateStep4WorkflowState(workflowState) {
  assertRecord(workflowState, 'workflowState');

  if (workflowState.version !== 1) {
    throw new TypeError('workflowState.version must be 1');
  }

  assertEnum(workflowState.kind, STEP4_WORKFLOW_STATE_KINDS, 'workflowState.kind');
  assertIsoTimestamp(workflowState.lastUpdatedAt, 'workflowState.lastUpdatedAt');

  if (workflowState.kind === 'sleep_until') {
    assertIsoTimestamp(workflowState.sleepUntil, 'workflowState.sleepUntil');
  }

  if (workflowState.blockers !== undefined) {
    assertStringArray(workflowState.blockers, 'workflowState.blockers');
  }

  if (workflowState.stepsAttempted !== undefined) {
    assertStringArray(workflowState.stepsAttempted, 'workflowState.stepsAttempted');
  }

  if (workflowState.acceptedChanges !== undefined) {
    assertStringArray(workflowState.acceptedChanges, 'workflowState.acceptedChanges');
  }

  assertOptionalString(workflowState.humanActionRequired, 'workflowState.humanActionRequired');

  return {
    version: 1,
    kind: workflowState.kind,
    sleepUntil: workflowState.sleepUntil,
    blockers: workflowState.blockers,
    humanActionRequired: workflowState.humanActionRequired ?? null,
    stepsAttempted: workflowState.stepsAttempted,
    acceptedChanges: workflowState.acceptedChanges,
    validationSummary:
      workflowState.validationSummary === undefined
        ? undefined
        : normalizeValidationSummary(workflowState.validationSummary),
    lastUpdatedAt: workflowState.lastUpdatedAt,
  };
}

function validateIssueWorkflowResult(result) {
  assertRecord(result, 'result');

  if (result.version !== 1) {
    throw new TypeError('result.version must be 1');
  }

  assertNonEmptyString(result.runId, 'result.runId');
  assertNonEmptyString(result.beadsId, 'result.beadsId');
  assertEnum(result.terminalStatus, WORKFLOW_TERMINAL_STATUSES, 'result.terminalStatus');
  assertNonEmptyString(result.summaryRef, 'result.summaryRef');

  return {
    version: 1,
    runId: result.runId,
    beadsId: result.beadsId,
    terminalStatus: result.terminalStatus,
    summaryRef: result.summaryRef,
  };
}

function validateMorningReviewArtifact(artifact) {
  assertRecord(artifact, 'artifact');

  if (artifact.version !== 1) {
    throw new TypeError('artifact.version must be 1');
  }

  assertNonEmptyString(artifact.runId, 'artifact.runId');
  assertNonEmptyString(artifact.beadsId, 'artifact.beadsId');
  assertEnum(artifact.triggerType, WORKFLOW_TRIGGER_TYPES, 'artifact.triggerType');
  assertEnum(artifact.runtimeStatus, REVIEW_ARTIFACT_STATUSES, 'artifact.runtimeStatus');
  assertIsoTimestamp(artifact.startedAt, 'artifact.startedAt');
  assertIsoTimestamp(artifact.endedAt, 'artifact.endedAt');
  assertStringArray(artifact.stepsAttempted, 'artifact.stepsAttempted');
  assertStringArray(artifact.acceptedChanges, 'artifact.acceptedChanges');
  assertStringArray(artifact.blockers, 'artifact.blockers');

  if (artifact.humanActionRequired !== null && artifact.humanActionRequired !== undefined) {
    assertNonEmptyString(artifact.humanActionRequired, 'artifact.humanActionRequired');
  }

  const validationSummary = normalizeValidationSummary(artifact.validationSummary);

  return {
    version: 1,
    runId: artifact.runId,
    beadsId: artifact.beadsId,
    taskDefinitionId: artifact.taskDefinitionId,
    scheduleId: artifact.scheduleId,
    triggerType: artifact.triggerType,
    runtimeStatus: artifact.runtimeStatus,
    startedAt: artifact.startedAt,
    endedAt: artifact.endedAt,
    stepsAttempted: artifact.stepsAttempted,
    acceptedChanges: artifact.acceptedChanges,
    validationSummary,
    blockers: artifact.blockers,
    humanActionRequired: artifact.humanActionRequired ?? null,
  };
}

function buildStep1ReviewArtifact({
  input,
  runtimeStatus,
  endedAt,
  blockers,
  humanActionRequired,
  acceptedChanges = [],
  stepsAttempted = ['runtime-skeleton'],
  validationSummary,
}) {
  const normalizedInput = validateIssueWorkflowInput(input);

  return validateMorningReviewArtifact({
    version: 1,
    runId: normalizedInput.runId,
    beadsId: normalizedInput.beadsTarget.beadsId,
    taskDefinitionId: normalizedInput.taskDefinitionId,
    scheduleId: normalizedInput.scheduleId,
    triggerType: normalizedInput.triggerType,
    runtimeStatus,
    startedAt: normalizedInput.initiatedAt,
    endedAt,
    stepsAttempted,
    acceptedChanges,
    validationSummary,
    blockers,
    humanActionRequired,
  });
}

function buildStep4ReviewArtifact({ input, workflowState, endedAt }) {
  const normalizedInput = validateIssueWorkflowInput(input);
  const normalizedState = validateStep4WorkflowState(workflowState);

  let runtimeStatus = 'blocked';
  let blockers = normalizedState.blockers;
  let humanActionRequired = normalizedState.humanActionRequired;

  if (normalizedState.kind === 'complete') {
    runtimeStatus = 'completed';
    blockers = [];
    humanActionRequired = null;
  } else if (normalizedState.kind === 'sleep_until') {
    runtimeStatus = 'sleeping';
    blockers = blockers ?? ['Waiting for timer wakeup'];
    humanActionRequired = null;
  } else if (normalizedState.kind === 'await_human_approval') {
    blockers = blockers ?? ['Waiting for human approval'];
    humanActionRequired = humanActionRequired ?? 'Human approval required';
  } else if (normalizedState.kind === 'await_external_observation') {
    blockers = blockers ?? ['Waiting for external observation'];
    humanActionRequired = null;
  }

  return validateMorningReviewArtifact({
    version: 1,
    runId: normalizedInput.runId,
    beadsId: normalizedInput.beadsTarget.beadsId,
    taskDefinitionId: normalizedInput.taskDefinitionId,
    scheduleId: normalizedInput.scheduleId,
    triggerType: normalizedInput.triggerType,
    runtimeStatus,
    startedAt: normalizedInput.initiatedAt,
    endedAt,
    stepsAttempted: normalizedState.stepsAttempted ?? ['workflow-state-reconciliation'],
    acceptedChanges: normalizedState.acceptedChanges ?? [],
    validationSummary: normalizedState.validationSummary,
    blockers,
    humanActionRequired,
  });
}

function buildTerminalWorkflowResult({ runId, beadsId, terminalStatus, summaryRef }) {
  return validateIssueWorkflowResult({
    version: 1,
    runId,
    beadsId,
    terminalStatus,
    summaryRef,
  });
}

module.exports = {
  buildStep1ReviewArtifact,
  buildStep4ReviewArtifact,
  buildTerminalWorkflowResult,
  normalizeValidationSummary,
  validateStep4WorkflowState,
  validateIssueWorkflowInput,
  validateIssueWorkflowResult,
  validateMorningReviewArtifact,
};
