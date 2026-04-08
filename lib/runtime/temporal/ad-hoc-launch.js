'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const {
  DEFAULT_TEMPORAL_TASK_QUEUE,
  toIssueWorkflowId,
} = require('./bootstrap');
const { validateIssueWorkflowInput } = require('./contracts');
const { issueWorkflow } = require('./workflows/issue-workflow');
const { materializeLaunchRecord } = require('./launch-records');
const {
  buildCreateBeadsRequest,
  loadTaskDefinition,
  validateAdHocLaunchRequest,
  validateTaskDefinition,
} = require('./task-definitions');

const execFileAsync = promisify(execFile);

function generateRunId(taskDefinitionId) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${taskDefinitionId}-${timestamp}-${randomSuffix}`;
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

async function prepareAdHocLaunch({
  repoRoot = process.cwd(),
  request,
  createBeadsIssue = shellCreateBeadsIssue,
} = {}) {
  const normalizedRequest = validateAdHocLaunchRequest(request);
  const { taskDefinition } = loadTaskDefinition({
    repoRoot,
    taskDefinitionId: normalizedRequest.taskDefinitionId,
  });

  if (taskDefinition.mode !== 'ad_hoc') {
    throw new Error('Step 2 ad hoc launch only supports task definitions with mode = ad_hoc');
  }

  const runId = normalizedRequest.runId ?? generateRunId(taskDefinition.taskDefinitionId);
  const materialization = await resolveBeadsTarget({
    repoRoot,
    taskDefinition,
    runId,
    initiatedAt: normalizedRequest.initiatedAt,
    createBeadsIssue,
  });

  const workflowInput = validateIssueWorkflowInput({
    version: 1,
    runId,
    triggerType: 'ad_hoc',
    taskDefinitionId: taskDefinition.taskDefinitionId,
    beadsTarget: {
      kind: 'existing',
      beadsId: materialization.resolvedBeadsId,
    },
    initiatedAt: normalizedRequest.initiatedAt,
    initiatedBy: 'operator',
    runtimeSkeleton: normalizedRequest.runtimeSkeleton ?? {
      mode: 'complete',
    },
  });

  const { launchRef, launchRecord } = await materializeLaunchRecord({
    repoRoot,
    launchRecord: {
      version: 1,
      runId,
      taskDefinitionId: taskDefinition.taskDefinitionId,
      triggerType: 'ad_hoc',
      initiatedAt: normalizedRequest.initiatedAt,
      initiatedBy: 'operator',
      materialization,
      workflowInput,
    },
  });

  return {
    request: normalizedRequest,
    taskDefinition,
    workflowInput,
    launchRef,
    launchRecord,
  };
}

async function launchAdHocTask({
  repoRoot = process.cwd(),
  request,
  client,
  taskQueue = DEFAULT_TEMPORAL_TASK_QUEUE,
  createBeadsIssue = shellCreateBeadsIssue,
} = {}) {
  if (!client || !client.workflow) {
    throw new TypeError('client.workflow is required');
  }

  const preparedLaunch = await prepareAdHocLaunch({
    repoRoot,
    request,
    createBeadsIssue,
  });

  const handle = await client.workflow.start(issueWorkflow, {
    args: [preparedLaunch.workflowInput],
    taskQueue,
    workflowId: toIssueWorkflowId(preparedLaunch.workflowInput.beadsTarget.beadsId),
  });

  return {
    ...preparedLaunch,
    handle,
  };
}

module.exports = {
  generateRunId,
  launchAdHocTask,
  prepareAdHocLaunch,
  shellCreateBeadsIssue,
};
