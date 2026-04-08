'use strict';

const fs = require('fs');
const path = require('path');

const { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } = require('@temporalio/common');

const { resolveRuntimePaths, toScheduledWorkflowId } = require('./bootstrap');
const { prepareLaunch, startPreparedLaunch } = require('./launch');
const { loadTaskDefinition } = require('./task-definitions');

const SCHEDULE_STATES = new Set(['active', 'paused']);
const OVERLAP_POLICIES = new Set(['skip', 'allow_parallel']);
const CATCHUP_POLICIES = new Set(['none', 'within_window']);

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

function assertSafeIdentifier(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (value.includes('/') || value.includes('\\')) {
    throw new TypeError(`${fieldName} must not contain path separators`);
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

function validateScheduleDefinition(scheduleDefinition) {
  assertRecord(scheduleDefinition, 'scheduleDefinition');

  if (scheduleDefinition.version !== 1) {
    throw new TypeError('scheduleDefinition.version must be 1');
  }

  assertSafeIdentifier(scheduleDefinition.scheduleId, 'scheduleDefinition.scheduleId');
  assertSafeIdentifier(scheduleDefinition.taskDefinitionId, 'scheduleDefinition.taskDefinitionId');
  assertEnum(scheduleDefinition.state, SCHEDULE_STATES, 'scheduleDefinition.state');
  assertEnum(
    scheduleDefinition.overlapPolicy,
    OVERLAP_POLICIES,
    'scheduleDefinition.overlapPolicy'
  );
  assertEnum(
    scheduleDefinition.catchupPolicy,
    CATCHUP_POLICIES,
    'scheduleDefinition.catchupPolicy'
  );

  if (scheduleDefinition.overlapPolicy !== 'skip') {
    throw new TypeError('Step 3 restricted profile only supports overlapPolicy = skip');
  }

  if (scheduleDefinition.catchupPolicy !== 'none') {
    throw new TypeError('Step 3 restricted profile only supports catchupPolicy = none');
  }

  assertRecord(scheduleDefinition.trigger, 'scheduleDefinition.trigger');
  if (scheduleDefinition.trigger.kind !== 'once') {
    throw new TypeError('Step 3 restricted profile only supports trigger.kind = once');
  }
  assertIsoTimestamp(scheduleDefinition.trigger.startAt, 'scheduleDefinition.trigger.startAt');

  if (scheduleDefinition.catchupWindowMinutes !== undefined) {
    throw new TypeError('catchupWindowMinutes is not supported in the Step 3 restricted profile');
  }

  if (scheduleDefinition.timezone !== undefined) {
    assertNonEmptyString(scheduleDefinition.timezone, 'scheduleDefinition.timezone');
  }

  return {
    version: 1,
    scheduleId: scheduleDefinition.scheduleId,
    taskDefinitionId: scheduleDefinition.taskDefinitionId,
    state: scheduleDefinition.state,
    trigger: {
      kind: 'once',
      startAt: scheduleDefinition.trigger.startAt,
    },
    overlapPolicy: 'skip',
    catchupPolicy: 'none',
    timezone: scheduleDefinition.timezone,
    metadata: scheduleDefinition.metadata,
  };
}

function loadScheduleDefinition({ repoRoot = process.cwd(), scheduleId }) {
  assertSafeIdentifier(scheduleId, 'scheduleId');

  const { schedulesDir } = resolveRuntimePaths(repoRoot);
  const filePath = path.join(schedulesDir, `${scheduleId}.json`);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Schedule definition not found: ${scheduleId}`);
    }

    throw new Error(`Schedule definition ${scheduleId} must contain valid JSON`);
  }

  const scheduleDefinition = validateScheduleDefinition(parsed);
  if (scheduleDefinition.scheduleId !== scheduleId) {
    throw new Error('scheduleId must match the file name');
  }

  return {
    filePath,
    scheduleDefinition,
  };
}

function normalizeScheduledRunId(scheduleId, startAt) {
  return `${scheduleId}-${startAt.replace(/[-:.]/g, '')}`;
}

async function prepareScheduledLaunch({
  repoRoot = process.cwd(),
  scheduleId,
  now,
  runtimeSkeleton,
} = {}) {
  assertIsoTimestamp(now, 'now');

  const { scheduleDefinition } = loadScheduleDefinition({
    repoRoot,
    scheduleId,
  });

  if (scheduleDefinition.state !== 'active') {
    throw new Error(`Schedule ${scheduleDefinition.scheduleId} is paused`);
  }

  const { taskDefinition } = loadTaskDefinition({
    repoRoot,
    taskDefinitionId: scheduleDefinition.taskDefinitionId,
  });

  if (taskDefinition.mode !== 'scheduled_once') {
    throw new Error('Step 3 delayed schedules must reference task definitions with mode = scheduled_once');
  }

  if (taskDefinition.materialization.kind !== 'existing_beads_issue') {
    throw new Error('Step 3 delayed schedules currently require a task definition that targets an existing BEADS issue');
  }

  const startDelayMs = Date.parse(scheduleDefinition.trigger.startAt) - Date.parse(now);
  if (startDelayMs <= 0) {
    throw new Error('Step 3 delayed schedules must have trigger.startAt later than registration time');
  }

  const runId = normalizeScheduledRunId(scheduleDefinition.scheduleId, scheduleDefinition.trigger.startAt);
  const preparedLaunch = await prepareLaunch({
    repoRoot,
    taskDefinition,
    triggerType: 'scheduled_once',
    scheduleId: scheduleDefinition.scheduleId,
    initiatedAt: now,
    initiatedBy: 'schedule',
    runId,
    runtimeSkeleton,
    runtimeStart: {
      mode: 'delayed_once',
      startDelayMs,
      scheduledFor: scheduleDefinition.trigger.startAt,
    },
  });

  return {
    scheduleDefinition,
    ...preparedLaunch,
  };
}

async function launchScheduledTask({
  repoRoot = process.cwd(),
  scheduleId,
  now,
  client,
  taskQueue,
} = {}) {
  const preparedLaunch = await prepareScheduledLaunch({
    repoRoot,
    scheduleId,
    now,
  });

  const handle = await startPreparedLaunch({
    preparedLaunch,
    client,
    taskQueue,
    workflowId: toScheduledWorkflowId(
      preparedLaunch.workflowInput.beadsTarget.beadsId,
      preparedLaunch.scheduleDefinition.scheduleId
    ),
    workflowStartOverrides: {
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    },
  });

  return {
    ...preparedLaunch,
    handle,
  };
}

module.exports = {
  launchScheduledTask,
  loadScheduleDefinition,
  prepareScheduledLaunch,
  validateScheduleDefinition,
};
