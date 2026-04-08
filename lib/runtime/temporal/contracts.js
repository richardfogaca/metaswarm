'use strict';

const WORKFLOW_TRIGGER_TYPES = new Set(['ad_hoc', 'scheduled_once', 'recurring', 'resume_signal']);
const WORKFLOW_INITIATORS = new Set(['operator', 'schedule', 'signal']);
const WORKFLOW_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const REVIEW_ARTIFACT_STATUSES = new Set(['completed', 'sleeping', 'blocked', 'failed', 'cancelled']);
const RUNTIME_SKELETON_MODES = new Set(['complete', 'sleep_until']);
const WORKFLOW_STATE_KINDS = new Set([
  'complete',
  'sleep_until',
  'await_human_approval',
  'await_external_observation',
  'run_late_stage_action',
  'run_spec_to_plan_action',
]);
const OBSERVATION_KINDS = new Set(['generic', 'ci', 'review_comments', 'pr_shepherd']);
const LATE_STAGE_ACTION_KINDS = new Set(['sync_pr', 'post_pr_comment']);
const SPEC_TO_PLAN_ACTION_KINDS = new Set([
  'research_brief',
  'draft_plan',
  'run_plan_review_gate',
  'run_design_review_gate',
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

function assertSafePathToken(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (value.includes('/') || value.includes('\\')) {
    throw new TypeError(`${fieldName} must not contain path separators`);
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

function validateObservationTarget(observation, fieldName = 'workflowState.observation') {
  assertRecord(observation, fieldName);
  assertEnum(observation.kind, OBSERVATION_KINDS, `${fieldName}.kind`);

  return {
    kind: observation.kind,
  };
}

function validateLateStageAction(action, fieldName = 'workflowState.lateStageAction') {
  assertRecord(action, fieldName);
  assertEnum(action.kind, LATE_STAGE_ACTION_KINDS, `${fieldName}.kind`);
  assertSafePathToken(action.actionKey, `${fieldName}.actionKey`);

  if (action.kind === 'post_pr_comment') {
    assertNonEmptyString(action.commentBody, `${fieldName}.commentBody`);
  } else if (action.commentBody !== undefined) {
    assertNonEmptyString(action.commentBody, `${fieldName}.commentBody`);
  }

  return {
    kind: action.kind,
    actionKey: action.actionKey,
    commentBody: action.commentBody,
  };
}

function validateSpecToPlanAction(action, fieldName = 'workflowState.specToPlanAction') {
  assertRecord(action, fieldName);
  assertEnum(action.kind, SPEC_TO_PLAN_ACTION_KINDS, `${fieldName}.kind`);
  assertSafePathToken(action.actionKey, `${fieldName}.actionKey`);
  assertSafePathToken(action.artifactKey, `${fieldName}.artifactKey`);

  if (action.sourceArtifactKey !== undefined) {
    assertSafePathToken(action.sourceArtifactKey, `${fieldName}.sourceArtifactKey`);
  }

  if (action.instructions !== undefined) {
    assertNonEmptyString(action.instructions, `${fieldName}.instructions`);
  }

  return {
    kind: action.kind,
    actionKey: action.actionKey,
    artifactKey: action.artifactKey,
    sourceArtifactKey: action.sourceArtifactKey,
    instructions: action.instructions,
  };
}

function validateStep5WorkflowState(workflowState) {
  assertRecord(workflowState, 'workflowState');

  if (workflowState.version !== 1) {
    throw new TypeError('workflowState.version must be 1');
  }

  assertEnum(workflowState.kind, WORKFLOW_STATE_KINDS, 'workflowState.kind');
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

  if (workflowState.observation !== undefined) {
    validateObservationTarget(workflowState.observation);
  }

  if (workflowState.kind === 'run_late_stage_action') {
    if (workflowState.lateStageAction === undefined) {
      throw new TypeError('workflowState.lateStageAction is required for run_late_stage_action');
    }
  }

  if (workflowState.kind === 'run_spec_to_plan_action') {
    if (workflowState.specToPlanAction === undefined) {
      throw new TypeError('workflowState.specToPlanAction is required for run_spec_to_plan_action');
    }
  }

  if (workflowState.lateStageAction !== undefined) {
    validateLateStageAction(workflowState.lateStageAction);
  }

  if (workflowState.specToPlanAction !== undefined) {
    validateSpecToPlanAction(workflowState.specToPlanAction);
  }

  return {
    version: 1,
    kind: workflowState.kind,
    sleepUntil: workflowState.sleepUntil,
    blockers: workflowState.blockers,
    humanActionRequired: workflowState.humanActionRequired ?? null,
    observation:
      workflowState.observation === undefined
        ? undefined
        : validateObservationTarget(workflowState.observation),
    lateStageAction:
      workflowState.lateStageAction === undefined
        ? undefined
        : validateLateStageAction(workflowState.lateStageAction),
    specToPlanAction:
      workflowState.specToPlanAction === undefined
        ? undefined
        : validateSpecToPlanAction(workflowState.specToPlanAction),
    stepsAttempted: workflowState.stepsAttempted,
    acceptedChanges: workflowState.acceptedChanges,
    validationSummary:
      workflowState.validationSummary === undefined
        ? undefined
        : normalizeValidationSummary(workflowState.validationSummary),
    lastUpdatedAt: workflowState.lastUpdatedAt,
  };
}

function validateStep4WorkflowState(workflowState) {
  return validateStep5WorkflowState(workflowState);
}

function validateStep6WorkflowState(workflowState) {
  return validateStep5WorkflowState(workflowState);
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
  const normalizedState = validateStep5WorkflowState(workflowState);

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
  } else if (normalizedState.kind === 'run_late_stage_action') {
    blockers = blockers ?? ['Running late-stage action'];
    humanActionRequired = null;
  } else if (normalizedState.kind === 'run_spec_to_plan_action') {
    blockers = blockers ?? ['Running spec-to-plan action'];
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
  validateLateStageAction,
  validateObservationTarget,
  validateStep4WorkflowState,
  validateStep5WorkflowState,
  validateSpecToPlanAction,
  validateStep6WorkflowState,
  validateIssueWorkflowInput,
  validateIssueWorkflowResult,
  validateMorningReviewArtifact,
};
