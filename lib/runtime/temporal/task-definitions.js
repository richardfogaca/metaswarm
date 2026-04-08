'use strict';

const fs = require('fs');
const path = require('path');

const { resolveRuntimePaths } = require('./bootstrap');
const { validateIssueWorkflowInput } = require('./contracts');

const TASK_DEFINITION_MODES = new Set(['ad_hoc', 'scheduled_once', 'recurring']);
const BEADS_ISSUE_TYPES = new Set(['bug', 'feature', 'task', 'epic', 'chore', 'decision']);
const TASK_MATERIALIZATION_KINDS = new Set(['existing_beads_issue', 'create_beads_issue']);
const LAUNCH_TRIGGER_TYPES = new Set(['ad_hoc', 'scheduled_once', 'recurring']);
const LAUNCH_INITIATORS = new Set(['operator', 'schedule']);
const RUNTIME_START_MODES = new Set(['immediate', 'delayed_once']);
const TITLE_TOKEN_PATTERN = /\{(run_id|task_definition_id|yyyy|mm|dd)\}/g;

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

function assertOptionalString(value, fieldName) {
  if (value !== undefined) {
    assertNonEmptyString(value, fieldName);
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

function assertBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${fieldName} must be a boolean`);
  }
}

function assertFiniteNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }
}

function assertStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new TypeError(`${fieldName} must be an array of non-empty strings`);
  }
}

function assertSafeIdentifier(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (value.includes('/') || value.includes('\\')) {
    throw new TypeError(`${fieldName} must not contain path separators`);
  }
}

function assertIntegerInRange(value, fieldName, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
}

function normalizeRuntimePolicy(runtimePolicy) {
  if (runtimePolicy === undefined) {
    return undefined;
  }

  assertRecord(runtimePolicy, 'taskDefinition.runtimePolicy');

  if (runtimePolicy.maxRuntimeHours !== undefined) {
    assertIntegerInRange(runtimePolicy.maxRuntimeHours, 'taskDefinition.runtimePolicy.maxRuntimeHours', 1, 168);
  }

  if (runtimePolicy.maxRetryAttempts !== undefined) {
    assertIntegerInRange(
      runtimePolicy.maxRetryAttempts,
      'taskDefinition.runtimePolicy.maxRetryAttempts',
      0,
      100
    );
  }

  if (runtimePolicy.allowOvernight !== undefined) {
    assertBoolean(runtimePolicy.allowOvernight, 'taskDefinition.runtimePolicy.allowOvernight');
  }

  if (runtimePolicy.summaryRequired !== undefined) {
    assertBoolean(runtimePolicy.summaryRequired, 'taskDefinition.runtimePolicy.summaryRequired');
  }

  return {
    maxRuntimeHours: runtimePolicy.maxRuntimeHours,
    maxRetryAttempts: runtimePolicy.maxRetryAttempts,
    allowOvernight: runtimePolicy.allowOvernight,
    summaryRequired: runtimePolicy.summaryRequired,
  };
}

function normalizeTaskMaterialization(materialization) {
  assertRecord(materialization, 'taskDefinition.materialization');
  assertEnum(
    materialization.kind,
    TASK_MATERIALIZATION_KINDS,
    'taskDefinition.materialization.kind'
  );

  if (materialization.kind === 'existing_beads_issue') {
    assertNonEmptyString(materialization.beadsId, 'taskDefinition.materialization.beadsId');
    return {
      kind: 'existing_beads_issue',
      beadsId: materialization.beadsId,
    };
  }

  assertEnum(
    materialization.issueType,
    BEADS_ISSUE_TYPES,
    'taskDefinition.materialization.issueType'
  );
  assertNonEmptyString(
    materialization.titleTemplate,
    'taskDefinition.materialization.titleTemplate'
  );

  if (materialization.descriptionTemplateRef !== undefined) {
    assertNonEmptyString(
      materialization.descriptionTemplateRef,
      'taskDefinition.materialization.descriptionTemplateRef'
    );
  }

  if (materialization.labels !== undefined) {
    assertStringArray(materialization.labels, 'taskDefinition.materialization.labels');
  }

  if (materialization.priority !== undefined) {
    assertIntegerInRange(materialization.priority, 'taskDefinition.materialization.priority', 0, 4);
  }

  if (materialization.parentBeadsId !== undefined) {
    assertNonEmptyString(materialization.parentBeadsId, 'taskDefinition.materialization.parentBeadsId');
  }

  return {
    kind: 'create_beads_issue',
    issueType: materialization.issueType,
    titleTemplate: materialization.titleTemplate,
    descriptionTemplateRef: materialization.descriptionTemplateRef,
    labels: materialization.labels ?? [],
    priority: materialization.priority,
    parentBeadsId: materialization.parentBeadsId,
  };
}

function validateTaskDefinition(taskDefinition) {
  assertRecord(taskDefinition, 'taskDefinition');

  if (taskDefinition.version !== 1) {
    throw new TypeError('taskDefinition.version must be 1');
  }

  assertSafeIdentifier(taskDefinition.taskDefinitionId, 'taskDefinition.taskDefinitionId');
  assertNonEmptyString(taskDefinition.name, 'taskDefinition.name');
  assertEnum(taskDefinition.mode, TASK_DEFINITION_MODES, 'taskDefinition.mode');

  return {
    version: 1,
    taskDefinitionId: taskDefinition.taskDefinitionId,
    name: taskDefinition.name,
    mode: taskDefinition.mode,
    materialization: normalizeTaskMaterialization(taskDefinition.materialization),
    runtimePolicy: normalizeRuntimePolicy(taskDefinition.runtimePolicy),
    metadata: taskDefinition.metadata,
  };
}

function loadTaskDefinition({ repoRoot = process.cwd(), taskDefinitionId }) {
  assertSafeIdentifier(taskDefinitionId, 'taskDefinitionId');

  const { taskDefinitionsDir } = resolveRuntimePaths(repoRoot);
  const filePath = path.join(taskDefinitionsDir, `${taskDefinitionId}.json`);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Task definition not found: ${taskDefinitionId}`);
    }

    throw new Error(`Task definition ${taskDefinitionId} must contain valid JSON`);
  }

  const taskDefinition = validateTaskDefinition(parsed);
  if (taskDefinition.taskDefinitionId !== taskDefinitionId) {
    throw new Error('taskDefinitionId must match the file name');
  }

  return {
    filePath,
    taskDefinition,
  };
}

function validateAdHocLaunchRequest(request) {
  assertRecord(request, 'request');

  if (request.version !== 1) {
    throw new TypeError('request.version must be 1');
  }

  assertSafeIdentifier(request.taskDefinitionId, 'request.taskDefinitionId');
  assertIsoTimestamp(request.initiatedAt, 'request.initiatedAt');
  if (request.initiatedBy !== 'operator') {
    throw new TypeError('request.initiatedBy must be operator');
  }

  if (request.runId !== undefined) {
    assertSafeIdentifier(request.runId, 'request.runId');
  }

  if (request.runtimeSkeleton !== undefined) {
    assertRecord(request.runtimeSkeleton, 'request.runtimeSkeleton');
  }

  return {
    version: 1,
    taskDefinitionId: request.taskDefinitionId,
    initiatedAt: request.initiatedAt,
    initiatedBy: 'operator',
    runId: request.runId,
    runtimeSkeleton: request.runtimeSkeleton,
  };
}

function normalizeCreateRequest(createRequest) {
  assertRecord(createRequest, 'launchRecord.materialization.createRequest');
  assertEnum(
    createRequest.issueType,
    BEADS_ISSUE_TYPES,
    'launchRecord.materialization.createRequest.issueType'
  );
  assertNonEmptyString(
    createRequest.title,
    'launchRecord.materialization.createRequest.title'
  );

  if (createRequest.description !== undefined) {
    assertNonEmptyString(
      createRequest.description,
      'launchRecord.materialization.createRequest.description'
    );
  }

  if (createRequest.labels !== undefined) {
    assertStringArray(createRequest.labels, 'launchRecord.materialization.createRequest.labels');
  }

  if (createRequest.priority !== undefined) {
    assertIntegerInRange(
      createRequest.priority,
      'launchRecord.materialization.createRequest.priority',
      0,
      4
    );
  }

  if (createRequest.parentBeadsId !== undefined) {
    assertNonEmptyString(
      createRequest.parentBeadsId,
      'launchRecord.materialization.createRequest.parentBeadsId'
    );
  }

  return {
    issueType: createRequest.issueType,
    title: createRequest.title,
    description: createRequest.description,
    labels: createRequest.labels ?? [],
    priority: createRequest.priority,
    parentBeadsId: createRequest.parentBeadsId,
  };
}

function validateLaunchRecord(launchRecord) {
  assertRecord(launchRecord, 'launchRecord');

  if (launchRecord.version !== 1) {
    throw new TypeError('launchRecord.version must be 1');
  }

  assertSafeIdentifier(launchRecord.runId, 'launchRecord.runId');
  assertSafeIdentifier(launchRecord.taskDefinitionId, 'launchRecord.taskDefinitionId');
  assertEnum(launchRecord.triggerType, LAUNCH_TRIGGER_TYPES, 'launchRecord.triggerType');
  assertIsoTimestamp(launchRecord.initiatedAt, 'launchRecord.initiatedAt');
  assertEnum(launchRecord.initiatedBy, LAUNCH_INITIATORS, 'launchRecord.initiatedBy');

  if (launchRecord.scheduleId !== undefined) {
    assertSafeIdentifier(launchRecord.scheduleId, 'launchRecord.scheduleId');
  }

  if (launchRecord.triggerType === 'ad_hoc' && launchRecord.scheduleId !== undefined) {
    throw new TypeError('ad_hoc launch records must not include scheduleId');
  }

  if (launchRecord.triggerType !== 'ad_hoc' && launchRecord.scheduleId === undefined) {
    throw new TypeError('schedule-triggered launch records must include scheduleId');
  }

  assertRecord(launchRecord.materialization, 'launchRecord.materialization');
  assertEnum(
    launchRecord.materialization.sourceKind,
    TASK_MATERIALIZATION_KINDS,
    'launchRecord.materialization.sourceKind'
  );
  assertNonEmptyString(
    launchRecord.materialization.resolvedBeadsId,
    'launchRecord.materialization.resolvedBeadsId'
  );
  assertBoolean(launchRecord.materialization.created, 'launchRecord.materialization.created');

  if (launchRecord.materialization.sourceKind === 'create_beads_issue') {
    if (!launchRecord.materialization.created) {
      throw new TypeError('create_beads_issue launch records must set created=true');
    }
    if (launchRecord.materialization.createRequest === undefined) {
      throw new TypeError('create_beads_issue launch records must include createRequest');
    }
  }

  const createRequest =
    launchRecord.materialization.createRequest === undefined
      ? undefined
      : normalizeCreateRequest(launchRecord.materialization.createRequest);

  if (launchRecord.runtimeStart !== undefined) {
    assertRecord(launchRecord.runtimeStart, 'launchRecord.runtimeStart');
    assertEnum(launchRecord.runtimeStart.mode, RUNTIME_START_MODES, 'launchRecord.runtimeStart.mode');

    if (launchRecord.runtimeStart.startDelayMs !== undefined) {
      assertFiniteNumber(launchRecord.runtimeStart.startDelayMs, 'launchRecord.runtimeStart.startDelayMs');
      if (launchRecord.runtimeStart.startDelayMs < 0) {
        throw new TypeError('launchRecord.runtimeStart.startDelayMs must be >= 0');
      }
    }

    if (launchRecord.runtimeStart.mode === 'delayed_once') {
      assertIsoTimestamp(launchRecord.runtimeStart.scheduledFor, 'launchRecord.runtimeStart.scheduledFor');
    } else if (launchRecord.runtimeStart.scheduledFor !== undefined) {
      throw new TypeError('launchRecord.runtimeStart.scheduledFor is only valid for delayed_once');
    }
  }

  const workflowInput = validateIssueWorkflowInput(launchRecord.workflowInput);
  if (workflowInput.runId !== launchRecord.runId) {
    throw new TypeError('launchRecord.workflowInput.runId must match launchRecord.runId');
  }
  if (workflowInput.taskDefinitionId !== launchRecord.taskDefinitionId) {
    throw new TypeError(
      'launchRecord.workflowInput.taskDefinitionId must match launchRecord.taskDefinitionId'
    );
  }
  if (workflowInput.triggerType !== launchRecord.triggerType) {
    throw new TypeError('launchRecord.workflowInput.triggerType must match launchRecord.triggerType');
  }
  if (workflowInput.initiatedBy !== launchRecord.initiatedBy) {
    throw new TypeError('launchRecord.workflowInput.initiatedBy must match launchRecord.initiatedBy');
  }
  if (workflowInput.scheduleId !== launchRecord.scheduleId) {
    throw new TypeError('launchRecord.workflowInput.scheduleId must match launchRecord.scheduleId');
  }
  if (workflowInput.beadsTarget.beadsId !== launchRecord.materialization.resolvedBeadsId) {
    throw new TypeError(
      'launchRecord.workflowInput.beadsTarget.beadsId must match materialization.resolvedBeadsId'
    );
  }

  return {
    version: 1,
    runId: launchRecord.runId,
    taskDefinitionId: launchRecord.taskDefinitionId,
    triggerType: launchRecord.triggerType,
    scheduleId: launchRecord.scheduleId,
    initiatedAt: launchRecord.initiatedAt,
    initiatedBy: launchRecord.initiatedBy,
    materialization: {
      sourceKind: launchRecord.materialization.sourceKind,
      resolvedBeadsId: launchRecord.materialization.resolvedBeadsId,
      created: launchRecord.materialization.created,
      createRequest,
    },
    runtimeStart: launchRecord.runtimeStart,
    workflowInput,
  };
}

function resolveRepoRelativePath({ repoRoot, relativePath, fieldName }) {
  assertNonEmptyString(relativePath, fieldName);
  if (path.isAbsolute(relativePath)) {
    throw new TypeError(`${fieldName} must be repo-relative`);
  }

  const absolutePath = path.resolve(repoRoot, relativePath);
  const resolvedRepoRoot = path.resolve(repoRoot);
  if (
    absolutePath !== resolvedRepoRoot &&
    !absolutePath.startsWith(`${resolvedRepoRoot}${path.sep}`)
  ) {
    throw new TypeError(`${fieldName} must remain inside the repository`);
  }

  return absolutePath;
}

function buildTemplateContext({ runId, taskDefinitionId, initiatedAt }) {
  const date = new Date(initiatedAt);

  return {
    run_id: runId,
    task_definition_id: taskDefinitionId,
    yyyy: String(date.getUTCFullYear()).padStart(4, '0'),
    mm: String(date.getUTCMonth() + 1).padStart(2, '0'),
    dd: String(date.getUTCDate()).padStart(2, '0'),
  };
}

function renderTemplateString(template, context) {
  assertNonEmptyString(template, 'template');
  return template.replace(TITLE_TOKEN_PATTERN, (_, token) => context[token] ?? '');
}

function buildCreateBeadsRequest({ repoRoot = process.cwd(), taskDefinition, runId, initiatedAt }) {
  const normalizedTaskDefinition = validateTaskDefinition(taskDefinition);
  if (normalizedTaskDefinition.materialization.kind !== 'create_beads_issue') {
    throw new TypeError('taskDefinition.materialization.kind must be create_beads_issue');
  }

  const context = buildTemplateContext({
    runId,
    taskDefinitionId: normalizedTaskDefinition.taskDefinitionId,
    initiatedAt,
  });
  const materialization = normalizedTaskDefinition.materialization;

  let description;
  if (materialization.descriptionTemplateRef !== undefined) {
    const templatePath = resolveRepoRelativePath({
      repoRoot,
      relativePath: materialization.descriptionTemplateRef,
      fieldName: 'taskDefinition.materialization.descriptionTemplateRef',
    });
    description = renderTemplateString(fs.readFileSync(templatePath, 'utf8'), context);
  }

  return normalizeCreateRequest({
    issueType: materialization.issueType,
    title: renderTemplateString(materialization.titleTemplate, context),
    description,
    labels: materialization.labels ?? [],
    priority: materialization.priority,
    parentBeadsId: materialization.parentBeadsId,
  });
}

module.exports = {
  buildCreateBeadsRequest,
  buildTemplateContext,
  loadTaskDefinition,
  renderTemplateString,
  validateAdHocLaunchRequest,
  validateLaunchRecord,
  validateTaskDefinition,
};
