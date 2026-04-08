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
const ACTION_RECEIPTS_DIRNAME = 'action-receipts';
const WORKFLOWS_PATH = require.resolve('./workflows');

function resolveRuntimePaths(repoRoot = process.cwd()) {
  const runtimeRoot = path.join(repoRoot, ...RUNTIME_DIR_SEGMENTS);

  return {
    repoRoot,
    runtimeRoot,
    taskDefinitionsDir: path.join(runtimeRoot, TASK_DEFINITIONS_DIRNAME),
    launchesDir: path.join(runtimeRoot, LAUNCHES_DIRNAME),
    schedulesDir: path.join(runtimeRoot, SCHEDULES_DIRNAME),
    reviewsDir: path.join(runtimeRoot, REVIEWS_DIRNAME),
    actionReceiptsDir: path.join(runtimeRoot, ACTION_RECEIPTS_DIRNAME),
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

function toScheduledWorkflowId(beadsId, scheduleId) {
  if (typeof beadsId !== 'string' || beadsId.trim() === '') {
    throw new TypeError('beadsId must be a non-empty string');
  }

  if (typeof scheduleId !== 'string' || scheduleId.trim() === '') {
    throw new TypeError('scheduleId must be a non-empty string');
  }

  return `issue-${beadsId}-schedule-${scheduleId}`;
}

function toRecurringWorkflowId(beadsId, scheduleId, runId) {
  if (typeof beadsId !== 'string' || beadsId.trim() === '') {
    throw new TypeError('beadsId must be a non-empty string');
  }

  if (typeof scheduleId !== 'string' || scheduleId.trim() === '') {
    throw new TypeError('scheduleId must be a non-empty string');
  }

  if (typeof runId !== 'string' || runId.trim() === '') {
    throw new TypeError('runId must be a non-empty string');
  }

  return `issue-${beadsId}-schedule-${scheduleId}-run-${runId}`;
}

function toScheduleWorkflowId(scheduleId) {
  if (typeof scheduleId !== 'string' || scheduleId.trim() === '') {
    throw new TypeError('scheduleId must be a non-empty string');
  }

  return `schedule-${scheduleId}`;
}

function createWorkerBootstrapOptions({ repoRoot = process.cwd(), activities = {} } = {}) {
  return {
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities,
    repoRoot,
  };
}

module.exports = {
  ACTION_RECEIPTS_DIRNAME,
  DEFAULT_TEMPORAL_TASK_QUEUE,
  LAUNCHES_DIRNAME,
  REVIEWS_DIRNAME,
  SCHEDULES_DIRNAME,
  TASK_DEFINITIONS_DIRNAME,
  createWorkerBootstrapOptions,
  ensureRuntimeDirectories,
  resolveRuntimePaths,
  toIssueWorkflowId,
  toRecurringWorkflowId,
  toScheduleWorkflowId,
  toScheduledWorkflowId,
  WORKFLOWS_PATH,
};
