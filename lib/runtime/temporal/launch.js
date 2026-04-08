'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const { DEFAULT_TEMPORAL_TASK_QUEUE, toIssueWorkflowId } = require('./bootstrap');
const { validateIssueWorkflowInput } = require('./contracts');
const { materializeLaunchRecord } = require('./launch-records');
const {
  buildCreateBeadsRequest,
  validateTaskDefinition,
} = require('./task-definitions');
const { issueWorkflow } = require('./workflows/issue-workflow');

const execFileAsync = promisify(execFile);

function generateRunId(scopeId) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${scopeId}-${timestamp}-${randomSuffix}`;
}

async function shellCreateBeadsIssue(createRequest) {
  const args = ['create', createRequest.title, '--type', createRequest.issueType, '--silent'];

  if (createRequest.description) {
    args.push('--description', createRequest.description);
  }

  if (createRequest.labels && createRequest.labels.length > 0) {
    args.push('--labels', createRequest.labels.join(','));
  }

  if (createRequest.priority !== undefined) {
    args.push('--priority', String(createRequest.priority));
  }

  if (createRequest.parentBeadsId) {
    args.push('--parent', createRequest.parentBeadsId);
  }

  const { stdout } = await execFileAsync('bd', args, {
    encoding: 'utf8',
  });
  const beadsId = stdout.trim();
  if (beadsId === '') {
    throw new Error('bd create did not return a BEADS id');
  }

  return { beadsId };
}

async function resolveBeadsTarget({ repoRoot, taskDefinition, runId, initiatedAt, createBeadsIssue }) {
  const normalizedTaskDefinition = validateTaskDefinition(taskDefinition);
  const materialization = normalizedTaskDefinition.materialization;

  if (materialization.kind === 'existing_beads_issue') {
    return {
      sourceKind: materialization.kind,
      resolvedBeadsId: materialization.beadsId,
      created: false,
      createRequest: undefined,
    };
  }

  const createRequest = buildCreateBeadsRequest({
    repoRoot,
    taskDefinition: normalizedTaskDefinition,
    runId,
    initiatedAt,
  });
  const createResult = await createBeadsIssue(createRequest);

  if (!createResult || typeof createResult.beadsId !== 'string' || createResult.beadsId.trim() === '') {
    throw new TypeError('createBeadsIssue must resolve to an object containing a non-empty beadsId');
  }

  return {
    sourceKind: materialization.kind,
    resolvedBeadsId: createResult.beadsId,
    created: true,
    createRequest,
  };
}

async function prepareLaunch({
  repoRoot = process.cwd(),
  taskDefinition,
  triggerType,
  initiatedAt,
  initiatedBy,
  scheduleId,
  runId,
  runtimeSkeleton,
  runtimeStart,
  createBeadsIssue = shellCreateBeadsIssue,
} = {}) {
  const normalizedTaskDefinition = validateTaskDefinition(taskDefinition);
  const resolvedRunId = runId ?? generateRunId(normalizedTaskDefinition.taskDefinitionId);
  const materialization = await resolveBeadsTarget({
    repoRoot,
    taskDefinition: normalizedTaskDefinition,
    runId: resolvedRunId,
    initiatedAt,
    createBeadsIssue,
  });

  const workflowInput = validateIssueWorkflowInput({
    version: 1,
    runId: resolvedRunId,
    triggerType,
    taskDefinitionId: normalizedTaskDefinition.taskDefinitionId,
    scheduleId,
    beadsTarget: {
      kind: 'existing',
      beadsId: materialization.resolvedBeadsId,
    },
    initiatedAt,
    initiatedBy,
    runtimeSkeleton: runtimeSkeleton ?? {
      mode: 'complete',
    },
  });

  const { launchRef, launchRecord } = await materializeLaunchRecord({
    repoRoot,
    launchRecord: {
      version: 1,
      runId: resolvedRunId,
      taskDefinitionId: normalizedTaskDefinition.taskDefinitionId,
      triggerType,
      scheduleId,
      initiatedAt,
      initiatedBy,
      materialization,
      runtimeStart,
      workflowInput,
    },
  });

  return {
    taskDefinition: normalizedTaskDefinition,
    workflowInput,
    launchRef,
    launchRecord,
  };
}

async function startPreparedLaunch({
  preparedLaunch,
  client,
  taskQueue = DEFAULT_TEMPORAL_TASK_QUEUE,
  workflowId,
  workflowStartOverrides = {},
} = {}) {
  if (!client || !client.workflow) {
    throw new TypeError('client.workflow is required');
  }

  const startOptions = {
    args: [preparedLaunch.workflowInput],
    taskQueue,
    workflowId: workflowId ?? toIssueWorkflowId(preparedLaunch.workflowInput.beadsTarget.beadsId),
    ...workflowStartOverrides,
  };

  const runtimeStart = preparedLaunch.launchRecord.runtimeStart;
  if (runtimeStart && runtimeStart.mode === 'delayed_once' && runtimeStart.startDelayMs > 0) {
    startOptions.startDelay = runtimeStart.startDelayMs;
  }

  return client.workflow.start(issueWorkflow, startOptions);
}

module.exports = {
  generateRunId,
  prepareLaunch,
  shellCreateBeadsIssue,
  startPreparedLaunch,
};
