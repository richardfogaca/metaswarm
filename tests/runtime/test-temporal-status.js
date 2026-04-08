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
const {
  DEFAULT_TEMPORAL_TASK_QUEUE,
  ensureRuntimeDirectories,
} = require(path.join(ROOT, 'lib/runtime/temporal/bootstrap'));
const { createTemporalActivities } = require(path.join(ROOT, 'lib/runtime/temporal/activities'));
const { buildSummaryRef, materializeRunSummary } = require(path.join(
  ROOT,
  'lib/runtime/temporal/review-artifacts'
));
const { materializeLaunchRecord } = require(path.join(ROOT, 'lib/runtime/temporal/launch-records'));
const {
  deriveWorkflowIdFromLaunchRecord,
  formatTemporalRunStatus,
  loadTemporalRunStatus,
  parseStatusCommandArgs,
} = require(path.join(ROOT, 'lib/runtime/temporal/status'));
const { launchScheduledTask } = require(path.join(ROOT, 'lib/runtime/temporal/schedules'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step8-status-'));
}

function writeJson(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeLaunchRecord(repoRoot, launchRecord) {
  return materializeLaunchRecord({
    repoRoot,
    launchRecord,
  });
}

async function writeReviewArtifact(repoRoot, artifact) {
  return materializeRunSummary({
    repoRoot,
    artifact,
  });
}

function makeLaunchRecord({
  runId,
  beadsId = 'bd-step8-status',
  triggerType = 'ad_hoc',
  taskDefinitionId = 'taskdef-step8-status',
  initiatedAt = '2026-04-08T12:00:00.000Z',
  initiatedBy = 'operator',
  scheduleId,
  runtimeStart,
}) {
  return {
    version: 1,
    runId,
    taskDefinitionId,
    triggerType,
    scheduleId,
    initiatedAt,
    initiatedBy,
    materialization: {
      sourceKind: 'existing_beads_issue',
      resolvedBeadsId: beadsId,
      created: false,
    },
    runtimeStart,
    workflowInput: {
      version: 1,
      runId,
      triggerType,
      taskDefinitionId,
      scheduleId,
      beadsTarget: {
        kind: 'existing',
        beadsId,
      },
      initiatedAt,
      initiatedBy,
      runtimeSkeleton: {
        mode: 'complete',
      },
    },
  };
}

function makeReviewArtifact({
  runId,
  beadsId = 'bd-step8-status',
  triggerType = 'ad_hoc',
  taskDefinitionId = 'taskdef-step8-status',
  scheduleId,
  runtimeStatus = 'completed',
  startedAt = '2026-04-08T12:00:00.000Z',
  endedAt = '2026-04-08T12:05:00.000Z',
  blockers = [],
  humanActionRequired = null,
  acceptedChanges = ['Validated change'],
}) {
  return {
    version: 1,
    runId,
    beadsId,
    taskDefinitionId,
    scheduleId,
    triggerType,
    runtimeStatus,
    startedAt,
    endedAt,
    stepsAttempted: ['runtime-skeleton'],
    acceptedChanges,
    validationSummary: {
      status: 'passed',
      checks: ['unit'],
    },
    blockers,
    humanActionRequired,
  };
}

function makeScheduledTaskDefinition() {
  return {
    version: 1,
    taskDefinitionId: 'taskdef-step8-scheduled',
    name: 'Step 8 scheduled task',
    mode: 'scheduled_once',
    materialization: {
      kind: 'existing_beads_issue',
      beadsId: 'bd-step8-scheduled',
    },
  };
}

function makeScheduleDefinition(startAt) {
  return {
    version: 1,
    scheduleId: 'sched-step8-once',
    taskDefinitionId: 'taskdef-step8-scheduled',
    state: 'active',
    trigger: {
      kind: 'once',
      startAt,
    },
    overlapPolicy: 'skip',
    catchupPolicy: 'none',
  };
}

test('parseStatusCommandArgs accepts exactly one selector and optional json flag', () => {
  const parsed = parseStatusCommandArgs(['--run-id', 'run-step8', '--json']);
  assert.deepEqual(parsed, {
    selector: {
      kind: 'run_id',
      runId: 'run-step8',
    },
    json: true,
  });
});

test('parseStatusCommandArgs rejects ambiguous and malformed selectors', () => {
  assert.throws(() => parseStatusCommandArgs([]), /exactly one selector/i);
  assert.throws(
    () => parseStatusCommandArgs(['--latest', '--run-id', 'run-step8']),
    /exactly one selector/i
  );
  assert.throws(() => parseStatusCommandArgs(['--run-id']), /requires a value/i);
  assert.throws(() => parseStatusCommandArgs(['--bogus']), /unknown flag/i);
});

test('deriveWorkflowIdFromLaunchRecord maps ad hoc, delayed-once, and recurring launches', () => {
  assert.equal(
    deriveWorkflowIdFromLaunchRecord(
      makeLaunchRecord({
        runId: 'run-step8-ad-hoc',
      })
    ),
    'issue-bd-step8-status'
  );

  assert.equal(
    deriveWorkflowIdFromLaunchRecord(
      makeLaunchRecord({
        runId: 'run-step8-once',
        triggerType: 'scheduled_once',
        scheduleId: 'sched-step8-once',
        initiatedBy: 'schedule',
        runtimeStart: {
          mode: 'delayed_once',
          scheduledFor: '2026-04-08T12:10:00.000Z',
          startDelayMs: 60000,
        },
      })
    ),
    'issue-bd-step8-status-schedule-sched-step8-once'
  );

  assert.equal(
    deriveWorkflowIdFromLaunchRecord(
      makeLaunchRecord({
        runId: 'run-step8-recurring',
        triggerType: 'recurring',
        scheduleId: 'sched-step8-recurring',
        initiatedBy: 'schedule',
        runtimeStart: {
          mode: 'recurring',
          scheduledFor: '2026-04-08T12:10:00.000Z',
          occurrenceKey: '2026-04-08T12:10',
        },
      })
    ),
    'issue-bd-step8-status-schedule-sched-step8-recurring-run-run-step8-recurring'
  );
});

test('loadTemporalRunStatus uses latest matching initiatedAt rather than file ordering', async () => {
  const repoRoot = makeRepoRoot();
  ensureRuntimeDirectories(repoRoot);

  await writeLaunchRecord(
    repoRoot,
    makeLaunchRecord({
      runId: 'run-step8-old',
      beadsId: 'bd-shared',
      initiatedAt: '2026-04-08T10:00:00.000Z',
    })
  );
  await writeLaunchRecord(
    repoRoot,
    makeLaunchRecord({
      runId: 'run-step8-new',
      beadsId: 'bd-shared',
      initiatedAt: '2026-04-08T11:00:00.000Z',
    })
  );

  const latest = await loadTemporalRunStatus({
    repoRoot,
    selector: { kind: 'latest' },
  });
  assert.equal(latest.runId, 'run-step8-new');

  const byBeadsId = await loadTemporalRunStatus({
    repoRoot,
    selector: { kind: 'beads_id', beadsId: 'bd-shared' },
  });
  assert.equal(byBeadsId.runId, 'run-step8-new');

  const byWorkflowId = await loadTemporalRunStatus({
    repoRoot,
    selector: { kind: 'workflow_id', workflowId: 'issue-bd-shared' },
  });
  assert.equal(byWorkflowId.runId, 'run-step8-new');
});

test('loadTemporalRunStatus preserves sleeping review status over Temporal RUNNING', async () => {
  const repoRoot = makeRepoRoot();
  const launchRecord = makeLaunchRecord({
    runId: 'run-step8-sleeping',
    triggerType: 'scheduled_once',
    scheduleId: 'sched-step8-sleeping',
    initiatedBy: 'schedule',
    runtimeStart: {
      mode: 'delayed_once',
      scheduledFor: '2026-04-08T12:10:00.000Z',
      startDelayMs: 60000,
    },
  });

  await writeLaunchRecord(repoRoot, launchRecord);
  await writeReviewArtifact(
    repoRoot,
    makeReviewArtifact({
      runId: 'run-step8-sleeping',
      triggerType: 'scheduled_once',
      scheduleId: 'sched-step8-sleeping',
      runtimeStatus: 'sleeping',
      blockers: ['Waiting for timer wakeup'],
      acceptedChanges: [],
    })
  );

  const status = await loadTemporalRunStatus({
    repoRoot,
    selector: { kind: 'run_id', runId: 'run-step8-sleeping' },
    inspectTemporalWorkflow: async () => ({
      temporalWorkflowStatus: 'RUNNING',
    }),
  });

  assert.equal(status.runtimeStatus, 'sleeping');
  assert.equal(status.runtimeStatusSource, 'review_artifact');
  assert.equal(status.temporalWorkflowStatus, 'RUNNING');
});

test('loadTemporalRunStatus degrades to artifact-only status when live inspection is not configured', async () => {
  const repoRoot = makeRepoRoot();
  await writeLaunchRecord(
    repoRoot,
    makeLaunchRecord({
      runId: 'run-step8-artifact-only',
    })
  );
  await writeReviewArtifact(
    repoRoot,
    makeReviewArtifact({
      runId: 'run-step8-artifact-only',
      runtimeStatus: 'blocked',
      blockers: ['Waiting for human approval'],
      humanActionRequired: 'Approve the run',
    })
  );

  const status = await loadTemporalRunStatus({
    repoRoot,
    selector: { kind: 'run_id', runId: 'run-step8-artifact-only' },
    env: {},
  });

  assert.equal(status.runtimeStatus, 'blocked');
  assert.equal(status.runtimeStatusSource, 'review_artifact');
  assert.equal(status.temporalWorkflowStatus, null);
  assert.match(status.warnings[0], /artifact-only status/i);
});

test('loadTemporalRunStatus degrades cleanly when live inspection fails', async () => {
  const repoRoot = makeRepoRoot();
  await writeLaunchRecord(
    repoRoot,
    makeLaunchRecord({
      runId: 'run-step8-live-failure',
    })
  );
  await writeReviewArtifact(
    repoRoot,
    makeReviewArtifact({
      runId: 'run-step8-live-failure',
      runtimeStatus: 'completed',
    })
  );

  const status = await loadTemporalRunStatus({
    repoRoot,
    selector: { kind: 'run_id', runId: 'run-step8-live-failure' },
    inspectTemporalWorkflow: async () => ({
      temporalWorkflowStatus: null,
      warning: 'Live Temporal inspection failed for issue-bd-step8-status: unavailable',
    }),
  });

  assert.equal(status.runtimeStatus, 'completed');
  assert.equal(status.runtimeStatusSource, 'review_artifact');
  assert.match(status.warnings[0], /Live Temporal inspection failed/i);
});

test('loadTemporalRunStatus falls back to launch-only status when no summary exists yet', async () => {
  const repoRoot = makeRepoRoot();
  await writeLaunchRecord(
    repoRoot,
    makeLaunchRecord({
      runId: 'run-step8-launch-only',
      triggerType: 'scheduled_once',
      scheduleId: 'sched-step8-launch-only',
      initiatedBy: 'schedule',
      runtimeStart: {
        mode: 'delayed_once',
        scheduledFor: '2026-04-08T12:10:00.000Z',
        startDelayMs: 60000,
      },
    })
  );

  const status = await loadTemporalRunStatus({
    repoRoot,
    selector: { kind: 'run_id', runId: 'run-step8-launch-only' },
    env: {},
  });

  assert.equal(status.runtimeStatus, 'unknown');
  assert.equal(status.runtimeStatusSource, 'derived');
  assert.equal(status.summaryRef, null);
  assert.match(status.warnings[0], /artifact-only status/i);
});

test('formatTemporalRunStatus renders a concise human-readable summary', () => {
  const output = formatTemporalRunStatus({
    version: 1,
    selector: { kind: 'run_id', runId: 'run-step8-format' },
    runId: 'run-step8-format',
    workflowId: 'issue-bd-step8-format',
    beadsId: 'bd-step8-format',
    triggerType: 'ad_hoc',
    taskDefinitionId: 'taskdef-step8-format',
    runtimeStatus: 'blocked',
    runtimeStatusSource: 'review_artifact',
    temporalWorkflowStatus: 'RUNNING',
    initiatedAt: '2026-04-08T12:00:00.000Z',
    endedAt: '2026-04-08T12:05:00.000Z',
    blockers: ['Waiting for human approval'],
    humanActionRequired: 'Approve the run',
    launchRef: '.metaswarm/runtime/launches/run-step8-format.json',
    summaryRef: '.metaswarm/runtime/reviews/run-step8-format.json',
    acceptedChanges: ['Drafted the plan'],
    validationSummary: {
      status: 'passed',
      checks: ['unit'],
    },
    warnings: ['Artifact-only status view'],
  });

  assert.match(output, /run-step8-format/);
  assert.match(output, /runtime status:\s+blocked/);
  assert.match(output, /temporal status:\s+RUNNING/);
  assert.match(output, /Waiting for human approval/);
  assert.match(output, /Approve the run/);
});

test('status scenario inspects a delayed scheduled run after launch and after completion', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const repoRoot = makeRepoRoot();
  const now = new Date(await env.currentTimeMs()).toISOString();
  const startAt = new Date((await env.currentTimeMs()) + 60 * 60 * 1000).toISOString();

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-step8-scheduled.json',
    makeScheduledTaskDefinition()
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-step8-once.json',
    makeScheduleDefinition(startAt)
  );

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: createTemporalActivities({ repoRoot }),
  });

  try {
    await worker.runUntil(async () => {
      const launch = await launchScheduledTask({
        repoRoot,
        scheduleId: 'sched-step8-once',
        now,
        client: env.client,
      });

      const statusAfterLaunch = await loadTemporalRunStatus({
        repoRoot,
        selector: {
          kind: 'run_id',
          runId: launch.workflowInput.runId,
        },
        client: env.client,
      });

      assert.equal(statusAfterLaunch.runId, launch.workflowInput.runId);
      assert.equal(statusAfterLaunch.runtimeStatus, 'running');
      assert.equal(statusAfterLaunch.temporalWorkflowStatus, 'RUNNING');
      assert.equal(statusAfterLaunch.summaryRef, null);

      await launch.handle.result();

      const statusAfterCompletion = await loadTemporalRunStatus({
        repoRoot,
        selector: {
          kind: 'run_id',
          runId: launch.workflowInput.runId,
        },
        client: env.client,
      });

      assert.equal(statusAfterCompletion.runtimeStatus, 'completed');
      assert.equal(statusAfterCompletion.temporalWorkflowStatus, 'COMPLETED');
      assert.equal(
        statusAfterCompletion.summaryRef,
        buildSummaryRef(launch.workflowInput.runId)
      );
      assert.equal(statusAfterCompletion.scheduleId, 'sched-step8-once');
    });
  } finally {
    await env.teardown();
  }
});
