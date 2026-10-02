# Feature Specification: Surveys

**Feature Branch**: `011-surveys`
**Created**: 2026-10-02
**Status**: In progress
**Input**: KYA measures several indicators through surveys: the staff's satisfaction with each
service (the IT service's objectives name « rapport d'enquête de satisfaction » as their source),
customer satisfaction (CSAT ≥ 85 %, half-yearly, required by ISO 9001 § 9.1.2), interns'
satisfaction, and evaluations between a person and her manager. Surveys reach people by link,
without an account. Referentials KYA-ORG-CIBLE-01 v4 and KYA-KPI-01; spec 010 for links and mail.

## Why

A survey is the source of an indicator: if it is late, incomplete or contestable, the indicator is
« dead » and the variable pay that rests on it cannot be paid. It must therefore reach everyone —
including the technician without an account — be answered in a few minutes on a phone, protect the
anonymity it promises, and give a score that two people compute the same way.

The tool is generic: any organization runs its own questionnaires. The business owners (HR, QHSE)
run it in their space; the administrators only grant the right.

## Concepts

- **Questionnaire**: sections and questions (a 1-to-5 rating, a free text, a yes/no), each
  required or not, each rating allowing « not applicable » or not. A section may be **about a
  unit** (« the IT service »). A questionnaire is **anonymous** or not.
- **Campaign**: a questionnaire sent to an **audience**, for a **period** (« T3 2026 »), between two
  dates. Opening a campaign **freezes** the questionnaire as it is (later edits do not touch it).
- **Audience**: every person of the organization, the people of some units, or a list of
  **outside respondents** (customers, interns' partners) given by name and e-mail.
- **About whom**: nobody in particular (the organization, or the units its sections name), the
  respondent's **manager**, each of her **direct reports**, or **one person** (the CEO). Opening the
  campaign draws who answers about whom from the structure at that date, and freezes it.
- **Respondent**: one per person (or outside respondent) of the audience; she receives **one
  personal link** that opens every form she must fill in that campaign.
- **Score on 100**: for ratings, `(average − 1) ÷ 4 × 100`, « not applicable » left out. Two people
  applying it to the same answers find the same number.

## User Scenarios & Testing

### User Story 1 — HR writes a questionnaire (P1)

1. **Given** a person with `surveys:manage`, **When** she writes a questionnaire with sections about
   units and questions, **Then** it is saved; she may change it as long as no campaign uses it, and
   copy it into a new version afterwards.

### User Story 2 — A campaign goes out (P1)

1. **Given** a draft campaign (questionnaire, title, period, dates, audience, about whom), **When**
   it is opened, **Then** the respondents and their forms are drawn from the structure at that date,
   each respondent receives an e-mail with her personal link (or it lands in the test outbox), and
   those with an account also find their forms in « To do ».
2. **Given** an evaluation « about the manager », **Then** each person of the audience whose
   position reports to an occupied position gets one form about its holder; « about direct
   reports », each manager gets one form per report.
3. **Given** an open campaign, **When** HR sends a reminder, **Then** every respondent who has not
   submitted receives a new link (the previous one stops working).
4. **Given** a respondent without an e-mail, **Then** she is listed as « to reach by hand »: HR
   resends her a link and copies it from the outbox.

### User Story 3 — A technician answers by link (P1)

1. **Given** a personal link, **When** the person opens it, **Then** she sees her forms of that
   campaign — nothing else of the organization — fills them in, saves a draft, and submits each.
2. **Given** a submitted form, **Then** it cannot be changed. In an **anonymous** campaign, the
   submitted answers are detached from the respondent at submission: nobody can tell who wrote what.
3. **Given** a closed campaign, **Then** its links no longer open.

### User Story 4 — Results (P1)

1. **Given** a campaign, **Then** HR follows completion (submitted / started / not started) without
   seeing, in an anonymous campaign, any answer next to a name.
2. **Given** a closed campaign, **Then** HR sees the score on 100 per section (per unit), per person
   about whom, and per question, with the number of answers; in an anonymous campaign, a group of
   fewer than **three** answers shows no score (« not enough answers »). Free texts are listed
   without author.
3. **Given** published results, **Then** the score becomes available to the indicators (spec 012)
   with its campaign, period and count — the « source » of the six attributes.

## Requirements

- **FR-001**: tables `questionnaires` (sections and questions as validated JSON, anonymity,
  version), `survey_campaigns` (frozen form, audience, about whom, period, dates, status `draft`,
  `open`, `closed`, `published`), `survey_respondents` (person or outside name and e-mail, status),
  `survey_forms` (respondent — null once an anonymous form is submitted —, about a person or a unit,
  answers, status), with RLS.
- **FR-002**: commands `save-questionnaire`, `copy-questionnaire`, `create-campaign`,
  `open-campaign`, `remind-campaign`, `resend-link`, `close-campaign`, `reopen-campaign`,
  `publish-results`, `save-answers`, `submit-form`.
- **FR-003**: permission `surveys:manage`; module `surveys`; answering needs no permission — the
  link, or being the respondent.
- **FR-004**: routes `/v1/surveys/...` (manage, results, my forms) and `/public/surveys/:token`
  (a link's forms); purpose of the links `surveys.answer`, reference the respondent.
- **FR-005**: `surveyScores(campaignId)` — per section, per person about whom — for spec 012.
- **FR-006**: screens: Space › Surveys (questionnaires, campaigns, follow-up, results); « To do »
  lists my forms; the link page shows the forms, phone first.
- **FR-007**: the KYA demo gets a questionnaire « satisfaction with the services » (IT, QHSE, HR,
  purchasing, accounting, logistics, health — KYA's 2026 questions, without any person's name), a
  customer satisfaction questionnaire and an evaluation of the manager.

## Out of scope

- Multiple-choice questions, branching, files in answers.
- Sending reminders automatically on a schedule (HR sends them; an agent may later).
