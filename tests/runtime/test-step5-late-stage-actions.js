#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  validateStep5WorkflowState,
} = require(path.join(ROOT, 'lib/runtime/temporal/contracts'));
const {
  buildActionReceiptRef,
  executeIdempotentLateStageAction,
} = require(path.join(ROOT, 'lib/runtime/temporal/late-stage-actions'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step5-actions-'));
}

function makeAction(overrides = {}) {
  return {
    kind: 'post_pr_comment',
    actionKey: 'followup-comment-1',
    commentBody: 'Please address the remaining review feedback.',
    ...overrides,
  };
}

test('validateStep5WorkflowState accepts explicit late-stage waits and action states', () => {
  const ciWait = validateStep5WorkflowState({
    version: 1,
    kind: 'await_external_observation',
    observation: {
      kind: 'ci',
    },
    blockers: ['Waiting for CI to finish'],
    lastUpdatedAt: '2026-04-08T21:00:00.000Z',
  });

  const actionState = validateStep5WorkflowState({
    version: 1,
    kind: 'run_late_stage_action',
    observation: {
      kind: 'review_comments',
    },
    lateStageAction: makeAction(),
    blockers: ['Posting review follow-up comment'],
    lastUpdatedAt: '2026-04-08T21:05:00.000Z',
  });

  assert.equal(ciWait.observation.kind, 'ci');
  assert.equal(actionState.kind, 'run_late_stage_action');
  assert.equal(actionState.lateStageAction.actionKey, 'followup-comment-1');
});

test('validateStep5WorkflowState rejects malformed late-stage action shapes', () => {
  assert.throws(
    () =>
      validateStep5WorkflowState({
        version: 1,
        kind: 'run_late_stage_action',
        lateStageAction: {
          kind: 'post_pr_comment',
          commentBody: 'Missing action key',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /actionKey/i
  );

  assert.throws(
    () =>
      validateStep5WorkflowState({
        version: 1,
        kind: 'run_late_stage_action',
        lateStageAction: {
          kind: 'delete_pr',
          actionKey: 'bad-action',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /lateStageAction\.kind/i
  );

  assert.throws(
    () =>
      validateStep5WorkflowState({
        version: 1,
        kind: 'await_external_observation',
        observation: {
          kind: 'not-a-target',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /observation\.kind/i
  );
});

test('executeIdempotentLateStageAction writes a stable receipt and avoids duplicate adapter calls', async () => {
  const repoRoot = makeRepoRoot();
  let adapterCalls = 0;

  const first = await executeIdempotentLateStageAction({
    repoRoot,
    runId: 'run-step5-action',
    beadsId: 'bd-step5-action',
    action: makeAction(),
    performLateStageAction: async action => {
      adapterCalls += 1;
      return {
        commentId: 'comment-123',
        echoedBody: action.commentBody,
      };
    },
  });

  const second = await executeIdempotentLateStageAction({
    repoRoot,
    runId: 'run-step5-action',
    beadsId: 'bd-step5-action',
    action: makeAction(),
    performLateStageAction: async () => {
      adapterCalls += 1;
      return {
        commentId: 'comment-456',
      };
    },
  });

  assert.equal(adapterCalls, 1);
  assert.equal(first.receiptRef, second.receiptRef);
  assert.equal(second.reused, true);
  assert.equal(first.receiptRef, buildActionReceiptRef('followup-comment-1'));

  const written = JSON.parse(fs.readFileSync(path.join(repoRoot, first.receiptRef), 'utf8'));
  assert.equal(written.action.kind, 'post_pr_comment');
  assert.equal(written.result.commentId, 'comment-123');
});
