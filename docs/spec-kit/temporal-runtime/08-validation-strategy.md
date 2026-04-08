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

### Replay And Idempotency Tests

Each side-effecting activity should be tested for replay safety where relevant.

Examples:

- creating a PR twice does not create duplicates
- posting the same status comment twice does not spam
- re-running materialization does not silently create conflicting BEADS tasks

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

## Acceptance Standard

The implementation is on track only if the operator can eventually trust this experience:

1. create or schedule a task
2. leave it unattended
3. come back later
4. understand exactly what happened
5. see clearly what now requires human action

If a phase adds machinery without improving that confidence, the validation strategy should treat it as suspect even if unit tests pass.
