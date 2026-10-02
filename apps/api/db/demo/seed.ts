import { executeCommand, type Actor, type CommandDefinition } from '@kete/commands';
import { inOrganization, type SqlExecutor } from '@kete/tenancy';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import type { z } from 'zod';
import {
  addRequirement,
  defineControl,
  defineFramework,
  linkControlCommand,
} from '../../src/features/compliance/index.js';
import { defineMeetingType } from '../../src/features/meetings/index.js';
import { moduleKeys, setModule } from '../../src/features/organization/index.js';
import { createQuarter, importReferential } from '../../src/features/performance/index.js';
import {
  createRole,
  grantRole,
  listRoles,
  setRolePermissionsCommand,
} from '../../src/features/rights/index.js';
import {
  addPerson,
  assignPerson,
  createPosition,
  createUnit,
  createUnitType,
} from '../../src/features/structure/index.js';
import { saveQuestionnaire } from '../../src/features/surveys/index.js';
import { iso9001, meetingTypes } from './kya-governance.js';
import * as kya from './kya.js';
import { questionnaires } from './kya-surveys.js';

const actor: Actor = { kind: 'service', id: 'demo-seed', channel: 'script' };

/** The day the demo's structure starts: decision 2026-011 named the heads of the directions. */
const startsOn = '2026-07-24';

export interface SeedReport {
  structure: 'created' | 'kept';
  units: number;
  positions: number;
  people: number;
  roles: number;
  questionnaires: number;
  profiles: number;
  meetingTypes: number;
  controls: number;
}

/**
 * Seeds a demo organization with the KYA profile (spec 010). The structure is created only in an
 * empty organization; roles and modules are brought up to date at every run, so a later spec's
 * permissions reach the demo without starting over. Every change goes through the commands, so the
 * journal tells what the seed did.
 */
export async function seedDemo(options: {
  app: pg.Pool;
  owner: pg.Pool;
  schema: string;
  organizationId: string;
  /** The permissions the API knows: a role keeps only those. */
  permissions: readonly string[];
}): Promise<SeedReport> {
  const { app, owner, schema, organizationId } = options;
  let key = 0;
  const run = <Input extends z.ZodType, Output>(
    db: SqlExecutor,
    definition: CommandDefinition<Input, Output>,
    input: z.input<Input>,
  ) =>
    executeCommand(db, definition, {
      organizationId,
      actor,
      idempotencyKey: `demo-seed-${organizationId}-${Date.now()}-${++key}`,
      input,
    }).then((result) => result.output);

  // Only the instance's operator, with the owner role, marks an organization as a demo.
  await owner.query(
    `insert into ${schema}.organization_settings (organization_id, demo) values ($1, true)
     on conflict (organization_id) do update set demo = true, updated_at = now()`,
    [organizationId],
  );

  return inOrganization(app, organizationId, async (db) => {
    const report: SeedReport = {
      structure: 'kept',
      units: 0,
      positions: 0,
      people: 0,
      roles: 0,
      questionnaires: 0,
      profiles: 0,
      meetingTypes: 0,
      controls: 0,
    };
    const { rows } = await db.query<{ count: string }>(`select count(*) from units`);
    const positionIds = new Map<string, string>();
    if (Number(rows[0]?.count ?? 0) === 0) {
      report.structure = 'created';
      const types = new Map<string, string>();
      for (const type of kya.unitTypes) {
        const created = await run(db, createUnitType, type);
        types.set(type.key, created.unitTypeId);
      }
      const unitIds = new Map<string, string>();
      for (const unit of kya.units) {
        const created = await run(db, createUnit, {
          unitTypeId: types.get(unit.type) ?? '',
          name: unit.name,
          startsOn,
          ...(unit.parent ? { parentId: unitIds.get(unit.parent) ?? '' } : {}),
          ...(unit.code ? { code: unit.code } : {}),
          ...(unit.country ? { country: unit.country } : {}),
        });
        unitIds.set(unit.key, created.unitId);
        report.units += 1;
      }
      for (const position of kya.positions) {
        const created = await run(db, createPosition, {
          unitId: unitIds.get(position.unit) ?? '',
          title: position.title,
          startsOn,
          ...(position.reportsTo ? { reportsTo: positionIds.get(position.reportsTo) ?? '' } : {}),
        });
        positionIds.set(position.key, created.positionId);
        report.positions += 1;
      }
      for (const person of kya.people) {
        const created = await run(db, addPerson, {
          name: person.name,
          email: kya.demoEmail(person.name),
          // Demo accounts never sign in: an administrator views the space as them.
          ...(person.account ? { accountUserId: `demo_${person.key}` } : {}),
        });
        for (const [index, positionKey] of person.positions.entries()) {
          await run(db, assignPerson, {
            personId: created.personId,
            positionId: positionIds.get(positionKey) ?? '',
            kind: index === 0 ? 'primary' : 'interim',
            startsOn,
          });
        }
        report.people += 1;
      }
    } else {
      const { rows: existing } = await db.query<{ position_id: string; title: string }>(
        `select position_id, title from positions`,
      );
      for (const position of kya.positions) {
        const found = existing.find((p) => p.title === position.title);
        if (found && !positionIds.has(position.key))
          positionIds.set(position.key, found.position_id);
      }
    }

    const known = new Set(options.permissions);
    const existingRoles = await listRoles(db);
    for (const role of kya.roles) {
      const permissions = role.permissions.filter((p) => known.has(p));
      const existing = existingRoles.find((r) => r.name === role.name);
      if (existing) {
        await run(db, setRolePermissionsCommand, { roleId: existing.roleId, permissions });
        continue;
      }
      const created = await run(db, createRole, { name: role.name, permissions });
      for (const positionKey of role.positions) {
        const positionId = positionIds.get(positionKey);
        if (positionId) await run(db, grantRole, { roleId: created.roleId, positionId, startsOn });
      }
      report.roles += 1;
    }
    for (const module of moduleKeys) await run(db, setModule, { module, enabled: true });

    // The questionnaires, once (spec 011): sections about units point at the demo's units.
    const { rows: existingQuestionnaires } = await db.query<{ title: string }>(
      `select title from questionnaires`,
    );
    const { rows: unitRows } = await db.query<{ unit_id: string; name: string }>(
      `select unit_id, name from units`,
    );
    const unitIdOf = (key: string) => {
      const name = kya.units.find((u) => u.key === key)?.name;
      return unitRows.find((u) => u.name === name)?.unit_id;
    };
    for (const questionnaire of questionnaires) {
      if (existingQuestionnaires.some((q) => q.title === questionnaire.title)) continue;
      await run(db, saveQuestionnaire, {
        title: questionnaire.title,
        description: questionnaire.description,
        anonymous: questionnaire.anonymous,
        content: {
          sections: questionnaire.sections.map((section, s) => {
            const unitId = section.unit ? unitIdOf(section.unit) : undefined;
            return {
              key: `s${s + 1}`,
              title: section.title,
              ...(unitId ? { unitId } : {}),
              questions: section.questions.map((q, i) => ({
                key: `s${s + 1}_q${i + 1}`,
                type: q.type,
                label: q.label,
                required: q.required ?? true,
                allowNa: true,
              })),
            };
          }),
        },
      });
      report.questionnaires += 1;
    }

    // The indicators referential, once (spec 012): KYA-KPI-01 and the IT service's two profiles;
    // positions take their profile by title. Then the quarter to review, ready to open.
    const { rows: profileRows } = await db.query<{ count: string }>(
      `select count(*) from job_profiles`,
    );
    if (Number(profileRows[0]?.count ?? 0) === 0) {
      const referential = JSON.parse(
        readFileSync(new URL('./kya-kpi.json', import.meta.url), 'utf8'),
      ) as { source: string; profiles: unknown[] };
      const imported = await run(db, importReferential, referential as never);
      report.profiles = imported.profiles;
      await run(db, createQuarter, {
        label: 'T3 2026',
        startsOn: '2026-07-01',
        endsOn: '2026-09-30',
        progressive: true,
      });
    }

    // The instances of § 3.1 and the ISO 9001 frame, once (spec 013).
    const { rows: typeRows } = await db.query<{ count: string }>(
      `select count(*) from meeting_types`,
    );
    if (Number(typeRows[0]?.count ?? 0) === 0) {
      const { rows: positionRows } = await db.query<{ position_id: string; title: string }>(
        `select position_id, title from positions`,
      );
      const positionOf = (key: string) => {
        const title = kya.positions.find((p) => p.key === key)?.title;
        return positionRows.find((p) => p.title === title)?.position_id;
      };
      for (const type of meetingTypes) {
        const chair = positionOf(type.chair);
        const secretary = type.secretary ? positionOf(type.secretary) : undefined;
        await run(db, defineMeetingType, {
          name: type.name,
          kind: type.kind,
          cadence: type.cadence,
          durationMinutes: type.durationMinutes,
          ...(chair ? { chairPositionId: chair } : {}),
          ...(secretary ? { secretaryPositionId: secretary } : {}),
          memberPositionIds: type.members.flatMap((m) => positionOf(m) ?? []),
          ...(type.quorum ? { quorum: type.quorum } : {}),
          recordWithinHours: type.recordWithinHours,
        });
        report.meetingTypes += 1;
      }
      const framework = (await run(db, defineFramework, {
        code: iso9001.code,
        name: iso9001.name,
        edition: iso9001.edition,
        kind: 'standard',
      })) as { frameworkId: string };
      const owner = positionOf('qhse');
      for (const requirement of iso9001.requirements) {
        const added = (await run(db, addRequirement, {
          frameworkId: framework.frameworkId,
          reference: requirement.reference,
          summary: requirement.summary,
        })) as { requirementId: string };
        const control = await run(db, defineControl, {
          name: requirement.control,
          description: requirement.summary,
          ...(owner ? { ownerPositionId: owner } : {}),
          frequencyDays: requirement.days,
          method: 'automatic',
          check: requirement.check,
        });
        await run(db, linkControlCommand, {
          controlId: control.controlId,
          requirementId: added.requirementId,
        });
        report.controls += 1;
      }
    }
    return report;
  });
}
