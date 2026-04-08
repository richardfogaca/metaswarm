# Temporal Runtime Implementation Plan

**Date**: 2026-04-08
**Status**: Active implementation plan
**Version**: 1.0

**Design Doc**: [2026-04-08-temporal-runtime-design.md](/Users/richard/git/personal/metaswarm/docs/plans/2026-04-08-temporal-runtime-design.md)

## Goal

Implement the Temporal-backed runtime around metaswarm in restricted, testable slices until the system can safely run unattended work while preserving metaswarm policy and BEADS authority.

## Plan Shape

This plan records the implementation order, the scope of each restricted slice, and the validation bar for advancing the runtime.

The rule is simple:

- do not widen scope until the current slice is proven

## Implemented Slices

### Step 1: Runtime Skeleton

Proved:

- one workflow per issue
- immediate completion and timer-based sleep
- deterministic wakeup behavior
- per-run review artifact emission
- restart survival

### Step 2: Task Definitions

Proved:

- typed task-definition loading and validation
- ad hoc launch normalization
- pre-workflow materialization
- explicit launch record persistence

### Step 3: Schedule Definitions

Proved:

- delayed one-off schedule definitions
- schedule-triggered launch normalization
- Temporal `startDelay` as runtime timer truth

### Step 3 Expansion: Recurring Scheduler Slice

Proved:

- recurring schedule definitions
- scheduler-owned recurring workflow per schedule
- overlap and catchup restricted profiles
- occurrence-scoped run ids and workflow ids

### Step 4: BEADS-Backed Workflow State

Proved:

- workflow reconciliation against authoritative BEADS state
- timer wake reconciliation
- blocked and approval wait states
- wake signals treated as wakeups only

### Step 5: Late-Stage Durability

Proved:

- replay-safe late-stage actions keyed by durable action ids
- external observation targeting for CI, review comments, and PR shepherd waits
- derived action receipts

### Step 6: Spec-To-Plan Lane

Proved:

- idempotent planning actions
- persisted planning artifacts
- BEADS-backed stop behavior at approval gates

### Step 7: Work-Unit Execution

Proved:

- restricted work-unit execution lane inside the parent workflow
- idempotent artifacts for work-unit actions
- fresh review retries modeled as new action identities

### Step 8: Operator Status Surface

Proved:

- CLI status view over launch records, review artifacts, and optional live Temporal inspection
- status lookup by latest, run id, workflow id, or beads id
- artifact-only fallback when live Temporal inspection is unavailable

### Step 9: Local Development Stack

Proved:

- Docker Compose stack for local Temporal services
- real host-side worker run mode
- shared runtime config
- live local smoke validation of delayed scheduled execution

## Validation Standard

Every slice must satisfy the same validation model:

1. Contract tests
2. Deterministic workflow tests
3. Activity or adapter tests
4. Scenario or end-to-end tests when the slice changes operator-visible behavior

No slice is considered done until:

- replay and idempotency are tested where relevant
- wake and resume behavior is tested where relevant
- artifacts or status surfaces are tested where relevant
- the slice has a narrow, explicit restricted profile

## Non-Negotiable Rules

- TDD is mandatory
- BEADS remains workflow-facing truth
- Temporal remains runtime truth
- materialization finishes before workflow start
- signals never bypass BEADS truth
- derived artifacts never become authority
- parent-owned workflow execution stays the default

## Current Runtime Capabilities

The runtime now supports:

- ad hoc launches
- delayed one-off schedules
- recurring schedules
- BEADS-backed workflow reconciliation
- late-stage waits and idempotent late-stage actions
- spec-to-plan and work-unit action lanes
- operator status inspection
- local Temporal development services and host worker startup

## Remaining Work

The next slices should stay in repo-native documentation and keep the same restricted-slice posture.

The most obvious remaining work is:

- `temporal watch` and structured runtime event surfaces
- richer schedule lifecycle operations
- broader work-unit execution semantics
- carefully scoped parallel execution only after non-parallel execution is operationally trustworthy
- additional operator ergonomics once the runtime surfaces stabilize

## How To Extend This Plan

Future Temporal work should follow the same repo convention used elsewhere:

- new major design shifts get a new dated design doc in `docs/plans/`
- new implementation slices extend this plan or add a new dated companion plan when the topic is large enough
- stable runtime behavior graduates into [guides/temporal-runtime.md](/Users/richard/git/personal/metaswarm/guides/temporal-runtime.md)

Do not reintroduce a parallel documentation taxonomy for Temporal alone.
