# Phased Roadmap

Date: 2026-04-08

## Objective

Reach the end state:

> I want to be able to fire and forget about a task, so when I go to sleep I can review the task the next day and understand what was done.

The path to that objective should stay incremental and clean.

## Guiding Rule

Start with a single workflow.

When that workflow is well tested and clearly correct:

- widen scope carefully
- keep boundaries clean
- prefer straightforward architecture over clever orchestration

The system should not drift into a mess while chasing autonomy.

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

## Phase 3: Spec-To-Plan Lane

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

## Phase 4: Work-Unit Execution

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

## Phase 5: Expansion Only After Proof

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

That is the product outcome the roadmap should optimize for.
