#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  loadScheduleDefinition,
  prepareScheduledLaunch,
  validateScheduleDefinition,
} = require(path.join(ROOT, 'lib/runtime/temporal/schedules'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step3-schedules-'));
}

function writeJson(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTaskDefinition(overrides = {}) {
  return {
    version: 1,
    taskDefinitionId: 'taskdef-scheduled-step3',
    name: 'Scheduled Step 3 task',
    mode: 'scheduled_once',
    materialization: {
      kind: 'existing_beads_issue',
      beadsId: 'bd-step3-existing',
    },
    ...overrides,
  };
}

function makeScheduleDefinition(overrides = {}) {
  return {
    version: 1,
    scheduleId: 'sched-step3-once',
    taskDefinitionId: 'taskdef-scheduled-step3',
    state: 'active',
    trigger: {
      kind: 'once',
      startAt: '2026-04-09T02:00:00.000Z',
    },
    overlapPolicy: 'skip',
    catchupPolicy: 'none',
    ...overrides,
  };
}

test('validateScheduleDefinition accepts the restricted delayed-once profile', () => {
  const scheduleDefinition = validateScheduleDefinition(makeScheduleDefinition());

  assert.equal(scheduleDefinition.trigger.kind, 'once');
  assert.equal(scheduleDefinition.overlapPolicy, 'skip');
  assert.equal(scheduleDefinition.catchupPolicy, 'none');
});

test('validateScheduleDefinition rejects malformed and unsupported restricted-profile shapes', () => {
  assert.throws(
    () =>
      validateScheduleDefinition(
        makeScheduleDefinition({
          trigger: {
            kind: 'once',
            startAt: 'not-a-timestamp',
          },
        })
      ),
    /startAt/i
  );

  assert.throws(
    () =>
      validateScheduleDefinition(
        makeScheduleDefinition({
          overlapPolicy: 'allow_parallel',
        })
      ),
    /overlapPolicy/i
  );

  assert.throws(
    () =>
      validateScheduleDefinition(
        makeScheduleDefinition({
          catchupPolicy: 'within_window',
          catchupWindowMinutes: 30,
        })
      ),
    /catchupPolicy/i
  );
});

test('loadScheduleDefinition rejects malformed JSON and file/id mismatches', () => {
  const repoRoot = makeRepoRoot();
  const schedulesDir = path.join(repoRoot, '.metaswarm', 'runtime', 'schedules');
  fs.mkdirSync(schedulesDir, { recursive: true });

  fs.writeFileSync(path.join(schedulesDir, 'broken.json'), '{"version": 1,');
  assert.throws(
    () => loadScheduleDefinition({ repoRoot, scheduleId: 'broken' }),
    /JSON/i
  );

  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-file-name.json',
    makeScheduleDefinition({
      scheduleId: 'sched-different-id',
    })
  );

  assert.throws(
    () => loadScheduleDefinition({ repoRoot, scheduleId: 'sched-file-name' }),
    /file name/i
  );
});

test('prepareScheduledLaunch rejects paused schedules, task-definition mismatches, and create-new materialization', async () => {
  const repoRoot = makeRepoRoot();

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-scheduled-step3.json',
    makeTaskDefinition()
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-paused-step3.json',
    makeScheduleDefinition({
      scheduleId: 'sched-paused-step3',
      state: 'paused',
    })
  );

  await assert.rejects(
    () =>
      prepareScheduledLaunch({
        repoRoot,
        scheduleId: 'sched-paused-step3',
        now: '2026-04-08T21:00:00.000Z',
      }),
    /paused/i
  );

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-wrong-mode-step3.json',
    makeTaskDefinition({
      taskDefinitionId: 'taskdef-wrong-mode-step3',
      mode: 'ad_hoc',
    })
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-wrong-mode-step3.json',
    makeScheduleDefinition({
      scheduleId: 'sched-wrong-mode-step3',
      taskDefinitionId: 'taskdef-wrong-mode-step3',
    })
  );

  await assert.rejects(
    () =>
      prepareScheduledLaunch({
        repoRoot,
        scheduleId: 'sched-wrong-mode-step3',
        now: '2026-04-08T21:00:00.000Z',
      }),
    /scheduled_once/i
  );

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-create-new-step3.json',
    makeTaskDefinition({
      taskDefinitionId: 'taskdef-create-new-step3',
      materialization: {
        kind: 'create_beads_issue',
        issueType: 'task',
        titleTemplate: 'Create new {run_id}',
      },
    })
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-create-new-step3.json',
    makeScheduleDefinition({
      scheduleId: 'sched-create-new-step3',
      taskDefinitionId: 'taskdef-create-new-step3',
    })
  );

  await assert.rejects(
    () =>
      prepareScheduledLaunch({
        repoRoot,
        scheduleId: 'sched-create-new-step3',
        now: '2026-04-08T21:00:00.000Z',
      }),
    /existing BEADS issue/i
  );
});

test('prepareScheduledLaunch normalizes delayed-once scheduling into the shared workflow input and launch record model', async () => {
  const repoRoot = makeRepoRoot();

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-scheduled-step3.json',
    makeTaskDefinition()
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-step3-once.json',
    makeScheduleDefinition()
  );

  const prepared = await prepareScheduledLaunch({
    repoRoot,
    scheduleId: 'sched-step3-once',
    now: '2026-04-08T21:00:00.000Z',
  });

  assert.equal(prepared.workflowInput.triggerType, 'scheduled_once');
  assert.equal(prepared.workflowInput.initiatedBy, 'schedule');
  assert.equal(prepared.workflowInput.scheduleId, 'sched-step3-once');
  assert.deepEqual(prepared.workflowInput.beadsTarget, {
    kind: 'existing',
    beadsId: 'bd-step3-existing',
  });
  assert.equal(prepared.launchRecord.runtimeStart.mode, 'delayed_once');
  assert.equal(prepared.launchRecord.runtimeStart.scheduledFor, '2026-04-09T02:00:00.000Z');
  assert.ok(prepared.launchRecord.runtimeStart.startDelayMs > 0);
});
