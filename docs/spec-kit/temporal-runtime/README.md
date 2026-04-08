# Temporal Runtime Spec Kit

**Date**: 2026-04-08
**Status**: Proposed implementation reference
**Version**: 1.0

## Purpose

This spec kit translates the Temporal research into implementation-facing reference material.

It is designed to answer:

- what the target architecture is
- what contracts need to exist
- what is authoritative vs derived
- how scheduling should work
- how a top-level workflow should behave
- how subtasks should be handled
- what the operator reviews the next morning

## North Star

The end goal is:

> I want to be able to fire and forget about a task, so when I go to sleep I can review the task the next day and understand what was done.

## Scope

This spec kit defines:

- the system overview
- task definition contract
- schedule definition contract
- top-level workflow contract
- subtask and work-unit model
- morning review artifact contract
- operator status surface
- local development stack
- implementation roadmap

This spec kit does not claim current implementation.

Validation is part of the implementation spec.

Use:

- [07-implementation-roadmap.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/07-implementation-roadmap.md) for per-phase validation requirements
- [08-validation-strategy.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/08-validation-strategy.md) for the shared validation model and test layers

## Document Map

- [01-system-overview.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/01-system-overview.md)
- [02-task-definition-contract.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/02-task-definition-contract.md)
- [03-schedule-definition-contract.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/03-schedule-definition-contract.md)
- [04-top-level-workflow-contract.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/04-top-level-workflow-contract.md)
- [05-subtask-and-work-unit-model.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/05-subtask-and-work-unit-model.md)
- [06-morning-review-artifact.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/06-morning-review-artifact.md)
- [07-implementation-roadmap.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/07-implementation-roadmap.md)
- [08-validation-strategy.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/08-validation-strategy.md)
- [09-operator-status-surface.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/09-operator-status-surface.md)
- [10-local-development-stack.md](/Users/richard/git/personal/metaswarm/docs/spec-kit/temporal-runtime/10-local-development-stack.md)

## Design Summary

The intended division of labor is:

- metaswarm defines workflow law
- BEADS defines workflow-facing task truth
- Temporal defines runtime execution truth
- task definitions express launch intent
- schedules decide when a run starts or wakes
- one top-level workflow owns one issue or epic lifecycle
- subtasks stay inside the parent workflow by default
- morning review artifacts are derived read models for the operator
- operator status surfaces are merged read models for inspection only
- local development infrastructure exists to host Temporal services, not to replace host-side repo authority
