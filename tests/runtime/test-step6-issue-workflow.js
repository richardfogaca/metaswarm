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
const { executeIdempotentSpecToPlanAction } = require(path.join(
  ROOT,
  'lib/runtime/temporal/spec-to-plan-actions'
));
const {
  humanApprovalSignal,
  issueWorkflow,
  manualResumeSignal,
} = require(path.join(ROOT, 'lib/runtime/temporal/workflows/issue-workflow'));

function makeInput(overrides = {}) {
  return {
    version: 1,
    runId: 'run-step6-workflow',
    triggerType: 'ad_hoc',
    beadsTarget: {
      kind: 'existing',
      beadsId: 'bd-step6',
    },
    initiatedAt: '2026-04-08T21:00:00.000Z',
    initiatedBy: 'operator',
    ...overrides,
  };
}

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step6-workflow-'));
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

test('draft-plan actions are idempotent and the workflow re-reads BEADS before completing', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const repoRoot = makeRepoRoot();
  const emittedStatuses = [];
  let adapterCalls = 0;
  let readIndex = 0;
  const states = [
    {
      version: 1,
      kind: 'run_spec_to_plan_action',
      specToPlanAction: {
        kind: 'draft_plan',
        actionKey: 'draft-plan-1',
        artifactKey: 'planning-draft-1',
        instructions: 'Draft an implementation plan.',
      },
      blockers: ['Drafting implementation plan'],
      lastUpdatedAt: '2026-04-08T21:00:00.000Z',
    },
    {
      version: 1,
      kind: 'run_spec_to_plan_action',
      specToPlanAction: {
        kind: 'draft_plan',
        actionKey: 'draft-plan-1',
        artifactKey: 'planning-draft-1',
        instructions: 'Draft an implementation plan.',
      },
      blockers: ['Drafting implementation plan'],
      lastUpdatedAt: '2026-04-08T21:00:30.000Z',
    },
    {
      version: 1,
      kind: 'complete',
      acceptedChanges: ['Approved planning artifact persisted to runtime'],
      lastUpdatedAt: '2026-04-08T21:05:00.000Z',
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
        readIndex += 1;
        return JSON.parse(JSON.stringify(state));
      },
      async executeSpecToPlanAction(input) {
        return executeIdempotentSpecToPlanAction({
          repoRoot,
          runId: input.runId,
          beadsId: input.beadsId,
          action: input.action,
          performSpecToPlanAction: async action => {
            adapterCalls += 1;
            return {
              status: 'draft',
              summary: `Drafted plan for ${action.actionKey}`,
            };
          },
        });
      },
      async executeLateStageAction() {
        throw new Error('executeLateStageAction should not run for planning actions');
      },
      async refreshExternalObservation() {
        throw new Error('refreshExternalObservation should not run for planning actions');
      },
    },
  });

  try {
    const result = await worker.runUntil(() =>
      env.client.workflow.execute(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step6-draft-plan',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step6-draft-plan',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step6-draft-plan'),
      })
    );

    assert.equal(result.terminalStatus, 'completed');
    assert.equal(adapterCalls, 1);
    assert.deepEqual(emittedStatuses, ['completed']);
    const artifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, '.metaswarm/runtime/planning-artifacts/planning-draft-1.json'), 'utf8')
    );
    assert.equal(artifact.result.status, 'draft');
  } finally {
    await env.teardown();
  }
});

test('plan review gate can execute and still stop cleanly at approval until BEADS truth changes', async () => {
  const env = await TestWorkflowEnvironment.createLocal();
  const repoRoot = makeRepoRoot();
  const emittedStatuses = [];
  const authority = {
    state: {
      version: 1,
      kind: 'run_spec_to_plan_action',
      specToPlanAction: {
        kind: 'run_plan_review_gate',
        actionKey: 'plan-review-1',
        artifactKey: 'plan-review-1',
        sourceArtifactKey: 'planning-draft-1',
      },
      blockers: ['Running plan review gate'],
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
      async executeSpecToPlanAction(input) {
        const result = await executeIdempotentSpecToPlanAction({
          repoRoot,
          runId: input.runId,
          beadsId: input.beadsId,
          action: input.action,
          performSpecToPlanAction: async action => ({
            status: 'approved',
            summary: `Plan review approved ${action.sourceArtifactKey}`,
          }),
        });
        authority.state = {
          version: 1,
          kind: 'await_human_approval',
          blockers: ['Waiting for operator approval to continue into implementation'],
          humanActionRequired: 'Approve checkpoint to continue into implementation',
          lastUpdatedAt: '2026-04-08T21:05:00.000Z',
        };
        return result;
      },
      async executeLateStageAction() {
        throw new Error('executeLateStageAction should not run for planning gates');
      },
      async refreshExternalObservation() {
        throw new Error('refreshExternalObservation should not run for planning gates');
      },
    },
  });

  try {
    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(issueWorkflow, {
        args: [
          makeInput({
            runId: 'run-step6-plan-review',
            beadsTarget: {
              kind: 'existing',
              beadsId: 'bd-step6-plan-review',
            },
          }),
        ],
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowId: toIssueWorkflowId('bd-step6-plan-review'),
      });

      await waitForCondition(() => emittedStatuses.includes('blocked'));

      await handle.signal(humanApprovalSignal);
      await waitForCondition(() => emittedStatuses.length >= 2);
      assert.deepEqual(emittedStatuses.slice(0, 2), ['blocked', 'blocked']);

      authority.state = {
        version: 1,
        kind: 'complete',
        acceptedChanges: ['Approved planning checkpoint persisted'],
        lastUpdatedAt: '2026-04-08T21:10:00.000Z',
      };

      await handle.signal(manualResumeSignal);
      return handle.result();
    }, {
      promiseCompletionTimeout: '5 seconds',
    });

    assert.equal(result.terminalStatus, 'completed');
    assert.deepEqual(emittedStatuses, ['blocked', 'blocked', 'completed']);
    const artifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, '.metaswarm/runtime/planning-artifacts/plan-review-1.json'), 'utf8')
    );
    assert.equal(artifact.result.status, 'approved');
  } finally {
    await env.teardown();
  }
});
