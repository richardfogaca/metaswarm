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
const { DEFAULT_TEMPORAL_TASK_QUEUE, toIssueWorkflowId } = require(path.join(
  ROOT,
  'lib/runtime/temporal/bootstrap'
));
const { executeIdempotentLateStageAction } = require(path.join(
  ROOT,
  'lib/runtime/temporal/late-stage-actions'
));
const {
  externalObservationChangedSignal,
  issueWorkflow,
  prShepherdTickSignal,
} = require(path.join(ROOT, 'lib/runtime/temporal/workflows/issue-workflow'));

function makeInput(overrides = {}) {
  return {
    version: 1,
    runId: 'run-step5-workflow',
    triggerType: 'ad_hoc',
    beadsTarget: {
      kind: 'existing',
      beadsId: 'bd-step5',
    },
    initiatedAt: '2026-04-08T21:00:00.000Z',
    initiatedBy: 'operator',
    ...overrides,
  };
}

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step5-workflow-'));
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

test('await_external_observation with ci target wakes on observation signal, refreshes, and then re-reads BEADS', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const emittedStatuses = [];
  const events = [];
  const authority = {
    state: {
      version: 1,
      kind: 'await_external_observation',
      observation: {
        kind: 'ci',
      },
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
        events.push(`read:${authority.state.kind}:${authority.state.observation?.kind ?? 'none'}`);
        return JSON.parse(JSON.stringify(authority.state));
      },
      async refreshExternalObservation(input) {
        events.push(`refresh:${input.observationKind}`);
        return {
          refreshed: true,
        };
      },
      async executeLateStageAction() {
        throw new Error('executeLateStageAction should not run for CI waits');
      },
    },
  });

  try {
    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step5-ci',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step5-ci',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step5-ci'),
      });

      await waitForCondition(() => emittedStatuses.includes('blocked'));

      authority.state = {
        version: 1,
        kind: 'complete',
        acceptedChanges: ['ci-green'],
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
      'read:await_external_observation:ci',
      'summary:blocked',
      'refresh:ci',
      'read:complete:none',
      'summary:completed',
    ]);
  } finally {
    await env.teardown();
  }
});

test('pr shepherd wakeup can drive an idempotent review follow-up action without duplicating side effects', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const repoRoot = makeRepoRoot();
  const emittedStatuses = [];
  const events = [];
  let adapterCalls = 0;
  let readIndex = 0;
  const states = [
    {
      version: 1,
      kind: 'await_external_observation',
      observation: {
        kind: 'pr_shepherd',
      },
      blockers: ['Waiting for scheduled PR shepherd wakeup'],
      lastUpdatedAt: '2026-04-08T21:00:00.000Z',
    },
    {
      version: 1,
      kind: 'run_late_stage_action',
      observation: {
        kind: 'review_comments',
      },
      lateStageAction: {
        kind: 'post_pr_comment',
        actionKey: 'review-followup-1',
        commentBody: 'Please address the latest review feedback.',
      },
      blockers: ['Posting review follow-up comment'],
      lastUpdatedAt: '2026-04-08T21:05:00.000Z',
    },
    {
      version: 1,
      kind: 'run_late_stage_action',
      observation: {
        kind: 'review_comments',
      },
      lateStageAction: {
        kind: 'post_pr_comment',
        actionKey: 'review-followup-1',
        commentBody: 'Please address the latest review feedback.',
      },
      blockers: ['Posting review follow-up comment'],
      lastUpdatedAt: '2026-04-08T21:05:30.000Z',
    },
    {
      version: 1,
      kind: 'complete',
      acceptedChanges: ['review-followup-posted'],
      lastUpdatedAt: '2026-04-08T21:07:00.000Z',
    },
  ];

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
        const state = states[Math.min(readIndex, states.length - 1)];
        readIndex += 1;
        events.push(`read:${state.kind}:${state.observation?.kind ?? 'none'}`);
        return JSON.parse(JSON.stringify(state));
      },
      async refreshExternalObservation(input) {
        events.push(`refresh:${input.observationKind}`);
        return {
          refreshed: true,
        };
      },
      async executeLateStageAction(input) {
        return executeIdempotentLateStageAction({
          repoRoot,
          runId: input.runId,
          beadsId: input.beadsId,
          action: input.action,
          performLateStageAction: async action => {
            adapterCalls += 1;
            events.push(`perform:${action.kind}:${action.actionKey}`);
            return {
              postedCommentId: 'comment-step5-1',
            };
          },
        });
      },
    },
  });

  try {
    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step5-pr-shepherd',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step5-pr-shepherd',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step5-pr-shepherd'),
      });

      await waitForCondition(() => emittedStatuses.includes('blocked'));
      await handle.signal(prShepherdTickSignal);
      return handle.result();
    }, {
      promiseCompletionTimeout: '5 seconds',
    });

    assert.equal(result.terminalStatus, 'completed');
    assert.equal(adapterCalls, 1);
    assert.deepEqual(emittedStatuses, ['blocked', 'completed']);
    assert.deepEqual(events, [
      'read:await_external_observation:pr_shepherd',
      'summary:blocked',
      'refresh:pr_shepherd',
      'read:run_late_stage_action:review_comments',
      'perform:post_pr_comment:review-followup-1',
      'refresh:review_comments',
      'read:run_late_stage_action:review_comments',
      'refresh:review_comments',
      'read:complete:none',
      'summary:completed',
    ]);
  } finally {
    await env.teardown();
  }
});
