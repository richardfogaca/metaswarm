# Temporal Runtime Design

**Date**: 2026-04-08
**Status**: Approved design
**Version**: 1.0

## Problem

metaswarm already knows how to drive the software delivery workflow, but it does not natively provide unattended runtime durability. The missing capability is not "more orchestration logic." The missing capability is a durable runtime that can:

- start work later without keeping an agent session alive
- sleep and wake reliably across long waits
- survive worker restarts
- keep operator-visible history for overnight execution
- preserve metaswarm's quality and approval model while the operator is away

Temporal is being added to solve that runtime problem without replacing metaswarm's workflow model.

## North Star

> I want to be able to fire and forget about a task, so when I go to sleep I can review the task the next day and understand what was done.

That goal is about operator trust, not just scheduling.

## Design Posture

The Temporal integration should stay narrow and disciplined:

- add runtime durability, not a second workflow brain
- preserve metaswarm's quality model
- preserve BEADS as the durable workflow-facing source of truth
- keep one parent workflow per issue or epic by default
- prefer simple deterministic read models over clever orchestration
- widen scope only after the restricted slice for each phase is proven in tests

## Recommended Architecture

The intended division of labor is:

- metaswarm defines workflow law and quality policy
- BEADS defines task graph and workflow-facing task truth
- Temporal defines runtime execution truth
- task definitions express launch intent
- schedules decide when launches happen
- a top-level issue workflow owns one issue or epic lifecycle
- derived artifacts expose run state to operators

This is a wrapper architecture, not a replacement architecture.

## Authority Model

### BEADS owns workflow truth

BEADS owns:

- issue and epic identity
- workflow-facing task state
- durable human approvals
- authoritative next-step state for later restricted phases

Temporal may read that truth and react to it, but it must not become a second durable business-state store.

### Temporal owns runtime truth

Temporal owns:

- active workflow execution
- timers, sleeps, and wakes
- durable retries
- workflow status at runtime

Temporal should not own business approvals, schedule intent, or workflow policy.

### metaswarm owns workflow law

metaswarm owns:

- the SDLC model
- quality gates
- planning and review semantics
- execution policy for work units

That policy may be executed inside a Temporal workflow, but the law itself still belongs to metaswarm.

### Agents and external systems own proposals, not truth

Agents, CI systems, code hosts, and other external tools can produce observations or candidate outputs. They do not get to unilaterally move workflow state forward.

## Runtime Model

The runtime model is intentionally simple:

1. A launch request is prepared from a task definition or schedule definition.
2. Materialization happens before workflow start.
3. The workflow starts with one concrete BEADS target.
4. The workflow emits derived artifacts for operator inspection.
5. Wakeups and retries always reconcile against authoritative BEADS state before acting.

The workflow should never assume an old in-memory plan remains valid after a long sleep, signal, or restart.

## Scheduling Model

Scheduling is a launch concern, not BEADS workflow truth.

The design supports three entry types:

- ad hoc launches
- one-off scheduled launches
- recurring scheduled launches

The schedule decides when to launch or wake work. The issue workflow still receives one concrete run input and one concrete BEADS target.

Recurring cadence may be managed by a scheduler-owned workflow, but the per-issue run remains the primary business runtime unit.

## Workflow Ownership Model

The default rule is:

- one Temporal workflow owns one issue or epic lifecycle

Subtasks and work units stay inside the parent workflow by default. Separate child workflows are an exception, not a baseline. They should only be introduced for clear isolation or scalability reasons after the simpler parent-owned model stops being sufficient.

## Operator Surfaces

The operator needs derived inspection surfaces, not another control plane.

The design currently uses:

- launch records for normalized runtime start facts
- morning review artifacts for per-run summaries
- status views that merge launch data, review data, and optional live Temporal status

These are read models. They must stay derived.

## Local Development Boundary

The local development stack follows the same authority rules:

- Temporal services may run in containers
- the metaswarm worker runs on the host
- the host worker keeps direct access to the real repo, `.metaswarm/runtime`, `.beads`, git state, and host tools

Local containers must not become a hidden replacement for repo authority.

## Primary Invariants

- No dual workflow authority between BEADS and Temporal.
- No progression based on signal delivery alone.
- No non-idempotent replay hazards.
- No hidden policy encoded only in runtime artifacts.
- No child-workflow sprawl by default.
- No operator surface that becomes a second source of truth.

## Delivery Strategy

The implementation should progress through restricted slices. Each slice must:

- add one honest capability
- prove deterministic behavior in tests
- preserve the authority model
- avoid promising broader semantics than the code actually supports

That is why the Temporal work has been built phase by phase instead of landing as one large runtime rewrite.

## Read Next

- [2026-04-08-temporal-runtime-plan.md](/Users/richard/git/personal/metaswarm/docs/plans/2026-04-08-temporal-runtime-plan.md)
- [temporal-runtime.md](/Users/richard/git/personal/metaswarm/guides/temporal-runtime.md)
- [temporal-dev.md](/Users/richard/git/personal/metaswarm/docs/temporal-dev.md)
