'use strict';

const { loadTaskDefinition, validateAdHocLaunchRequest } = require('./task-definitions');
const {
  generateRunId,
  prepareLaunch,
  shellCreateBeadsIssue,
  startPreparedLaunch,
} = require('./launch');

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

  const preparedLaunch = await prepareLaunch({
    repoRoot,
    taskDefinition,
    triggerType: 'ad_hoc',
    initiatedAt: normalizedRequest.initiatedAt,
    initiatedBy: 'operator',
    runId: normalizedRequest.runId ?? generateRunId(taskDefinition.taskDefinitionId),
    runtimeSkeleton: normalizedRequest.runtimeSkeleton,
    createBeadsIssue,
  });

  return {
    request: normalizedRequest,
    ...preparedLaunch,
  };
}

async function launchAdHocTask({
  repoRoot = process.cwd(),
  request,
  client,
  taskQueue,
  createBeadsIssue = shellCreateBeadsIssue,
} = {}) {
  const preparedLaunch = await prepareAdHocLaunch({
    repoRoot,
    request,
    createBeadsIssue,
  });
  const handle = await startPreparedLaunch({
    preparedLaunch,
    client,
    taskQueue,
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
