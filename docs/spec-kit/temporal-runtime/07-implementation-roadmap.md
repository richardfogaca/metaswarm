# Implementation Roadmap

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Goal

Move from research to implementation without losing architectural clarity.

## Implementation Order

### Step 1: Runtime Skeleton

Build:

- top-level workflow shell
- basic workflow input/output contract
- basic activity boundaries
- summary emission

Must prove:

- one workflow per issue works
- retries and wakeups are deterministic
- run summaries are emitted

Validation strategy:

- contract tests for workflow input/output and summary artifact shape
- deterministic workflow tests with fake time for sleep/wake behavior
- activity tests for summary materialization and idempotent retry handling
- scenario test for one issue run that sleeps and resumes cleanly

Phase exit gate:

- do not proceed until one issue workflow survives restart, emits a valid summary artifact, and demonstrates deterministic wakeup behavior

### Step 2: Task Definitions

Build:

- task definition loader and validator
- ad hoc task entry
- existing-BEADS and create-new materialization paths

Must prove:

- ad hoc tasks can launch safely
- materialization into BEADS is explicit and reproducible

Validation strategy:

- schema validation tests for task definition parsing and rejection
- materialization tests for existing-BEADS and create-new paths
- scenario tests proving that ad hoc launch and materialized launch converge on the same workflow input contract

Phase exit gate:

- do not proceed until task definitions can be validated and mapped to explicit BEADS targets without hidden assumptions

### Step 3: Schedule Definitions

Build:

- schedule definition loader and validator
- one-off delayed scheduling
- recurring scheduling

Must prove:

- one-off delayed tasks run once
- recurring tasks run on durable cadence
- schedule state stays outside workflow truth

Validation strategy:

- schema validation tests for schedule definitions
- deterministic fake-time tests for delayed and recurring schedule triggering
- overlap and catchup policy tests
- scenario tests proving scheduled launches and ad hoc launches converge on the same top-level workflow behavior

Phase exit gate:

- do not proceed until delayed and recurring schedules are deterministic, replay-safe, and clearly separate from BEADS workflow truth

### Step 4: Top-Level Workflow Behavior

Build:

- BEADS reconciliation at workflow start and wakeup
- next-step derivation
- signal handling
- external observation refresh

Must prove:

- workflow does not advance on stale assumptions
- human approval requires durable state before resume

Validation strategy:

- deterministic workflow tests for reconciliation after wakeup
- signal tests proving signal-only progression is rejected
- activity tests for BEADS reread behavior and external observation refresh
- scenario tests for pause, approval write, signal, reread, and safe continuation

Phase exit gate:

- do not proceed until stale-state progression and signal-only approval shortcuts are impossible in tested scenarios

### Step 5: Late-Stage Durability

Build:

- PR shepherd wakeups
- CI waiting
- review comment follow-up path

Must prove:

- overnight late-stage progress is reliable
- side effects are not duplicated on retry

Validation strategy:

- activity tests for idempotent PR and comment operations
- deterministic workflow tests for CI waiting and review-follow-up wakeups
- scenario tests covering CI failure, retry, resumed success, and review-comment handling

Phase exit gate:

- do not proceed until late-stage side effects are replay-safe and next-day summaries clearly explain the result

### Step 6: Spec-To-Plan Lane

Build:

- research
- planning
- plan review gate
- optional design review gate

Must prove:

- plan quality does not degrade
- overnight progress is meaningful

Validation strategy:

- scenario tests for research, planning, plan review, and optional design review
- output contract tests for persisted approved planning state
- regression-style acceptance checks comparing runtime-driven outcomes against intended metaswarm gate semantics

Phase exit gate:

- do not proceed until the runtime can produce planning progress overnight without weakening plan or design gate semantics

### Step 7: Work-Unit Execution

Build:

- implement
- validate
- adversarial review
- commit

Must prove:

- parent workflow coordination is sufficient by default
- idempotency and reviewer-isolation rules hold

Validation strategy:

- scenario tests for IMPLEMENT -> VALIDATE -> REVIEW -> COMMIT loops
- reviewer isolation tests proving fresh-reviewer requirements still hold
- idempotency tests for repeated work-unit retries
- BEADS consistency tests for parent-owned work-unit coordination

Phase exit gate:

- do not proceed until the parent workflow can coordinate work units safely and reviewers remain isolated under retry and resume conditions

## Non-Negotiable Validation Rules

Implementation should not proceed without proving:

1. BEADS remains workflow-facing truth.
2. Temporal remains runtime truth.
3. scheduled tasks and ad hoc tasks converge on the same top-level workflow model.
4. recurring schedules do not create a second orchestration model.
5. morning review artifacts remain derived read models only.

These rules should be re-checked repeatedly across phases, not just once.

## Suggested First Delivery Slice

The first concrete delivery slice should include:

- task definition contract
- schedule definition contract
- one top-level workflow
- one summary artifact
- one delayed-start schedule

That is the smallest slice that exercises the architecture honestly.
