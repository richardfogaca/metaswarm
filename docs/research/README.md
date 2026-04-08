# metaswarm + Temporal Research

Date: 2026-04-08

## North Star

The end goal for adding Temporal to metaswarm is:

> I want to be able to fire and forget about a task, so when I go to sleep I can review the task the next day and understand what was done.

That goal drives the architecture.

This is not a generic "add scheduling" project. It is a reliability and operator-experience project:

- metaswarm should keep its quality discipline
- work should keep progressing while the operator is away
- the system should pause and resume safely
- the next-day review surface should make clear what happened, what changed, what passed, what failed, and what still needs a human

## What This Research Is Correcting

One distinction needs to stay explicit throughout this research:

- metaswarm already orchestrates tasks and subtasks in the workflow sense
- Temporal is being considered to add durable scheduling and unattended runtime behavior around that orchestration

So the point is not:

- "metaswarm cannot orchestrate work"

The point is:

- metaswarm appears to already know how to drive the SDLC flow
- BEADS already carries durable workflow context and recovery state
- what is still missing for the end goal is a first-class runtime for:
  - one-off delayed execution
  - daily, weekly, monthly, or custom recurring schedules
  - reliable sleeps and wakeups
  - durable retries across long unattended runs
  - clean next-day execution history and summary surfaces

This matters because the architecture should wrap metaswarm's strengths, not re-implement them.

## Design Posture

The integration should stay straightforward and elegant:

- start with a single Temporal workflow per issue
- prove it works and is well tested
- only then widen the scope
- preserve clean authority boundaries
- avoid drifting into a second control plane or a pile of runtime special cases

The architecture should optimize for long-term coherence, not just for getting a demo running.

## Document Map

- [01-goal-and-principles.md](/Users/richard/git/personal/metaswarm/docs/research/01-goal-and-principles.md)
- [02-component-model.md](/Users/richard/git/personal/metaswarm/docs/research/02-component-model.md)
- [03-authority-and-boundaries.md](/Users/richard/git/personal/metaswarm/docs/research/03-authority-and-boundaries.md)
- [04-runtime-interaction-model.md](/Users/richard/git/personal/metaswarm/docs/research/04-runtime-interaction-model.md)
- [05-phased-roadmap.md](/Users/richard/git/personal/metaswarm/docs/research/05-phased-roadmap.md)

## Existing metaswarm Grounding

This research is grounded in the current metaswarm structure:

- `README.md`
- `AGENTS.md`
- `USAGE.md`
- `skills/orchestrated-execution/SKILL.md`
- `skills/plan-review-gate/SKILL.md`
- `skills/design-review-gate/SKILL.md`
- `agents/issue-orchestrator.md`

## Short Summary

The recommended architecture is:

- metaswarm for workflow law and quality policy
- BEADS for durable workflow and task truth
- Temporal for durable runtime execution

The intended division of labor is:

- metaswarm decides what should happen next
- BEADS records the task graph and workflow-facing truth
- Temporal makes that process schedulable, durable, and unattended-safe

The target end-state architecture should also include:

- a task definition layer for:
  - ad hoc tasks
  - one-off scheduled tasks
  - recurring scheduled tasks
- a scheduler layer that starts or wakes workflows based on time
- a top-level issue workflow per task/epic
- a clear rule that subtasks stay inside the parent workflow by default
- a simple morning review surface for overnight outcomes

The first implementation slice should be narrow:

- one workflow per issue
- no child workflows in v1
- strong idempotency rules
- explicit human gates
- a clear morning summary surface

That is the smallest design that can plausibly reach the fire-and-forget end goal without turning into a mess.
