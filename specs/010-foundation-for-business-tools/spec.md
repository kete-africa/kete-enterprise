# Feature Specification: The foundation of the business tools

**Feature Branch**: `010-foundation-for-business-tools`
**Created**: 2026-10-02
**Status**: In progress
**Input**: The business tools to come (surveys, performance, meetings) reach people who have no
account yet — field technicians receive a link by e-mail — and are switched on per organization.
The organization's administrators keep the frame; the business owners run their tools in the
space. Doctrine D-041 (the engine speaks of organizations), D-040 (governance in the contract),
D-031 (e-mail through a port), principle 3 (a person decides).

## Why

Specs 001 to 008 assumed that everyone signs in. A company does not work that way: a technician on
a site has no account, and will not have one before the quarter's survey leaves. He must still
answer it, and sign his review. Meanwhile, the few people who do sign in must find themselves in
the organization without an administrator linking each account by hand.

The business tools are generic: an organization switches on the ones it uses. And the frame (who is
who, who may do what, which tools are on) is the administrators', while the content (a survey, an
indicator grid) is the business owner's. The screens must show that split.

## User Scenarios & Testing

### User Story 1 — A person finds herself on first sign-in (P1)

1. **Given** a person of the organization with an e-mail, and no account linked, **When** someone
   signs in with the Compte Kete under that e-mail, **Then** her account is linked to that person,
   once, and she sees what her positions give her.
2. **Given** two people with the same e-mail, **Then** nothing is linked: an administrator decides.
3. **Given** an administrator, **When** she links, unlinks or corrects a person (name, e-mail,
   phone), **Then** it is done and journaled — without the personal data in the journal.

### User Story 2 — People imported at once (P1)

1. **Given** an administrator with a list (name, e-mail, phone, position), **When** she imports it,
   **Then** each person is created and given the position as primary from the day of import;
   each refused row says why, and the others pass.

### User Story 3 — A personal link (P1)

1. **Given** a feature that needs a person without an account (a survey to answer, a review to
   sign), **When** it issues a link for that person and that purpose, **Then** the person opens it
   and acts on that purpose only — nothing else of the organization is reachable with it.
2. **Given** a link, **Then** it expires (at the latest with what it was issued for), can be
   revoked, and a new link for the same purpose revokes the previous one.
3. **Given** the database, **Then** it holds only a fingerprint of the link, never the link.

### User Story 4 — E-mails, and a test outbox (P1)

1. **Given** a feature that writes to a person, **Then** the e-mail is queued in the same
   transaction as the gesture, and leaves only if the gesture commits.
2. **Given** an organization in capture mode (every staging and demo instance, and any instance
   without a provider), **Then** no e-mail leaves: it lands in the **test outbox**, where an
   administrator reads it as the recipient would and follows its links.
3. **Given** send mode with a provider, **Then** the worker sends queued e-mails, and their content
   is erased once sent (the link they carried is a secret).

### User Story 5 — Modules switched on per organization (P1)

1. **Given** an administrator, **When** she switches a business module on or off (surveys,
   performance, meetings, compliance, agents), **Then** its tools appear or disappear in the space
   and its routes answer or refuse (`module_disabled`). The data stays.
2. **Given** a person, **Then** a tool shows only if its module is on **and** she holds its right.

### User Story 6 — Administration and space (P1)

1. **Given** an administrator, **Then** a separate Administration holds the frame: organization,
   people and accounts, rights, modules, circuits, registry, agents, test outbox, demo.
2. **Given** anyone, **Then** the space holds « Me » (home, to do) and the business tools her
   rights open; it never shows the frame.

### User Story 7 — A demo organization (P2)

1. **Given** an organization marked as a demo (only by the instance's operator, never from a
   screen), **When** an administrator chooses « view as » a person of it, **Then** she sees and
   acts in that person's space with that person's rights — never more — until she comes back.
2. **Given** an organization that is not a demo, **Then** « view as » does not exist.
3. **Given** the KYA demo profile, **When** the operator seeds an empty demo organization, **Then**
   it receives KYA-Energy Group's structure of decision 2026-010 (directions, services, entities
   attached to the DG, the Niger agency), the 48 positions of the referentials, about thirty
   fictitious people with fictitious e-mails (`@kya-demo.test`), their assignments, and every
   module on.

## Requirements

- **FR-001**: command `link-account` (on `/v1/me`, by e-mail, at most one match); commands
  `link-person-account`, `update-person`, `import-people` (≤ 500 rows) under `structure:write`.
- **FR-002**: table `person_passes` (person, purpose `feature.kind`, reference, SHA-256 of the
  token, expiry, revocation, last use) with RLS; a definer function resolves a fingerprint to its
  organization; tokens are 32 random bytes, base64url; `/public/passes/:token` tells who and what.
- **FR-003**: table `mail_messages` (recipient, subject, HTML, text, purpose, status `captured`,
  `queued`, `sent`, `failed`) with RLS; mode from `KETE_MAIL_MODE` (`capture` by default, `send`
  needs `MAILKITE_API_KEY`); a worker job sends queued mail through `@kete/notify` and erases
  their content; the e-mails' words come from the API's own catalogs (French and English).
- **FR-004**: table `organization_modules` with RLS; command `set-module` (administrators);
  `requireModule` on each business feature's routes; `compliance` and `agents` are on unless
  switched off, the new modules off unless switched on.
- **FR-005**: table `organization_settings` (demo flag), written by the operator's seed only; the
  header `kete-view-as` is honored only for an administrator of a demo organization, and only
  for a person with an account (the seed gives demo people demo accounts that never sign in).
- **FR-006**: `/v1/me` answers the person, her linked person, her permissions, the modules on,
  whether she administers, and whether the organization is a demo.
- **FR-007**: the web splits into the space (`/`, `/a-faire`, tools) and the Administration
  (`/administration/...`); the public page `/lien/:token` opens a link without an account.
- **FR-008**: `scripts/seed-demo.ts --organization <id> --profile kya`, idempotent refusal on a
  non-empty organization.

## Out of scope

- Sending SMS or WhatsApp; the links can be copied from the outbox and sent by hand.
- The business tools themselves: specs 011 (surveys), 012 (performance), 013 (meetings).
