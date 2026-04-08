# metaswarm + Temporal Architecture Overview

Date: 2026-04-08

This file is intentionally short.

The detailed research has been split into smaller focused documents under [docs/research/README.md](/Users/richard/git/personal/metaswarm/docs/research/README.md).

## North Star

The end goal is:

> I want to be able to fire and forget about a task, so when I go to sleep I can review the task the next day and understand what was done.

## Recommended Architecture

- metaswarm for workflow law and quality policy
- BEADS for durable workflow and task truth
- Temporal for durable runtime execution

## Implementation Posture

- start with a single Temporal workflow per issue
- prove it works and is well tested
- only then expand
- keep the architecture straightforward and elegant
- avoid drifting into a second workflow authority or an overly clever runtime tree

## Read Next

- [docs/research/README.md](/Users/richard/git/personal/metaswarm/docs/research/README.md)
- [01-goal-and-principles.md](/Users/richard/git/personal/metaswarm/docs/research/01-goal-and-principles.md)
- [02-component-model.md](/Users/richard/git/personal/metaswarm/docs/research/02-component-model.md)
- [03-authority-and-boundaries.md](/Users/richard/git/personal/metaswarm/docs/research/03-authority-and-boundaries.md)
- [04-runtime-interaction-model.md](/Users/richard/git/personal/metaswarm/docs/research/04-runtime-interaction-model.md)
- [05-phased-roadmap.md](/Users/richard/git/personal/metaswarm/docs/research/05-phased-roadmap.md)
