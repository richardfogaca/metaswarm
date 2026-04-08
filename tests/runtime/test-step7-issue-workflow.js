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
const { executeIdempotentWorkUnitAction } = require(path.join(
  ROOT,
  'lib/runtime/temporal/work-unit-actions'
));
const {
  humanApprovalSignal,
  issueWorkflow,
  manualResumeSignal,
} = require(path.join(ROOT, 'lib/runtime/temporal/workflows/issue-workflow'));

function makeInput(overrides = {}) {
  return {
    version: 1,
    runId: 'run-step7-workflow',
    triggerType: 'ad_hoc',
    beadsTarget: {
      kind: 'existing',
      beadsId: 'bd-step7',
    },
    initiatedAt: '2026-04-08T21:00:00.000Z',
    initiatedBy: 'operator',
    ...overrides,
  };
}

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step7-workflow-'));
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

test('IMPLEMENT -> VALIDATE -> ADVERSARIAL_REVIEW -> COMMIT executes through the parent workflow and re-reads BEADS between each step', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const repoRoot = makeRepoRoot();
  const emittedStatuses = [];
  const events = [];
  const states = [
    {
      version: 1,
      kind: 'run_work_unit_action',
      workUnitAction: {
        kind: 'implement',
        workUnitId: 'wu-001',
        actionKey: 'wu-001-implement-1',
        artifactKey: 'wu-001-implement-1',
      },
      blockers: ['Implementing wu-001'],
      lastUpdatedAt: '2026-04-08T21:00:00.000Z',
    },
    {
      version: 1,
      kind: 'run_work_unit_action',
      workUnitAction: {
        kind: 'validate',
        workUnitId: 'wu-001',
        actionKey: 'wu-001-validate-1',
        artifactKey: 'wu-001-validate-1',
        sourceArtifactKey: 'wu-001-implement-1',
      },
      blockers: ['Validating wu-001'],
      lastUpdatedAt: '2026-04-08T21:05:00.000Z',
    },
    {
      version: 1,
      kind: 'run_work_unit_action',
      workUnitAction: {
        kind: 'adversarial_review',
        workUnitId: 'wu-001',
        actionKey: 'wu-001-review-1',
        artifactKey: 'wu-001-review-1',
        sourceArtifactKey: 'wu-001-validate-1',
      },
      blockers: ['Reviewing wu-001'],
      lastUpdatedAt: '2026-04-08T21:10:00.000Z',
    },
    {
      version: 1,
      kind: 'run_work_unit_action',
      workUnitAction: {
        kind: 'commit',
        workUnitId: 'wu-001',
        actionKey: 'wu-001-commit-1',
        artifactKey: 'wu-001-commit-1',
        sourceArtifactKey: 'wu-001-review-1',
      },
      blockers: ['Committing wu-001'],
      lastUpdatedAt: '2026-04-08T21:15:00.000Z',
    },
    {
      version: 1,
      kind: 'complete',
      acceptedChanges: ['wu-001 committed'],
      lastUpdatedAt: '2026-04-08T21:20:00.000Z',
    },
  ];
  let readIndex = 0;
  let adapterCalls = 0;

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
        events.push(`read:${state.kind}:${state.workUnitAction?.kind ?? 'none'}`);
        return JSON.parse(JSON.stringify(state));
      },
      async executeWorkUnitAction(input) {
        return executeIdempotentWorkUnitAction({
          repoRoot,
          runId: input.runId,
          beadsId: input.beadsId,
          action: input.action,
          performWorkUnitAction: async action => {
            adapterCalls += 1;
            events.push(`perform:${action.kind}:${action.actionKey}`);
            return {
              status: action.kind,
              workUnitId: action.workUnitId,
            };
          },
        });
      },
      async executeSpecToPlanAction() {
        throw new Error('executeSpecToPlanAction should not run for work-unit actions');
      },
      async executeLateStageAction() {
        throw new Error('executeLateStageAction should not run for work-unit actions');
      },
      async refreshExternalObservation() {
        throw new Error('refreshExternalObservation should not run for work-unit actions');
      },
    },
  });

  try {
    const result = await worker.runUntil(() =>
      env.client.workflow.execute(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step7-sequence',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step7-sequence',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step7-sequence'),
      })
    );

    assert.equal(result.terminalStatus, 'completed');
    assert.equal(adapterCalls, 4);
    assert.deepEqual(emittedStatuses, ['completed']);
    assert.deepEqual(events, [
      'read:run_work_unit_action:implement',
      'perform:implement:wu-001-implement-1',
      'read:run_work_unit_action:validate',
      'perform:validate:wu-001-validate-1',
      'read:run_work_unit_action:adversarial_review',
      'perform:adversarial_review:wu-001-review-1',
      'read:run_work_unit_action:commit',
      'perform:commit:wu-001-commit-1',
      'read:complete:none',
      'summary:completed',
    ]);
  } finally {
    await env.teardown();
  }
});

test('replaying the same review actionKey reuses the artifact but a new review actionKey triggers a fresh review attempt', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const repoRoot = makeRepoRoot();
  const reviewArtifacts = [];
  let readIndex = 0;
  let adapterCalls = 0;
  const states = [
    {
      version: 1,
      kind: 'run_work_unit_action',
      workUnitAction: {
        kind: 'adversarial_review',
        workUnitId: 'wu-001',
        actionKey: 'wu-001-review-1',
        artifactKey: 'wu-001-review-1',
        sourceArtifactKey: 'wu-001-validate-1',
      },
      blockers: ['Reviewing wu-001'],
      lastUpdatedAt: '2026-04-08T21:00:00.000Z',
    },
    {
      version: 1,
      kind: 'run_work_unit_action',
      workUnitAction: {
        kind: 'adversarial_review',
        workUnitId: 'wu-001',
        actionKey: 'wu-001-review-1',
        artifactKey: 'wu-001-review-1',
        sourceArtifactKey: 'wu-001-validate-1',
      },
      blockers: ['Reviewing wu-001'],
      lastUpdatedAt: '2026-04-08T21:01:00.000Z',
    },
    {
      version: 1,
      kind: 'run_work_unit_action',
      workUnitAction: {
        kind: 'adversarial_review',
        workUnitId: 'wu-001',
        actionKey: 'wu-001-review-2',
        artifactKey: 'wu-001-review-2',
        sourceArtifactKey: 'wu-001-validate-1',
      },
      blockers: ['Retrying fresh review for wu-001'],
      lastUpdatedAt: '2026-04-08T21:02:00.000Z',
    },
    {
      version: 1,
      kind: 'complete',
      acceptedChanges: ['wu-001 review accepted'],
      lastUpdatedAt: '2026-04-08T21:03:00.000Z',
    },
  ];

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: {
      async emitRunSummary(artifact) {
        return {
          summaryRef: `.metaswarm/runtime/reviews/${artifact.runId}.json`,
          artifact,
        };
      },
      async readBeadsWorkflowState() {
        const state = states[Math.min(readIndex, states.length - 1)];
        readIndex += 1;
        return JSON.parse(JSON.stringify(state));
      },
      async executeWorkUnitAction(input) {
        const result = await executeIdempotentWorkUnitAction({
          repoRoot,
          runId: input.runId,
          beadsId: input.beadsId,
          action: input.action,
          performWorkUnitAction: async action => {
            adapterCalls += 1;
            return {
              verdict: 'pass',
              reviewAttempt: action.actionKey,
            };
          },
        });
        reviewArtifacts.push(result.artifactRef);
        return result;
      },
      async executeSpecToPlanAction() {
        throw new Error('executeSpecToPlanAction should not run for work-unit actions');
      },
      async executeLateStageAction() {
        throw new Error('executeLateStageAction should not run for work-unit actions');
      },
      async refreshExternalObservation() {
        throw new Error('refreshExternalObservation should not run for work-unit actions');
      },
    },
  });

  try {
    const result = await worker.runUntil(() =>
      env.client.workflow.execute(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step7-review-retry',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step7-review-retry',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step7-review-retry'),
      })
    );

    assert.equal(result.terminalStatus, 'completed');
    assert.equal(adapterCalls, 2);
    assert.deepEqual(reviewArtifacts, [
      '.metaswarm/runtime/work-unit-artifacts/wu-001-review-1.json',
      '.metaswarm/runtime/work-unit-artifacts/wu-001-review-1.json',
      '.metaswarm/runtime/work-unit-artifacts/wu-001-review-2.json',
    ]);
  } finally {
    await env.teardown();
  }
});

test('work-unit progress can stop at a human checkpoint after commit until BEADS truth changes', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const repoRoot = makeRepoRoot();
  const emittedStatuses = [];
  const authority = {
    state: {
      version: 1,
      kind: 'run_work_unit_action',
      workUnitAction: {
        kind: 'commit',
        workUnitId: 'wu-001',
        actionKey: 'wu-001-commit-1',
        artifactKey: 'wu-001-commit-1',
        sourceArtifactKey: 'wu-001-review-1',
      },
      blockers: ['Committing wu-001'],
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
        return JSON.parse(JSON.stringify(authority.state));
      },
      async executeWorkUnitAction(input) {
        const result = await executeIdempotentWorkUnitAction({
          repoRoot,
          runId: input.runId,
          beadsId: input.beadsId,
          action: input.action,
          performWorkUnitAction: async action => ({
            status: action.kind,
            committed: true,
          }),
        });
        authority.state = {
          version: 1,
          kind: 'await_human_approval',
          blockers: ['Waiting for operator approval after commit checkpoint'],
          humanActionRequired: 'Approve checkpoint to accept committed work-unit output',
          lastUpdatedAt: '2026-04-08T21:05:00.000Z',
        };
        return result;
      },
      async executeSpecToPlanAction() {
        throw new Error('executeSpecToPlanAction should not run for work-unit actions');
      },
      async executeLateStageAction() {
        throw new Error('executeLateStageAction should not run for work-unit actions');
      },
      async refreshExternalObservation() {
        throw new Error('refreshExternalObservation should not run for work-unit actions');
      },
    },
  });

  try {
    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step7-human-checkpoint',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step7-human-checkpoint',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step7-human-checkpoint'),
      });

      await waitForCondition(() => emittedStatuses.includes('blocked'));

      await handle.signal(humanApprovalSignal);
      await waitForCondition(() => emittedStatuses.length >= 2);
      assert.deepEqual(emittedStatuses.slice(0, 2), ['blocked', 'blocked']);

      authority.state = {
        version: 1,
        kind: 'complete',
        acceptedChanges: ['wu-001 checkpoint approved'],
        lastUpdatedAt: '2026-04-08T21:10:00.000Z',
      };

      await handle.signal(manualResumeSignal);
      return handle.result();
    });

    assert.equal(result.terminalStatus, 'completed');
    assert.deepEqual(emittedStatuses, ['blocked', 'blocked', 'completed']);
  } finally {
    await env.teardown();
  }
});
