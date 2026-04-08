#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  loadTaskDefinition,
  validateTaskDefinition,
} = require(path.join(ROOT, 'lib/runtime/temporal/task-definitions'));
const { prepareAdHocLaunch } = require(path.join(ROOT, 'lib/runtime/temporal/ad-hoc-launch'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step2-taskdefs-'));
}

function writeJson(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, value);
}

function makeAdHocExistingTaskDefinition(overrides = {}) {
  return {
    version: 1,
    taskDefinitionId: 'taskdef-existing-step2',
    name: 'Existing Step 2 task',
    mode: 'ad_hoc',
    materialization: {
      kind: 'existing_beads_issue',
      beadsId: 'bd-1234',
    },
    runtimePolicy: {
      allowOvernight: true,
      summaryRequired: true,
    },
    ...overrides,
  };
}

function makeAdHocCreateTaskDefinition(overrides = {}) {
  return {
    version: 1,
    taskDefinitionId: 'taskdef-create-step2',
    name: 'Create Step 2 task',
    mode: 'ad_hoc',
    materialization: {
      kind: 'create_beads_issue',
      issueType: 'task',
      titleTemplate: 'Nightly run {yyyy}-{mm}-{dd} {run_id}',
      descriptionTemplateRef: 'templates/runtime/nightly.md',
      labels: ['automation', 'nightly'],
      priority: 2,
    },
    ...overrides,
  };
}

function makeAdHocRequest(overrides = {}) {
  return {
    version: 1,
    taskDefinitionId: 'taskdef-existing-step2',
    initiatedAt: '2026-04-08T21:00:00.000Z',
    initiatedBy: 'operator',
    runId: 'run-step2-ad-hoc',
    runtimeSkeleton: {
      mode: 'complete',
    },
    ...overrides,
  };
}

test('validateTaskDefinition accepts explicit existing-target and create-new shapes', () => {
  const existing = validateTaskDefinition(makeAdHocExistingTaskDefinition());
  const createNew = validateTaskDefinition(makeAdHocCreateTaskDefinition());

  assert.equal(existing.materialization.kind, 'existing_beads_issue');
  assert.equal(createNew.materialization.kind, 'create_beads_issue');
  assert.equal(createNew.materialization.issueType, 'task');
});

test('validateTaskDefinition rejects malformed create-new materialization', () => {
  assert.throws(
    () =>
      validateTaskDefinition(
        makeAdHocCreateTaskDefinition({
          materialization: {
            kind: 'create_beads_issue',
            titleTemplate: 'Missing issue type',
          },
        })
      ),
    /issueType/i
  );

  assert.throws(
    () =>
      validateTaskDefinition(
        makeAdHocCreateTaskDefinition({
          materialization: {
            kind: 'create_beads_issue',
            issueType: 'task',
            titleTemplate: 'Bad priority',
            priority: 9,
          },
        })
      ),
    /priority/i
  );
});

test('loadTaskDefinition rejects malformed JSON and file/id mismatches', () => {
  const repoRoot = makeRepoRoot();
  const taskDefinitionsDir = path.join(repoRoot, '.metaswarm', 'runtime', 'task-definitions');
  fs.mkdirSync(taskDefinitionsDir, { recursive: true });

  fs.writeFileSync(path.join(taskDefinitionsDir, 'broken.json'), '{"version": 1,');
  assert.throws(
    () => loadTaskDefinition({ repoRoot, taskDefinitionId: 'broken' }),
    /JSON/i
  );

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-file-name.json',
    makeAdHocExistingTaskDefinition({
      taskDefinitionId: 'taskdef-different-id',
    })
  );

  assert.throws(
    () => loadTaskDefinition({ repoRoot, taskDefinitionId: 'taskdef-file-name' }),
    /file name/i
  );
});

test('prepareAdHocLaunch writes an explicit launch record for create-new materialization', async () => {
  const repoRoot = makeRepoRoot();
  const taskDefinition = makeAdHocCreateTaskDefinition();

  writeJson(
    repoRoot,
    `.metaswarm/runtime/task-definitions/${taskDefinition.taskDefinitionId}.json`,
    taskDefinition
  );
  writeText(
    repoRoot,
    'templates/runtime/nightly.md',
    'Generated from {task_definition_id} on {yyyy}-{mm}-{dd}.'
  );

  const prepared = await prepareAdHocLaunch({
    repoRoot,
    request: makeAdHocRequest({
      taskDefinitionId: taskDefinition.taskDefinitionId,
      runId: 'run-step2-create-launch',
    }),
    createBeadsIssue: async createRequest => {
      assert.equal(createRequest.issueType, 'task');
      assert.match(createRequest.title, /run-step2-create-launch/);
      assert.match(createRequest.description, /taskdef-create-step2/);
      return {
        beadsId: 'bd-created-step2',
      };
    },
  });

  assert.equal(prepared.workflowInput.beadsTarget.kind, 'existing');
  assert.equal(prepared.workflowInput.beadsTarget.beadsId, 'bd-created-step2');
  assert.equal(prepared.launchRef, '.metaswarm/runtime/launches/run-step2-create-launch.json');

  const written = JSON.parse(fs.readFileSync(path.join(repoRoot, prepared.launchRef), 'utf8'));
  assert.equal(written.materialization.sourceKind, 'create_beads_issue');
  assert.equal(written.materialization.created, true);
  assert.equal(written.materialization.resolvedBeadsId, 'bd-created-step2');
  assert.equal(written.workflowInput.beadsTarget.kind, 'existing');
});

test('prepareAdHocLaunch rejects non-ad-hoc task definitions in Step 2', async () => {
  const repoRoot = makeRepoRoot();
  const taskDefinition = makeAdHocExistingTaskDefinition({
    taskDefinitionId: 'taskdef-scheduled-step2',
    mode: 'scheduled_once',
  });

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-scheduled-step2.json',
    taskDefinition
  );

  await assert.rejects(
    () =>
      prepareAdHocLaunch({
        repoRoot,
        request: makeAdHocRequest({
          taskDefinitionId: 'taskdef-scheduled-step2',
          runId: 'run-step2-scheduled-reject',
        }),
      }),
    /ad_hoc/i
  );
});
