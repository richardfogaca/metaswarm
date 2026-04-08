# Goal And Principles

Date: 2026-04-08

## End Goal

The end goal for Temporal in metaswarm is:

> I want to be able to fire and forget about a task, so when I go to sleep I can review the task the next day and understand what was done.

This implies a stronger target than "background execution."

The system must be able to:

- continue useful work while the operator is away
- stop safely at real human gates
- survive process restarts and long waits
- make the next-day review legible
- preserve metaswarm's quality posture instead of trading it away for speed

## Why Temporal

metaswarm already appears strong on workflow quality:

- research
- planning
- plan review gate
- design review gate
- work-unit decomposition
- 4-phase execution loop
- final review
- PR shepherding
- closure and learning

What it lacks as a first-class substrate is durable runtime behavior:

- schedules
- sleeps and wakeups
- retries
- long-running resumable execution
- durable history across process restarts

Temporal is a candidate to provide those runtime capabilities without replacing metaswarm's process model.

## Primary Design Principles

### Preserve metaswarm's quality model

Temporal should not flatten metaswarm into a generic task runner.

The following should remain intact:

- written plans
- blocking review gates
- adversarial validation
- explicit decomposition
- human checkpoints

### Add runtime durability, not workflow drift

Temporal should contribute:

- runtime execution
- timers
- signals
- retries
- schedules
- history

It should not become a new source of workflow semantics.

### Start narrow

The first implementation should be intentionally small:

- one Temporal workflow per issue
- one well-bounded path
- no child workflows in v1
- strong replay and idempotency discipline

The right pattern is:

1. start simple
2. test hard
3. prove overnight usefulness
4. then expand

### Optimize for operator trust

The user experience target is not just automation. It is confidence.

The operator should be able to wake up and quickly see:

- what the workflow attempted
- what changed
- what validations ran
- what gates passed
- what failed
- what still needs a human

### Prefer elegance over orchestration cleverness

Every new runtime feature should be evaluated against one question:

Does this make the system cleaner and safer, or just more magical?

If it increases hidden state, duplicates authority, or creates coordination ambiguity, it is probably the wrong move.

## Explicit Non-Goals For Early Integration

At the beginning, do not try to:

- replace BEADS
- replace metaswarm skills
- model every agent as a Temporal workflow
- redesign the whole architecture at once
- maximize parallelism before the basic runtime path is proven

## Success Criteria

The Temporal addition is succeeding only if it makes this workflow real:

1. the operator starts or schedules a task
2. the system works while the operator is asleep
3. the system pauses safely when human input is genuinely required
4. the next morning the operator can understand the state quickly
5. the operator can trust that the workflow did not silently bypass metaswarm quality gates
