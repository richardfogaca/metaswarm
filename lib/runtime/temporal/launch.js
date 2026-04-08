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

async function shellCreateBeadsIssue(createRequest, { repoRoot = process.cwd() } = {}) {
  if (createRequest.externalRef) {
    const existingIssue = await findBeadsIssueByExternalRef({
      repoRoot,
      externalRef: createRequest.externalRef,
    });
    if (existingIssue) {
      return { beadsId: existingIssue.beadsId };
    }
  }

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

  if (createRequest.externalRef) {
    args.push('--external-ref', createRequest.externalRef);
  }

  const { stdout } = await execFileAsync('bd', args, {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  const beadsId = stdout.trim();
  if (beadsId === '') {
    throw new Error('bd create did not return a BEADS id');
  }

  return { beadsId };
}

async function findBeadsIssueByExternalRef({ repoRoot = process.cwd(), externalRef }) {
  const { stdout } = await execFileAsync('bd', ['export', '--no-memories'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });

  for (const line of stdout.split('\n')) {
    if (line.trim() === '') {
      continue;
    }

    const issue = JSON.parse(line);
    if (issue.external_ref === externalRef || issue.externalRef === externalRef) {
      return { beadsId: issue.id };
    }
  }

  return null;
}

async function resolveBeadsTarget({
  repoRoot,
  taskDefinition,
  runId,
  initiatedAt,
  createBeadsIssue,
  materializationContext,
}) {
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
    scheduledFor: materializationContext?.scheduledFor,
    timezone: materializationContext?.timezone,
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
  materializationContext,
  createBeadsIssue,
} = {}) {
  const normalizedTaskDefinition = validateTaskDefinition(taskDefinition);
  const resolvedRunId = runId ?? generateRunId(normalizedTaskDefinition.taskDefinitionId);
  const createBeadsIssueFn =
    createBeadsIssue ??
    (createRequest => shellCreateBeadsIssue(createRequest, { repoRoot }));
  const materialization = await resolveBeadsTarget({
    repoRoot,
    taskDefinition: normalizedTaskDefinition,
    runId: resolvedRunId,
    initiatedAt,
    materializationContext,
    createBeadsIssue: createBeadsIssueFn,
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
