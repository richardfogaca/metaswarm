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

The target system has six layers:

1. task definition layer
2. launch/materialization layer
3. scheduler layer
4. top-level issue workflow layer
5. morning review/read-model layer
6. operator status surface layer

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
- how a run should target or materialize a BEADS task

Does not own:

- workflow semantics after launch

### Launch / Materialization Layer

Owns:

- loading and validating task definitions for a concrete launch request
- resolving an existing BEADS target or creating a new one before workflow start
- producing a launch record that explains how the run mapped to a concrete BEADS id
- starting the top-level workflow with one concrete BEADS target

Does not own:

- workflow semantics after launch
- recurring cadence management
- BEADS workflow truth after launch

### Scheduler Layer

Owns:

- when to start a workflow
- when to wake a workflow for time-based reasons
- recurring cadence management
- recurring overlap and catchup decisions
- translating schedule definitions into the same normalized launch model used by ad hoc runs

Does not own:

- workflow phase logic
- BEADS workflow truth

Implementation note for Step 3 expansion:

- delayed-once schedules may remain a thin launcher concern that uses Temporal delayed start
- recurring schedules may use a dedicated scheduler-owned Temporal workflow per `scheduleId`
- that scheduler workflow is a control-plane exception, not a business workflow replacement

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

### Operator Status Surface

Owns:

- merged operator-facing inspection of run state
- selector-based lookup by run, workflow, or BEADS target

Does not own:

- workflow truth
- runtime truth
- launch truth

### Local Development Stack

Owns:

- local Temporal infrastructure for developer use
- reproducible local runtime startup commands

Does not own:

- workflow truth
- repo state
- BEADS state
- the host-side worker execution environment

## Primary Runtime Rule

The scheduler controls time, not workflow law.

For ad hoc and delayed-once entry, the launcher resolves a concrete BEADS target first and then starts the top-level issue workflow.

For recurring entry, a scheduler-owned workflow may hold cadence state and trigger concrete launches over time, but each concrete occurrence must still flow through launch/materialization before the top-level issue workflow starts.

Top-level workflows then apply metaswarm policy against BEADS truth.

They do not invent their own workflow semantics.

## High-Level Sequence

1. operator or schedule triggers a task definition
2. the launch/materialization layer resolves or creates one concrete BEADS issue/epic
3. the launch/materialization layer writes a launch record for the run
4. the scheduler or launcher starts a top-level workflow for that concrete BEADS target using Temporal-native runtime controls such as delayed start or a scheduler-owned recurring workflow
5. workflow reads BEADS and determines the next legal metaswarm step
6. workflow executes activities
7. workflow waits when blocked
8. workflow produces a morning review artifact

## Primary Invariants

1. BEADS remains workflow authority.
2. Temporal remains runtime authority.
3. Scheduling metadata remains separate from workflow truth.
4. One top-level issue workflow owns one issue/epic by default.
5. Subtasks remain inside the parent workflow by default.
6. Morning review artifacts are read models only.

Scheduler-owned workflows are allowed only as a narrow control-plane exception for recurring cadence management. They do not replace the top-level issue workflow as the business execution unit.

Implementation note for local development:

- a local compose stack may host Temporal services such as the server and UI
- the metaswarm worker should still run on the host in the restricted development slice so it can use the real repo, BEADS state, and host toolchain without container duplication
