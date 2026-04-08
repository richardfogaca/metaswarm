'use strict';

const fs = require('fs');
const path = require('path');

const { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } = require('@temporalio/common');

const {
  DEFAULT_TEMPORAL_TASK_QUEUE,
  resolveRuntimePaths,
  toRecurringWorkflowId,
  toScheduleWorkflowId,
  toScheduledWorkflowId,
} = require('./bootstrap');
const { prepareLaunch, startPreparedLaunch } = require('./launch');
const { loadTaskDefinition } = require('./task-definitions');
const {
  computeRecurringScheduleTick,
  normalizeRecurringOccurrenceKey,
} = require('./recurring-cadence');
const { validateRecurringScheduleWorkflowInput } = require('./schedule-workflow-contracts');

const SCHEDULE_STATES = new Set(['active', 'paused']);
const OVERLAP_POLICIES = new Set(['skip', 'allow_parallel']);
const CATCHUP_POLICIES = new Set(['none', 'within_window']);
const CADENCE_KINDS = new Set(['daily', 'weekly', 'monthly', 'cron']);
const DAY_OF_WEEK_VALUES = new Set([
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
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

function assertIntegerInRange(value, fieldName, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
}

function normalizeTimezone(timezone, { required = false } = {}) {
  if (timezone === undefined) {
    if (required) {
      throw new TypeError('scheduleDefinition.timezone is required');
    }
    return 'UTC';
  }

  assertNonEmptyString(timezone, 'scheduleDefinition.timezone');

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
    }).format(new Date('2026-01-01T00:00:00.000Z'));
  } catch (error) {
    throw new TypeError('scheduleDefinition.timezone must be a valid IANA timezone');
  }

  return timezone;
}

function normalizeRecurringCadence(cadence) {
  assertRecord(cadence, 'scheduleDefinition.trigger.cadence');
  assertEnum(cadence.kind, CADENCE_KINDS, 'scheduleDefinition.trigger.cadence.kind');

  switch (cadence.kind) {
    case 'daily':
      assertIntegerInRange(cadence.hour, 'scheduleDefinition.trigger.cadence.hour', 0, 23);
      assertIntegerInRange(cadence.minute, 'scheduleDefinition.trigger.cadence.minute', 0, 59);
      return {
        kind: 'daily',
        hour: cadence.hour,
        minute: cadence.minute,
      };
    case 'weekly':
      assertEnum(
        cadence.dayOfWeek,
        DAY_OF_WEEK_VALUES,
        'scheduleDefinition.trigger.cadence.dayOfWeek'
      );
      assertIntegerInRange(cadence.hour, 'scheduleDefinition.trigger.cadence.hour', 0, 23);
      assertIntegerInRange(cadence.minute, 'scheduleDefinition.trigger.cadence.minute', 0, 59);
      return {
        kind: 'weekly',
        dayOfWeek: cadence.dayOfWeek,
        hour: cadence.hour,
        minute: cadence.minute,
      };
    case 'monthly':
      assertIntegerInRange(
        cadence.dayOfMonth,
        'scheduleDefinition.trigger.cadence.dayOfMonth',
        1,
        31
      );
      assertIntegerInRange(cadence.hour, 'scheduleDefinition.trigger.cadence.hour', 0, 23);
      assertIntegerInRange(cadence.minute, 'scheduleDefinition.trigger.cadence.minute', 0, 59);
      return {
        kind: 'monthly',
        dayOfMonth: cadence.dayOfMonth,
        hour: cadence.hour,
        minute: cadence.minute,
      };
    case 'cron':
      assertNonEmptyString(cadence.expression, 'scheduleDefinition.trigger.cadence.expression');
      return {
        kind: 'cron',
        expression: cadence.expression,
      };
    default:
      throw new TypeError(`Unsupported cadence kind: ${cadence.kind}`);
  }
}

function normalizeOnceScheduleDefinition(scheduleDefinition) {
  if (scheduleDefinition.overlapPolicy !== 'skip') {
    throw new TypeError('Step 3 restricted profile only supports overlapPolicy = skip');
  }

  if (scheduleDefinition.catchupPolicy !== 'none') {
    throw new TypeError('Step 3 restricted profile only supports catchupPolicy = none');
  }

  assertIsoTimestamp(scheduleDefinition.trigger.startAt, 'scheduleDefinition.trigger.startAt');

  if (scheduleDefinition.catchupWindowMinutes !== undefined) {
    throw new TypeError('catchupWindowMinutes is not supported in the Step 3 restricted profile');
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
    timezone:
      scheduleDefinition.timezone === undefined
        ? undefined
        : normalizeTimezone(scheduleDefinition.timezone),
    metadata: scheduleDefinition.metadata,
  };
}

function normalizeRecurringScheduleDefinition(scheduleDefinition) {
  const timezone = normalizeTimezone(scheduleDefinition.timezone);

  if (scheduleDefinition.catchupPolicy === 'within_window') {
    assertIntegerInRange(
      scheduleDefinition.catchupWindowMinutes,
      'scheduleDefinition.catchupWindowMinutes',
      1,
      1440
    );
  } else if (scheduleDefinition.catchupWindowMinutes !== undefined) {
    throw new TypeError('catchupWindowMinutes is only valid for catchupPolicy = within_window');
  }

  return {
    version: 1,
    scheduleId: scheduleDefinition.scheduleId,
    taskDefinitionId: scheduleDefinition.taskDefinitionId,
    state: scheduleDefinition.state,
    trigger: {
      kind: 'recurring',
      cadence: normalizeRecurringCadence(scheduleDefinition.trigger.cadence),
    },
    overlapPolicy: scheduleDefinition.overlapPolicy,
    catchupPolicy: scheduleDefinition.catchupPolicy,
    catchupWindowMinutes: scheduleDefinition.catchupWindowMinutes,
    timezone,
    metadata: scheduleDefinition.metadata,
  };
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

  assertRecord(scheduleDefinition.trigger, 'scheduleDefinition.trigger');
  if (scheduleDefinition.trigger.kind === 'once') {
    return normalizeOnceScheduleDefinition(scheduleDefinition);
  }
  if (scheduleDefinition.trigger.kind === 'recurring') {
    return normalizeRecurringScheduleDefinition(scheduleDefinition);
  }

  throw new TypeError('scheduleDefinition.trigger.kind must be once or recurring');
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

function normalizeRecurringRunId(scheduleId, scheduledFor) {
  return `${scheduleId}-${normalizeRecurringOccurrenceKey(scheduledFor)}`;
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

  if (scheduleDefinition.trigger.kind !== 'once') {
    throw new Error('Step 3 delayed schedules require trigger.kind = once');
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

async function prepareRecurringLaunch({
  repoRoot = process.cwd(),
  scheduleId,
  scheduledFor,
  initiatedAt,
  runtimeSkeleton,
  createBeadsIssue,
} = {}) {
  assertIsoTimestamp(scheduledFor, 'scheduledFor');
  assertIsoTimestamp(initiatedAt, 'initiatedAt');

  const { scheduleDefinition } = loadScheduleDefinition({ repoRoot, scheduleId });
  if (scheduleDefinition.state !== 'active') {
    throw new Error(`Schedule ${scheduleDefinition.scheduleId} is paused`);
  }
  if (scheduleDefinition.trigger.kind !== 'recurring') {
    throw new Error('Recurring launch preparation requires trigger.kind = recurring');
  }

  const { taskDefinition } = loadTaskDefinition({
    repoRoot,
    taskDefinitionId: scheduleDefinition.taskDefinitionId,
  });
  if (taskDefinition.mode !== 'recurring') {
    throw new Error('Recurring schedules must reference task definitions with mode = recurring');
  }

  const occurrenceKey = normalizeRecurringOccurrenceKey(scheduledFor);
  const runId = normalizeRecurringRunId(scheduleDefinition.scheduleId, scheduledFor);
  const preparedLaunch = await prepareLaunch({
    repoRoot,
    taskDefinition,
    triggerType: 'recurring',
    scheduleId: scheduleDefinition.scheduleId,
    initiatedAt,
    initiatedBy: 'schedule',
    runId,
    runtimeSkeleton,
    runtimeStart: {
      mode: 'recurring',
      scheduledFor,
      occurrenceKey,
    },
    materializationContext: {
      scheduledFor,
      timezone: scheduleDefinition.timezone,
    },
    createBeadsIssue,
  });

  return {
    scheduleDefinition,
    occurrenceKey,
    ...preparedLaunch,
  };
}

async function launchRecurringOccurrence({
  repoRoot = process.cwd(),
  scheduleId,
  scheduledFor,
  initiatedAt,
  client,
  taskQueue = DEFAULT_TEMPORAL_TASK_QUEUE,
  runtimeSkeleton,
} = {}) {
  const preparedLaunch = await prepareRecurringLaunch({
    repoRoot,
    scheduleId,
    scheduledFor,
    initiatedAt,
    runtimeSkeleton,
  });

  const handle = await startPreparedLaunch({
    preparedLaunch,
    client,
    taskQueue,
    workflowId: toRecurringWorkflowId(
      preparedLaunch.workflowInput.beadsTarget.beadsId,
      preparedLaunch.scheduleDefinition.scheduleId,
      preparedLaunch.workflowInput.runId
    ),
    workflowStartOverrides: {
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    },
  });

  return {
    ...preparedLaunch,
    handle,
  };
}

async function launchRecurringSchedule({
  repoRoot = process.cwd(),
  scheduleId,
  initiatedAt,
  client,
  taskQueue = DEFAULT_TEMPORAL_TASK_QUEUE,
  runtimeSkeleton,
} = {}) {
  assertIsoTimestamp(initiatedAt, 'initiatedAt');
  const { scheduleDefinition } = loadScheduleDefinition({ repoRoot, scheduleId });
  if (scheduleDefinition.state !== 'active') {
    throw new Error(`Schedule ${scheduleDefinition.scheduleId} is paused`);
  }
  if (scheduleDefinition.trigger.kind !== 'recurring') {
    throw new Error('launchRecurringSchedule requires trigger.kind = recurring');
  }

  const { taskDefinition } = loadTaskDefinition({
    repoRoot,
    taskDefinitionId: scheduleDefinition.taskDefinitionId,
  });
  if (taskDefinition.mode !== 'recurring') {
    throw new Error('Recurring schedules must reference task definitions with mode = recurring');
  }

  return client.workflow.start('recurringScheduleWorkflow', {
    args: [
      validateRecurringScheduleWorkflowInput({
        version: 1,
        scheduleId: scheduleDefinition.scheduleId,
        registeredAt: initiatedAt,
        runtimeSkeleton,
      }),
    ],
    taskQueue,
    workflowId: toScheduleWorkflowId(scheduleDefinition.scheduleId),
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
  });
}

module.exports = {
  computeRecurringScheduleTick,
  launchRecurringOccurrence,
  launchRecurringSchedule,
  launchScheduledTask,
  loadScheduleDefinition,
  normalizeRecurringOccurrenceKey,
  prepareRecurringLaunch,
  prepareScheduledLaunch,
  validateRecurringScheduleWorkflowInput,
  validateScheduleDefinition,
};
