# Component Model

Date: 2026-04-08

## Overview

The clean architecture is:

- metaswarm defines workflow law
- BEADS stores workflow-facing truth
- Temporal runs the durable execution lifecycle
- agent hosts generate candidate outputs
- external systems provide side effects and observations

This is a wrapper model, not a replacement model.

It is important to be precise about what is already true today:

- metaswarm already appears to orchestrate tasks, work units, review gates, and PR follow-through
- BEADS already appears to preserve enough workflow state for context recovery

Temporal is not being introduced because metaswarm lacks a workflow engine.

Temporal is being introduced so that the existing workflow engine can become:

- schedulable
- durable across restarts
- safer for unattended overnight runs
- suitable for delayed and recurring execution

## Components

### metaswarm Workflow Policy Layer

Role:

- workflow phases
- quality gates
- review rubrics
- decomposition rules
- escalation rules

Examples in the current repo:

- `skills/orchestrated-execution/SKILL.md`
- `skills/plan-review-gate/SKILL.md`
- `skills/design-review-gate/SKILL.md`
- `agents/issue-orchestrator.md`

metaswarm remains the answer to:

- what should happen next
- what counts as passing
- what requires revision
- when to escalate to a human

metaswarm already covers:

- top-level issue orchestration
- subtask and work-unit decomposition
- gate sequencing
- retry and escalation rules inside the workflow

### BEADS

Role:

- task and epic graph
- dependency truth
- task statuses
- durable issue coordination state
- knowledge priming substrate

BEADS should remain the workflow-facing system of record.

Important practical note:

BEADS documentation currently describes:

- embedded mode as single-writer
- server mode as multi-writer

If Temporal introduces real concurrent writers, server mode is the safer target.

### Temporal

Role:

- durable runtime execution
- schedules
- timers
- sleeps and wakeups
- retry handling
- signal handling
- execution history

Temporal should be the runtime authority, not the workflow authority.

Temporal should answer questions like:

- run this task at 2 AM tomorrow
- run this maintenance task every Monday at 9 AM
- keep this workflow sleeping until a timer or signal wakes it
- retry this activity safely after a worker restart
- tell me what happened overnight

### Issue Orchestrator

Role:

- business-level coordinator for one issue or epic

In the integrated design:

- metaswarm orchestrator logic still decides the process
- Temporal hosts that logic inside a durable runtime execution shell

### Swarm Coordinator

Role:

- high-level intake
- assignment
- worktree coordination
- repo-level conflict avoidance

In the integrated design:

- keep this thin initially
- do not turn it into a large second scheduler

### Agent Hosts

Examples:

- Claude Code
- Codex CLI
- Gemini CLI

Role:

- generate plans
- generate code
- generate reviews
- produce candidate outputs

They do not own durable truth.

### External Systems

Examples:

- GitHub
- CI
- git
- worktrees
- test runners
- Playwright

Role:

- side effects
- observations
- validation execution

These are runtime interaction boundaries, not workflow authorities.

### Knowledge Base

Role:

- reusable patterns
- gotchas
- anti-patterns
- learned constraints

This is support memory, not runtime control.

## Recommended First-Cut Topology

The simplest initial topology is:

- one Temporal workflow per issue
- BEADS as the durable task substrate
- activities for side effects and agent invocation
- signals for approvals and external changes
- schedules for recurring starts and wakeups

That is enough to prove the model without overcomplicating it.

## Scheduling Model

The architecture should eventually support two runtime entry modes:

### 1. One-Off Scheduled Tasks

Examples:

- start task `X` later tonight
- start task `Y` tomorrow at 14:00
- resume a paused workflow at a planned checkpoint time

### 2. Recurring Scheduled Tasks

Examples:

- run daily
- run weekly
- run monthly
- run on a custom schedule

Examples of recurring work that fit this model:

- maintenance and curation tasks
- recurring review or reporting tasks
- recurring implementation tasks generated from templates or queue rules

The key point is that the scheduling surface should start workflows and wake workflows.

It should not redefine metaswarm's internal workflow semantics.
