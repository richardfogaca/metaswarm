#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { Worker } = require('@temporalio/worker');
const { TestWorkflowEnvironment } = require('@temporalio/testing');

const ROOT = path.resolve(__dirname, '../..');
const { DEFAULT_TEMPORAL_TASK_QUEUE, toIssueWorkflowId } = require(path.join(
  ROOT,
  'lib/runtime/temporal/bootstrap'
));
const {
  externalObservationChangedSignal,
  humanApprovalSignal,
  issueWorkflow,
  manualResumeSignal,
} = require(path.join(ROOT, 'lib/runtime/temporal/workflows/issue-workflow'));

function makeInput(overrides = {}) {
  return {
    version: 1,
    runId: 'run-step4-workflow',
    triggerType: 'ad_hoc',
    beadsTarget: {
      kind: 'existing',
      beadsId: 'bd-step4',
    },
    initiatedAt: '2026-04-08T21:00:00.000Z',
    initiatedBy: 'operator',
    ...overrides,
  };
}

async function waitForCondition(check, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
}

test('issueWorkflow re-reads authoritative state after timer wake before completing', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const emittedStatuses = [];
  const readKinds = [];
  const initiatedAt = new Date(await env.currentTimeMs()).toISOString();
  const sleepUntil = new Date((await env.currentTimeMs()) + 60 * 60 * 1000).toISOString();
  let readIndex = 0;
  const states = [
    {
      version: 1,
      kind: 'sleep_until',
      sleepUntil,
      blockers: ['Waiting for timer wakeup'],
      lastUpdatedAt: initiatedAt,
    },
    {
      version: 1,
      kind: 'complete',
      lastUpdatedAt: sleepUntil,
    },
  ];

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
      async readBeadsWorkflowState() {
        const state = states[Math.min(readIndex, states.length - 1)];
        readKinds.push(state.kind);
        readIndex += 1;
        return state;
      },
      async refreshExternalObservation() {
        throw new Error('refreshExternalObservation should not run for timer wake');
      },
    },
  });

  try {
    const result = await worker.runUntil(() =>
      env.client.workflow.execute(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step4-sleep',
            initiatedAt,
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step4-sleep'),
      })
    );

    assert.equal(result.terminalStatus, 'completed');
    assert.deepEqual(emittedStatuses, ['sleeping', 'completed']);
    assert.deepEqual(readKinds, ['sleep_until', 'complete']);
  } finally {
    await env.teardown();
  }
});

test('human approval and manual resume only wake the workflow and do not bypass BEADS truth', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const emittedStatuses = [];
  const readKinds = [];
  const authority = {
    state: {
      version: 1,
      kind: 'await_human_approval',
      blockers: ['Waiting for operator approval'],
      humanActionRequired: 'Approve the latest plan',
      lastUpdatedAt: '2026-04-08T21:00:00.000Z',
    },
  };

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
      async readBeadsWorkflowState() {
        readKinds.push(authority.state.kind);
        return JSON.parse(JSON.stringify(authority.state));
      },
      async refreshExternalObservation() {
        throw new Error('refreshExternalObservation should not run for human approval waits');
      },
    },
  });

  try {
    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step4-approval',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step4-approval',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step4-approval'),
      });

      await waitForCondition(() => emittedStatuses.includes('blocked'));
      let description = await handle.describe();
      assert.equal(description.status.name, 'RUNNING');

      await handle.signal(humanApprovalSignal);
      await waitForCondition(() => emittedStatuses.length >= 2);
      assert.deepEqual(emittedStatuses.slice(0, 2), ['blocked', 'blocked']);

      description = await handle.describe();
      assert.equal(description.status.name, 'RUNNING');

      authority.state = {
        version: 1,
        kind: 'complete',
        acceptedChanges: ['approval-recorded'],
        lastUpdatedAt: '2026-04-08T21:05:00.000Z',
      };

      await handle.signal(manualResumeSignal);
      return handle.result();
    }, {
      promiseCompletionTimeout: '5 seconds',
    });

    assert.equal(result.terminalStatus, 'completed');
    assert.deepEqual(emittedStatuses, ['blocked', 'blocked', 'completed']);
    assert.deepEqual(readKinds, ['await_human_approval', 'await_human_approval', 'complete']);
  } finally {
    await env.teardown();
  }
});

test('external observation wakeups refresh observation before BEADS reconciliation', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const emittedStatuses = [];
  const events = [];
  const authority = {
    state: {
      version: 1,
      kind: 'await_external_observation',
      blockers: ['Waiting for CI status'],
      lastUpdatedAt: '2026-04-08T21:00:00.000Z',
    },
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: {
      async emitRunSummary(artifact) {
        emittedStatuses.push(artifact.runtimeStatus);
        events.push(`summary:${artifact.runtimeStatus}`);
        return {
          summaryRef: `.metaswarm/runtime/reviews/${artifact.runId}.json`,
          artifact,
        };
      },
      async readBeadsWorkflowState() {
        events.push(`read:${authority.state.kind}`);
        return JSON.parse(JSON.stringify(authority.state));
      },
      async refreshExternalObservation() {
        events.push('refresh');
        return {
          refreshed: true,
        };
      },
    },
  });

  try {
    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step4-observation',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step4-observation',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step4-observation'),
      });

      await waitForCondition(() => emittedStatuses.includes('blocked'));

      authority.state = {
        version: 1,
        kind: 'complete',
        lastUpdatedAt: '2026-04-08T21:10:00.000Z',
      };

      await handle.signal(externalObservationChangedSignal);
      return handle.result();
    }, {
      promiseCompletionTimeout: '5 seconds',
    });

    assert.equal(result.terminalStatus, 'completed');
    assert.deepEqual(emittedStatuses, ['blocked', 'completed']);
    assert.deepEqual(events, [
      'read:await_external_observation',
      'summary:blocked',
      'refresh',
      'read:complete',
      'summary:completed',
    ]);
  } finally {
    await env.teardown();
  }
});
