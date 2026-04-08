# System Overview

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Goal

Build a Temporal-backed runtime around metaswarm that supports:

- ad hoc task execution
- delayed one-off task execution
- recurring task execution
- safe sleep/wake behavior
- durable retries
- clear next-day review

without replacing:

- metaswarm workflow semantics
- BEADS workflow/task truth

## End-State Architecture

The target system has five layers:

1. task definition layer
2. scheduler layer
3. top-level issue workflow layer
4. subtask/work-unit execution layer
5. morning review/read-model layer

## Component Roles

### metaswarm Policy Layer

Owns:

- workflow phases
- decomposition rules
- gates
- validation rules
- escalation rules

Does not own:

- scheduling
- timers
- runtime sleep/wake
- durable retry history

### BEADS

Owns:

- issue and epic identity
- work-unit identity
- dependency graph
- workflow-facing status
- decomposition truth
- durable issue context

Does not own:

- runtime execution state
- schedule state
- sleep/wake timers

### Temporal

Owns:

- run lifecycle
- timers
- sleeps and wakeups
- retries
- execution history
- schedule execution state

Does not own:

- workflow law
- gate semantics
- task graph truth

### Task Definition Layer

Owns:

- what should be launched
- whether it is ad hoc, delayed-once, or recurring
- how a run materializes or targets a BEADS task

Does not own:

- workflow semantics after launch

### Scheduler Layer

Owns:

- when to start a workflow
- when to wake a workflow for time-based reasons
- recurring cadence management

Does not own:

- workflow phase logic

### Top-Level Issue Workflow

Owns:

- execution of one issue or epic lifecycle
- coordination of subtasks and work units
- waiting at real external and human boundaries
- producing a run summary

### Morning Review Layer

Owns:

- operator-facing run summary

Does not own:

- workflow truth

## Primary Runtime Rule

The scheduler starts top-level workflows.

Top-level workflows apply metaswarm policy against BEADS truth.

They do not invent their own workflow semantics.

## High-Level Sequence

1. operator or schedule triggers a task definition
2. scheduler starts a top-level workflow
3. workflow resolves or materializes the target BEADS issue/epic
4. workflow reads BEADS and determines the next legal metaswarm step
5. workflow executes activities
6. workflow waits when blocked
7. workflow produces a morning review artifact

## Primary Invariants

1. BEADS remains workflow authority.
2. Temporal remains runtime authority.
3. Scheduling metadata remains separate from workflow truth.
4. One top-level workflow owns one issue/epic by default.
5. Subtasks remain inside the parent workflow by default.
6. Morning review artifacts are read models only.
