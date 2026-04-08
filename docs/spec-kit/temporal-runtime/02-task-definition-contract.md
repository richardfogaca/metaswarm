# Task Definition Contract

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Purpose

A task definition expresses launch intent.

It answers:

- what should run
- whether the run is ad hoc, delayed-once, or recurring
- whether the run targets an existing BEADS issue or materializes a new one

It does not define workflow semantics after launch.

## Contract

```ts
type TaskDefinition = {
  version: 1;
  taskDefinitionId: string;
  name: string;
  mode: "ad_hoc" | "scheduled_once" | "recurring";
  materialization: TaskMaterialization;
  runtimePolicy?: RuntimePolicy;
  metadata?: Record<string, string>;
};

type TaskMaterialization =
  | {
      kind: "existing_beads_issue";
      beadsId: string;
    }
  | {
      kind: "create_beads_issue";
      templateRef: string;
      titleTemplate: string;
      labels?: string[];
      priority?: 0 | 1 | 2 | 3 | 4 | 5;
    };

type RuntimePolicy = {
  maxRuntimeHours?: number;
  maxRetryAttempts?: number;
  allowOvernight?: boolean;
  summaryRequired?: boolean;
};
```

## Field Semantics

### `taskDefinitionId`

Stable identifier for the launch intent.

This is not the BEADS issue id and not the Temporal workflow id.

### `mode`

- `ad_hoc`: launched immediately by an operator
- `scheduled_once`: launched later exactly once
- `recurring`: launched on a recurring cadence

### `materialization`

Defines how the run maps to BEADS.

Allowed forms:

- use an existing BEADS issue or epic
- create a new BEADS issue or epic from a template at run start

## Materialization Rules

### Existing BEADS Issue

Use this when:

- the task already exists in BEADS
- the operator wants to run or resume that task

### Create New BEADS Issue

Use this when:

- the task is recurring
- the run should create a fresh task each time
- the run is generated from a template or automation policy

## Invariants

1. A task definition must not contain workflow phase state.
2. A task definition must not contain runtime sleep state.
3. A task definition must not replace BEADS as task truth.
4. Materialization must be explicit: target existing BEADS state or create new BEADS state.

## Example: Ad Hoc Existing Issue

```json
{
  "version": 1,
  "taskDefinitionId": "taskdef-auth-fix-now",
  "name": "Auth bug fix now",
  "mode": "ad_hoc",
  "materialization": {
    "kind": "existing_beads_issue",
    "beadsId": "bd-1234"
  },
  "runtimePolicy": {
    "maxRuntimeHours": 8,
    "maxRetryAttempts": 3,
    "allowOvernight": true,
    "summaryRequired": true
  }
}
```

## Example: Recurring Fresh Issue

```json
{
  "version": 1,
  "taskDefinitionId": "taskdef-weekly-knowledge-maintenance",
  "name": "Weekly knowledge maintenance",
  "mode": "recurring",
  "materialization": {
    "kind": "create_beads_issue",
    "templateRef": "templates/runtime/weekly-knowledge-maintenance.md",
    "titleTemplate": "Weekly knowledge maintenance - {yyyy}-{mm}-{dd}",
    "labels": ["automation", "knowledge", "weekly"],
    "priority": 3
  },
  "runtimePolicy": {
    "maxRuntimeHours": 4,
    "maxRetryAttempts": 2,
    "allowOvernight": true,
    "summaryRequired": true
  }
}
```

## Recommended Storage

Suggested repo-local location:

```text
.metaswarm/runtime/task-definitions/<task-definition-id>.json
```

This is configuration and launch intent.

It is not workflow truth.
