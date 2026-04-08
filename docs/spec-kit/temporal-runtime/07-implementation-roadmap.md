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

### Step 2: Task Definitions

Build:

- task definition loader and validator
- ad hoc task entry
- existing-BEADS and create-new materialization paths

Must prove:

- ad hoc tasks can launch safely
- materialization into BEADS is explicit and reproducible

### Step 3: Schedule Definitions

Build:

- schedule definition loader and validator
- one-off delayed scheduling
- recurring scheduling

Must prove:

- one-off delayed tasks run once
- recurring tasks run on durable cadence
- schedule state stays outside workflow truth

### Step 4: Top-Level Workflow Behavior

Build:

- BEADS reconciliation at workflow start and wakeup
- next-step derivation
- signal handling
- external observation refresh

Must prove:

- workflow does not advance on stale assumptions
- human approval requires durable state before resume

### Step 5: Late-Stage Durability

Build:

- PR shepherd wakeups
- CI waiting
- review comment follow-up path

Must prove:

- overnight late-stage progress is reliable
- side effects are not duplicated on retry

### Step 6: Spec-To-Plan Lane

Build:

- research
- planning
- plan review gate
- optional design review gate

Must prove:

- plan quality does not degrade
- overnight progress is meaningful

### Step 7: Work-Unit Execution

Build:

- implement
- validate
- adversarial review
- commit

Must prove:

- parent workflow coordination is sufficient by default
- idempotency and reviewer-isolation rules hold

## Non-Negotiable Validation Rules

Implementation should not proceed without proving:

1. BEADS remains workflow-facing truth.
2. Temporal remains runtime truth.
3. scheduled tasks and ad hoc tasks converge on the same top-level workflow model.
4. recurring schedules do not create a second orchestration model.
5. morning review artifacts remain derived read models only.

## Suggested First Delivery Slice

The first concrete delivery slice should include:

- task definition contract
- schedule definition contract
- one top-level workflow
- one summary artifact
- one delayed-start schedule

That is the smallest slice that exercises the architecture honestly.
