#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Worker } = require('@temporalio/worker');
const { TestWorkflowEnvironment } = require('@temporalio/testing');

const ROOT = path.resolve(__dirname, '../..');
const { DEFAULT_TEMPORAL_TASK_QUEUE, resolveRuntimePaths, toIssueWorkflowId } = require(path.join(
  ROOT,
  'lib/runtime/temporal/bootstrap'
));
const { createTemporalActivities } = require(path.join(ROOT, 'lib/runtime/temporal/activities'));
const { issueWorkflow } = require(path.join(ROOT, 'lib/runtime/temporal/workflows/issue-workflow'));

function makeInput(overrides = {}) {
  return {
    version: 1,
    runId: 'run-step1-workflow',
    triggerType: 'ad_hoc',
    beadsTarget: {
      kind: 'existing',
      beadsId: 'bd-1234',
    },
    initiatedAt: '2026-04-08T21:00:00.000Z',
    initiatedBy: 'operator',
    runtimeSkeleton: {
      mode: 'complete',
    },
    ...overrides,
  };
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForCondition(check, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
}

test('issueWorkflow completes immediately and emits a terminal summary', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step1-complete-'));
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: createTemporalActivities({ repoRoot }),
  });

  try {
    const result = await worker.runUntil(() =>
      env.client.workflow.execute(issueWorkflow, {
        args: [makeInput()],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-1234'),
      })
    );

    assert.equal(result.terminalStatus, 'completed');

    const reviewPath = path.join(resolveRuntimePaths(repoRoot).reviewsDir, 'run-step1-workflow.json');
    const artifact = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    assert.equal(artifact.runtimeStatus, 'completed');
  } finally {
    await env.teardown();
  }
});

test('issueWorkflow emits sleeping then completed summaries under deterministic time skipping', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const emittedStatuses = [];
  const initiatedAt = new Date(await env.currentTimeMs()).toISOString();
  const sleepUntil = new Date((await env.currentTimeMs()) + 60 * 60 * 1000).toISOString();

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: {
      async emitRunSummary(artifact) {
        emittedStatuses.push(artifact.runtimeStatus);
        return {
          summaryRef: `.metaswarm/runtime/reviews/${artifact.runId}.json`,
          artifact,
        };
      },
    },
  });

  const sleepInput = makeInput({
    runId: 'run-step1-sleep',
    initiatedAt,
    runtimeSkeleton: {
      mode: 'sleep_until',
      sleepUntil,
      reason: 'Wait for deterministic timer wakeup',
    },
  });

  try {
    const result = await worker.runUntil(() =>
      env.client.workflow.execute(issueWorkflow, {
        args: [sleepInput],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-1234-sleep'),
      })
    );

    assert.equal(result.terminalStatus, 'completed');
    assert.deepEqual(emittedStatuses, ['sleeping', 'completed']);
  } finally {
    await env.teardown();
  }
});

test('issueWorkflow survives worker restart across a short timer sleep', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const emittedStatuses = [];
  const now = Date.now();
  const initiatedAt = new Date(now).toISOString();
  const sleepUntil = new Date(now + 250).toISOString();

  const firstWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: {
      async emitRunSummary(artifact) {
        emittedStatuses.push(artifact.runtimeStatus);
        return {
          summaryRef: `.metaswarm/runtime/reviews/${artifact.runId}.json`,
          artifact,
        };
      },
    },
  });

  const sleepInput = makeInput({
    runId: 'run-step1-restart',
    initiatedAt,
    runtimeSkeleton: {
      mode: 'sleep_until',
      sleepUntil,
      reason: 'Wait for restart proof',
    },
  });

  const runPromise = firstWorker.run();

  try {
    const handle = await env.client.workflow.start(issueWorkflow, {
      args: [sleepInput],
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowId: toIssueWorkflowId('bd-1234-restart'),
    });

    await waitForCondition(() => emittedStatuses.includes('sleeping'));

    firstWorker.shutdown();
    await runPromise;

    const secondWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
      activities: {
        async emitRunSummary(artifact) {
          emittedStatuses.push(artifact.runtimeStatus);
          return {
            summaryRef: `.metaswarm/runtime/reviews/${artifact.runId}.json`,
            artifact,
          };
        },
      },
    });

    const result = await secondWorker.runUntil(() => handle.result(), {
      promiseCompletionTimeout: '5 seconds',
    });

    assert.equal(result.terminalStatus, 'completed');
    assert.deepEqual(emittedStatuses, ['sleeping', 'completed']);
  } finally {
    await env.teardown();
  }
});
