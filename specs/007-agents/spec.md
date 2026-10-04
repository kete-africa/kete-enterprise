# Feature Specification: Agents with a job description

**Feature Branch**: `007-agents`
**Created**: 2026-10-01
**Status**: Delivered (proof on staging pending)
**Input**: Doctrine D-039 (three kinds of agents, one job description; one organization per agent;
asleep until woken; delegations that only narrow; every gesture with its chain up to a person; an
agent never decides for a person; a budget of drafts; the first permanent agent is level 1 and
watches the controls), principles 3 and 4, the autonomy scale.

## Why

Agents will work for people around the clock. They must be known (a registry entry, a job
description), held by a person who answers for them, kept within that person's rights and their
own narrower ones, and traced in every gesture. The first one does what is safest and most useful:
it watches and signals; it changes nothing.

## User Scenarios & Testing

### User Story 1 — An agent with a job description (P1)

1. **Given** a person who may manage agents, **When** she creates an agent — its kind (a person's,
   a position's, the system's), its mission, its responsible person, its scope (a unit and below),
   its permissions, its highest autonomy level, its budget of open drafts, and how often it wakes —
   **Then** it exists in the organization, appears in the registry as an agent, and acts only for
   its responsible person, within her rights, its own permissions and its scope.
2. **Given** a position's agent, **When** the position's holder changes, **Then** the agent acts for
   the new holder.
3. **Given** an agent, **When** it is paused, **Then** it no longer wakes.

### User Story 2 — It sleeps, wakes, and signals (P1)

1. **Given** an active agent whose wake time has come, **When** the worker runs, **Then** the agent
   wakes, runs its watches within its reach, raises a signal for each problem it finds that is not
   already open, closes the signals whose problem is gone, and sleeps until its next wake.
2. **Given** its signals, **Then** they appear to its responsible person (and on the agent's page),
   each saying what was found and where; the person resolves them.
3. **Given** every signal raised or closed, **Then** it is a named command in the journal, its actor
   the agent acting for its responsible person.

### User Story 3 — Its limits (P1)

1. **Given** an agent's autonomy level 1, **Then** it reads and signals, and nothing else.
2. **Given** the watches, **Then** the first ones read the registry (apps without an identity card
   or an owner) and the decisions (steps waiting too long); the compliance controls (spec 008) plug
   in the same way.

## Requirements

- **FR-001**: tables `agents` (job description, status, next wake, last run) and `agent_signals`
  (what, where, when raised and closed), with RLS; a definer function lists the agents due across
  organizations for the worker, and nothing more.
- **FR-002**: commands `create-agent`, `update-agent-status`, `raise-signal`, `close-signal`; the
  agent's actor is `{ kind: 'agent', id, onBehalfOf: its responsible person }`.
- **FR-003**: the worker (the API's image, role `worker`, pg-boss through `@kete/jobs`) wakes the
  agents due; `POST /v1/agents/:id/wake` wakes one now (its responsible person or a manager).
- **FR-004**: permission `agents:manage`.
- **FR-004b**: the kill switch: an agent paused by its person, or every agent of the organization
  when an administrator switches the `agents` module off, wakes and does nothing — whoever wakes it,
  the worker or a person.
- **FR-005**: the screen « Agents »: the agents, their job description, their signals; creating,
  pausing and waking one.

## Out of scope

- Agents preparing drafts (level 3) and the enforcement of their budget: with the first agent that
  prepares one. Agents delegating to agents: when a second agent needs a first.

## Success Criteria

- **SC-001**: tests prove the job description, the reach (person ∩ agent ∩ scope), a position's
  agent following the holder, waking and signals (raised once, closed when solved), pausing, the
  journal's chain, and isolation.
- **SC-002** `[blocking]`: on staging, KYA's watch agent signals an app without an owner.
