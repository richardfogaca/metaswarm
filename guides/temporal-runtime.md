# Temporal Runtime Guide

This guide explains how the Temporal-backed metaswarm runtime works today. It is the canonical operational reference for the runtime layer, its artifacts, and its local development workflow.

---

## Table of Contents

- [Purpose](#purpose)
- [Runtime Boundary](#runtime-boundary)
- [Core Runtime Concepts](#core-runtime-concepts)
- [Runtime Paths](#runtime-paths)
- [Workflow Identity](#workflow-identity)
- [Artifacts and Status Surfaces](#artifacts-and-status-surfaces)
- [Local Development Workflow](#local-development-workflow)
- [Validation Model](#validation-model)
- [Operating Rules](#operating-rules)

---

## Purpose

Temporal gives metaswarm a durable runtime for delayed starts, reliable sleeps and wakes, restart survival, and unattended execution. It does not replace metaswarm's workflow model or BEADS authority.

## Runtime Boundary

The division of labor is:

- metaswarm defines workflow law
- BEADS defines workflow-facing task truth
- Temporal defines runtime execution truth

This boundary is the most important rule in the runtime.

## Core Runtime Concepts

### Task definitions

Task definitions describe launch intent:

- ad hoc
- one-off scheduled
- recurring

They do not become workflow truth after launch.

### Schedule definitions

Schedule definitions decide when launches happen. They are runtime entry configuration, not BEADS workflow state.

### Issue workflow

The default runtime unit is one Temporal workflow per issue or epic lifecycle.

Subtasks and work units remain inside the parent workflow by default.

### BEADS workflow state

Later restricted slices reconcile against BEADS metadata before acting after sleeps, signals, or observation refreshes.

### Derived operator surfaces

Operators inspect the runtime through derived artifacts and status views:

- launch records
- review artifacts
- `metaswarm temporal status`

## Runtime Paths

The runtime lives under:

```text
.metaswarm/runtime/
```

Key subdirectories:

```text
.metaswarm/runtime/task-definitions/
.metaswarm/runtime/schedules/
.metaswarm/runtime/launches/
.metaswarm/runtime/reviews/
.metaswarm/runtime/action-receipts/
.metaswarm/runtime/planning-artifacts/
.metaswarm/runtime/work-unit-artifacts/
```

## Workflow Identity

The runtime uses stable workflow id shapes:

- ad hoc issue workflow: `issue-<beads-id>`
- delayed scheduled workflow: `issue-<beads-id>-schedule-<schedule-id>`
- recurring run workflow: `issue-<beads-id>-schedule-<schedule-id>-run-<run-id>`
- recurring scheduler workflow: `schedule-<schedule-id>`

Run ids remain the per-run business identifier used across launch records, review artifacts, and status lookup.

## Artifacts and Status Surfaces

### Launch records

Launch records normalize runtime start facts and live at:

```text
.metaswarm/runtime/launches/<run-id>.json
```

They capture:

- run id
- task definition id
- trigger type
- schedule id when relevant
- materialization result
- runtime start metadata
- normalized workflow input

### Review artifacts

Review artifacts summarize the current or terminal state of a run and live at:

```text
.metaswarm/runtime/reviews/<run-id>.json
```

They surface:

- runtime status
- attempted steps
- accepted changes
- validation summary
- blockers
- human action required

### Status surface

The CLI exposes a merged read model:

```bash
metaswarm temporal status --latest
metaswarm temporal status --run-id <run-id>
metaswarm temporal status --workflow-id <workflow-id>
metaswarm temporal status --beads-id <id>
```

The status view merges:

- launch records
- review artifacts
- optional live Temporal workflow inspection

## Local Development Workflow

The local development boundary is:

- Temporal infrastructure in Docker
- metaswarm worker on the host

Use:

```bash
npm run temporal:dev:up
npm run temporal:dev:status
npm run temporal:worker
npm run temporal:dev:down
```

Detailed command examples and port overrides are documented in [docs/temporal-dev.md](/Users/richard/git/personal/metaswarm/docs/temporal-dev.md).

## Validation Model

The runtime is validated through:

- contract tests
- deterministic workflow tests
- activity and adapter tests
- scenario tests for operator-visible behavior
- live local smoke validation when local runtime ergonomics change

The current implementation was built phase by phase with restricted profiles rather than one large runtime rollout.

## Operating Rules

- No dual authority between BEADS and Temporal.
- No wakeup or signal may bypass BEADS reconciliation.
- No receipt or artifact may become business truth.
- No child-workflow sprawl by default.
- No expansion to parallel execution until the simpler runtime lane is operationally trustworthy.

## Related Docs

- [2026-04-08-temporal-runtime-design.md](/Users/richard/git/personal/metaswarm/docs/plans/2026-04-08-temporal-runtime-design.md)
- [2026-04-08-temporal-runtime-plan.md](/Users/richard/git/personal/metaswarm/docs/plans/2026-04-08-temporal-runtime-plan.md)
- [temporal-dev.md](/Users/richard/git/personal/metaswarm/docs/temporal-dev.md)
