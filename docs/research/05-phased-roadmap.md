# Phased Roadmap

Date: 2026-04-08

## Objective

Reach the end state:

> I want to be able to fire and forget about a task, so when I go to sleep I can review the task the next day and understand what was done.

The path to that objective should stay incremental and clean.

One clarification is important:

- metaswarm already appears capable of orchestrating task and subtask flow
- this roadmap is about making that orchestration schedulable and durably unattended

The roadmap is not about replacing metaswarm's workflow engine.

## Guiding Rule

Start with a single workflow.

When that workflow is well tested and clearly correct:

- widen scope carefully
- keep boundaries clean
- prefer straightforward architecture over clever orchestration

The system should not drift into a mess while chasing autonomy.

Architecturally, the roadmap is trying to arrive at this end-state:

- task definition layer
- scheduler layer
- top-level issue workflow per task
- subtask/work-unit coordination inside the parent workflow by default
- morning review surface for the operator

## Phase 1: Single-Workflow Runtime Skeleton

Goal:

- prove one Temporal workflow can safely host one issue lifecycle at runtime

Scope:

- one workflow per issue
- start, sleep, wake, retry, and summary behavior
- no child workflows
- no deep parallel runtime topology

Success criteria:

- workflow survives restarts
- wakeups and retries are deterministic
- idempotency rules are in place
- a basic operator summary exists
- the runtime can support at least one delayed-start use case cleanly
- the top-level workflow boundary is clear and stable

## Phase 2: Late-Stage Durability

Goal:

- make the late-stage flow safe for overnight continuation

Suggested scope:

- PR shepherd wakeups
- CI waiting
- review comment follow-up
- merge follow-through

Why this is attractive early:

- it has real overnight value
- it is narrower than full end-to-end orchestration
- it exercises sleep/wake behavior heavily

Success criteria:

- the runtime can wait on CI and review events safely
- operator review the next day is clear
- no duplicated side effects occur during retries

## Phase 3: Scheduling Surface

Goal:

- support explicit operator scheduling without changing metaswarm workflow semantics

Suggested scope:

- one-off delayed task start
- recurring schedules
- schedule definitions for daily, weekly, monthly, and custom cadence runs
- cancellation and pause behavior for scheduled runs

Success criteria:

- a task can be scheduled to run later exactly once
- a recurring workflow can be scheduled on a durable cadence
- schedule metadata stays clearly separate from workflow truth
- scheduled starts and resumed runs still produce a clear morning summary
- the scheduler layer remains thin and does not absorb metaswarm workflow semantics

## Phase 4: Spec-To-Plan Lane

Goal:

- prove durable orchestration through the early high-value planning path

Suggested scope:

- intake
- research
- planning
- plan review gate
- optional design review gate

Success criteria:

- the runtime can drive useful progress overnight
- plan quality remains intact
- review isolation semantics are preserved
- the system stops cleanly at real human gates

## Phase 5: Work-Unit Execution

Goal:

- make implementation execution durable without weakening metaswarm's quality model

Scope:

- IMPLEMENT
- VALIDATE
- ADVERSARIAL REVIEW
- COMMIT

Primary risks:

- replay safety
- validator idempotency
- reviewer freshness and independence
- BEADS write coordination

Success criteria:

- retries do not duplicate harmful side effects
- workflow truth stays coherent
- overnight implementation results are reviewable in the morning
- subtasks and work units still default to parent-workflow coordination unless a clear isolation reason exists

## Phase 6: Expansion Only After Proof

Only after the earlier phases are proven should the architecture consider:

- child workflows
- richer recursive runtime decomposition
- more aggressive parallel runtime behavior
- deeper team-mode runtime integrations

These should be driven by demonstrated need, not by architectural ambition.

## What "Done" Looks Like

The integration is accomplishing its purpose when this is normal:

1. the operator launches or schedules a task
2. the system works through the night
3. the system pauses safely at real human boundaries
4. the operator wakes up and can quickly review a trustworthy summary
5. the operator understands what to approve, revise, or continue next
6. both one-off scheduled tasks and recurring scheduled tasks feel like first-class operator features rather than hacks
7. the architecture still feels like one coherent system instead of two overlapping orchestrators

That is the product outcome the roadmap should optimize for.
