#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_TEMPORAL_TASK_QUEUE = 'metaswarm-runtime';
const RUNTIME_DIR_SEGMENTS = ['.metaswarm', 'runtime'];
const TASK_DEFINITIONS_DIRNAME = 'task-definitions';
const LAUNCHES_DIRNAME = 'launches';
const SCHEDULES_DIRNAME = 'schedules';
const REVIEWS_DIRNAME = 'reviews';

function resolveRuntimePaths(repoRoot = process.cwd()) {
  const runtimeRoot = path.join(repoRoot, ...RUNTIME_DIR_SEGMENTS);

  return {
    repoRoot,
    runtimeRoot,
    taskDefinitionsDir: path.join(runtimeRoot, TASK_DEFINITIONS_DIRNAME),
    launchesDir: path.join(runtimeRoot, LAUNCHES_DIRNAME),
    schedulesDir: path.join(runtimeRoot, SCHEDULES_DIRNAME),
    reviewsDir: path.join(runtimeRoot, REVIEWS_DIRNAME),
  };
}

function ensureRuntimeDirectories(repoRoot = process.cwd()) {
  const runtimePaths = resolveRuntimePaths(repoRoot);

  for (const dirPath of Object.values(runtimePaths).slice(1)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return runtimePaths;
}

function toIssueWorkflowId(beadsId) {
  if (typeof beadsId !== 'string' || beadsId.trim() === '') {
    throw new TypeError('beadsId must be a non-empty string');
  }

  return `issue-${beadsId}`;
}

function createWorkerBootstrapOptions({ repoRoot = process.cwd(), activities = {} } = {}) {
  return {
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('./workflows/issue-workflow'),
    activities,
    repoRoot,
  };
}

module.exports = {
  DEFAULT_TEMPORAL_TASK_QUEUE,
  LAUNCHES_DIRNAME,
  REVIEWS_DIRNAME,
  SCHEDULES_DIRNAME,
  TASK_DEFINITIONS_DIRNAME,
  createWorkerBootstrapOptions,
  ensureRuntimeDirectories,
  resolveRuntimePaths,
  toIssueWorkflowId,
};
