# Subtask And Work-Unit Model

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Default Rule

Subtasks and work units stay inside the parent top-level workflow by default.

This means:

- BEADS remains the decomposition truth
- the parent workflow coordinates work progression
- work-unit execution is usually activities plus BEADS state transitions

## Why This Is The Default

This keeps the runtime model simpler:

- fewer workflow ids
- less parent/child coordination
- less cancellation complexity
- fewer opportunities for BEADS and Temporal to drift

## Parent Workflow Responsibilities

The parent workflow should:

- create or read work-unit decomposition from BEADS
- respect dependency ordering
- select the next eligible work unit
- run IMPLEMENT / VALIDATE / REVIEW / COMMIT behavior
- record blocked or escalated states

## Child Workflow Exception Rule

A subtask or work unit should only become its own workflow if it has a real isolation need.

Examples:

- it is long-running enough to justify its own lifecycle
- it is recursively complex enough to behave like its own epic
- it has separate wakeup and timing needs
- it must survive independently from the parent for operational reasons

## Criteria For Promotion To Separate Workflow

All of these should be considered:

1. Does it have a genuinely independent lifecycle?
2. Does it need independent timers or signals?
3. Is the parent workflow becoming too complex to remain reliable?
4. Is there clear value in isolating failure and retries?

If the answer is no, keep it in the parent workflow.

## Authority Rules

Even when a child workflow exists:

- BEADS still owns decomposition truth
- metaswarm still owns workflow law
- Temporal still owns runtime state

Child workflows must not become a second decomposition authority.

## Recommended v1 Posture

In v1:

- no child workflows
- no per-work-unit workflows
- no reviewer workflows
- no PR-shepherd child workflows

All of that should remain inside the top-level workflow until the base system is proven.

Step 7 restricted implementation note:

- the parent workflow should execute at most one BEADS-issued `run_work_unit_action` at a time
- implement, validate, adversarial review, and commit should all flow through the same idempotent activity boundary
- fresh adversarial review on retry should be represented as a new BEADS-issued action identity, not as hidden in-memory reviewer state
