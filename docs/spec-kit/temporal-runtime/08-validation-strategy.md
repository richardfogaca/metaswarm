# Validation Strategy

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Purpose

This document defines how the Temporal runtime implementation should be validated.

Per-phase validation requirements belong in:

- [07-implementation-roadmap.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/07-implementation-roadmap.md)

This document defines the common validation model that every phase should use.

## Validation Goal

The goal is to know, with evidence, that:

- the architecture still matches the intended authority boundaries
- runtime behavior is deterministic where it must be deterministic
- unattended execution is actually safe
- the operator experience is trustworthy

## Validation Layers

Every phase should validate at four layers.

### 1. Contract Tests

Purpose:

- prove schemas and contracts accept valid inputs and reject invalid ones

Examples:

- task definition contract
- schedule definition contract
- workflow input/output contract
- morning review artifact contract

### 2. Deterministic Workflow Tests

Purpose:

- prove the workflow behaves correctly under fake time and controlled activity results

Examples:

- delayed start
- recurring cadence
- sleep and wake
- signal handling
- retry behavior
- reconciliation after wakeup

### 3. Activity / Adapter Tests

Purpose:

- prove side-effect boundaries behave correctly and remain replay-safe

Examples:

- BEADS reads and writes
- launch/materialization records
- worktree operations
- GitHub and CI observation normalization
- summary materialization
- PR and comment idempotency

### 4. Scenario / End-To-End Tests

Purpose:

- prove realistic operator-facing flows work end to end

Examples:

- ad hoc task run
- one-off scheduled task run
- recurring task run
- human-gated overnight pause/resume
- CI waiting and wakeup
- late-stage review follow-up

## Required Test Categories

### Schema Rejection Tests

Each contract should reject:

- missing required fields
- invalid enum values
- malformed timestamps
- invalid overlap/catchup combinations
- inconsistent materialization shapes
- create-new materialization shapes that cannot be mapped to `bd create`

### Replay And Idempotency Tests

Each side-effecting activity should be tested for replay safety where relevant.

Examples:

- creating a PR twice does not create duplicates
- posting the same status comment twice does not spam
- re-running materialization does not silently create conflicting BEADS tasks
- re-running launch-record materialization for the same run id does not hide what concrete BEADS target was selected

### Wakeup And Resume Tests

The runtime must prove:

- a workflow can sleep and resume deterministically
- a wakeup causes BEADS reconciliation before action
- a signal alone does not count as approval

### Schedule Semantics Tests

The runtime must prove:

- delayed schedules fire once
- recurring schedules fire on cadence
- overlap policy works
- catchup policy works

### Summary Artifact Tests

The runtime must prove:

- a summary artifact is emitted on sleeping, blocked, failed, and completed outcomes
- the summary contains valid required fields
- the summary remains a read model and does not become authoritative state
- sleeping and blocked states are asserted through the artifact or workflow inspection surface, not through workflow completion values

## Failure Injection

Validation should not rely only on happy paths.

Each phase should inject failures relevant to that phase.

Examples:

- worker restart during sleep
- activity timeout
- stale BEADS read followed by wakeup reconciliation
- duplicate signal delivery
- CI observation change mid-run
- review gate failure requiring retry

## Phase Exit Standard

A phase is considered proven only when:

1. its contract tests pass
2. its deterministic workflow tests pass
3. its critical activity tests pass
4. its scenario tests pass
5. its explicit phase exit gate in the roadmap is satisfied

If any of those are missing, the phase is not actually proven.

## Step 1 Practical Test Matrix

Step 1 should not proceed without these concrete tests:

1. input contract accepts the restricted Step 1 profile and rejects malformed timer directives
2. output contract accepts terminal workflow completion only
3. summary artifact contract accepts sleeping and completed artifacts for the same run id
4. workflow test proves immediate completion emits a valid artifact and terminal result
5. workflow test proves timer sleep emits a sleeping artifact, wakes deterministically, and then completes cleanly
6. activity test proves summary materialization can rewrite the same per-run artifact path idempotently

## Architectural Assertions To Re-Check Every Phase

The following assertions should be re-validated repeatedly:

1. BEADS remains workflow truth.
2. Temporal remains runtime truth.
3. scheduling metadata remains separate from workflow truth.
4. one top-level workflow still owns one issue or epic by default.
5. subtasks remain inside the parent workflow unless explicitly promoted.
6. morning review artifacts remain derived read models only.

## Step 2 Practical Test Matrix

Step 2 should not proceed without these concrete tests:

1. task-definition contract accepts valid ad hoc existing-target and create-new definitions
2. task-definition contract rejects create-new definitions missing BEADS creation inputs such as `issueType` or with invalid priority values
3. task-definition loader rejects file/id mismatches and malformed JSON
4. ad hoc launch tests prove existing-target and create-new paths both normalize to `IssueWorkflowInput` with one concrete `beadsTarget.kind: "existing"`
5. launch-record tests prove every ad hoc run writes an explicit record containing the resolved BEADS id and the normalized workflow input
6. scenario test proves an ad hoc launch can feed the Step 1 workflow and complete using the same runtime contract regardless of whether the BEADS target already existed or was created during launch

## Step 3 Practical Test Matrix

Step 3 should not proceed without these concrete tests:

1. schedule-definition contract accepts valid one-off delayed schedules and rejects malformed timestamps, unsupported overlap settings, and unsupported catchup settings in the restricted profile
2. schedule-definition loader rejects file/id mismatches and malformed JSON
3. scheduled-launch preparation rejects paused schedules, unsupported recurring schedules, past-or-immediate `startAt` values, task-definition mode mismatches, and create-new materialization in the restricted profile
4. deterministic schedule tests prove a delayed once launch starts the same top-level workflow after the requested delay and only once
5. scenario tests prove a schedule-triggered launch and an ad hoc launch converge on the same workflow input and launch-record shape apart from trigger-specific fields
6. launch-record tests prove schedule-triggered runs record `scheduleId`, `triggerType`, and delayed-start metadata without introducing repo-local schedule truth

## Step 3 Expansion Practical Test Matrix

The recurring scheduler slice should not proceed without these concrete tests:

1. schedule-definition contract accepts valid recurring definitions for the supported cadence kinds and rejects unsupported overlap/catchup combinations
2. recurring schedule preparation rejects paused schedules, task-definition mode mismatches, and malformed timezone or cadence shapes
3. deterministic workflow tests prove the scheduler workflow launches repeated occurrences on cadence and survives worker restart without losing its launch cursor
4. deterministic workflow tests prove `overlapPolicy: "skip"` suppresses overlapping occurrences while `allow_parallel` permits them
5. deterministic workflow tests prove `catchupPolicy: "none"` drops stale occurrences while `within_window` launches only the due occurrences still inside the configured window
6. launch tests prove recurring existing-target and recurring create-new schedules both emit explicit launch records with `scheduleId`, `scheduledFor`, and one concrete resolved BEADS target
7. scenario tests prove recurring launches feed the same issue-workflow contract as ad hoc and delayed-once launches apart from schedule-specific metadata

## Step 4 Practical Test Matrix

The restricted Step 4 slice should not proceed without these concrete tests:

1. workflow-state contract accepts the restricted BEADS-backed state shapes and rejects malformed sleep, approval, and observation waits
2. activity tests prove BEADS workflow-state reads parse authoritative metadata correctly and fail loudly when the required state is missing or malformed
3. deterministic workflow tests prove the workflow re-reads BEADS after timer wake before progressing
4. deterministic workflow tests prove a `human_approval` or `manual_resume` signal alone does not advance the workflow when BEADS state still says approval is pending
5. deterministic workflow tests prove that changing BEADS state and then delivering a wake signal allows safe continuation
6. deterministic workflow tests prove `await_external_observation` triggers the refresh activity before the workflow re-reads BEADS and decides whether it can continue
7. scenario tests prove blocked and sleeping summaries remain operator-facing state while the workflow stays open

## Step 5 Practical Test Matrix

The restricted Step 5 slice should not proceed without these concrete tests:

1. workflow-state contract accepts `run_late_stage_action` plus explicit late-stage observation targets and rejects malformed `actionKey`, unsupported action kinds, or malformed comment payloads
2. activity tests prove late-stage action execution is idempotent by `actionKey` and writes a stable derived receipt without invoking the underlying adapter twice
3. deterministic workflow tests prove `await_external_observation` with `observation.kind: "ci"` wakes only after `external_observation_changed`, refreshes CI observation, and then re-reads BEADS
4. deterministic workflow tests prove `await_external_observation` with `observation.kind: "pr_shepherd"` wakes on `pr_shepherd_tick`, refreshes PR observation, and then re-reads BEADS
5. deterministic workflow tests prove `run_late_stage_action` executes through the idempotent boundary, refreshes the relevant observation, and does not duplicate side effects when BEADS still returns the same action state on the next loop
6. scenario tests prove a review-comment follow-up path can wait, wake, execute a follow-up comment action, reconcile, and complete while summaries remain derived read models

## Acceptance Standard

The implementation is on track only if the operator can eventually trust this experience:

1. create or schedule a task
2. leave it unattended
3. come back later
4. understand exactly what happened
5. see clearly what now requires human action

If a phase adds machinery without improving that confidence, the validation strategy should treat it as suspect even if unit tests pass.
