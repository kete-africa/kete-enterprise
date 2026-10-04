import { languageModel, modelConfigFromEnv, type ModelConfig } from '@kete/ai';
import {
  evaluateSkill,
  getStoredSkill,
  listSkills,
  readSkillArchive,
  readStoredSkill,
  removeSkill,
  saveSkill,
  skillArchive,
  skillCases,
  SkillError,
  skillsFor,
  skillVersions,
  updateSkill,
  type Skill,
  type StoredSkill,
} from '@kete/skills';
import type { SqlExecutor } from '@kete/tenancy';
import type { LanguageModel } from 'ai';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { usageStore } from '../../platform/usage.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { readerKeys } from '../knowledge/index.js';
import { readModules, requireModule } from '../organization/index.js';
import { isAdministrator } from '../rights/index.js';
import { baseSkills } from './skills.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

let modelOverride: LanguageModel | null | undefined;

/** Tests: evaluate with another model (`null`: as if none were configured). */
export function useSkillsModel(next: LanguageModel | null | undefined): void {
  modelOverride = next;
}

function organizationModel(): LanguageModel | null {
  if (modelOverride !== undefined) return modelOverride;
  let config: ModelConfig;
  try {
    config = modelConfigFromEnv('KETE_AI');
  } catch {
    return null;
  }
  return languageModel(config);
}

/** The skills she may use: the shipped ones, then her organization's opened to her. */
export async function skillsOf(db: SqlExecutor, identity: Identity): Promise<Skill[]> {
  const shipped = await baseSkills();
  if (!(await readModules(db)).skills) return shipped;
  const names = new Set(shipped.map((s) => s.name));
  const own = await skillsFor(db, await readerKeys(db, identity));
  return [...shipped, ...own.filter((s) => !names.has(s.name))];
}

/**
 * Keeps a skill for her (spec 031): a new one opened to her alone, or a new version of one she
 * created. A shipped skill's name is not hers to take.
 */
export async function keepSkill(
  db: SqlExecutor,
  identity: Identity,
  skill: Skill,
  note?: string,
): Promise<{ skill: StoredSkill; created: boolean; newVersion: boolean }> {
  if ((await baseSkills()).some((s) => s.name === skill.name)) {
    throw new GestureRefusal(409, 'skill_name_taken', 'A shipped skill has this name.');
  }
  const existing = (await listSkills(db)).find((s) => s.name === skill.name);
  if (existing && existing.createdBy !== identity.userId && !isAdministrator(identity)) {
    throw new GestureRefusal(409, 'skill_name_taken', 'Another person keeps a skill of this name.');
  }
  return saveSkill(db, {
    organizationId: identity.organizationId,
    skill,
    by: identity.userId,
    ...(existing ? {} : { audience: [`user:${identity.userId}`] }),
    ...(note ? { note } : {}),
  });
}

/** The skill, if she may read it; whether she may change it (its author, an administrator). */
async function visible(c: Ctx, db: SqlExecutor) {
  const identity = c.get('identity');
  const stored = await getStoredSkill(db, c.req.param('skillId') ?? '');
  const keys = new Set(await readerKeys(db, identity));
  const admin = isAdministrator(identity) && !c.get('viewedBy');
  if (!stored || (!admin && !stored.audience.some((k) => keys.has(k)))) {
    throw new GestureRefusal(404, 'not_found', 'No such skill for her.');
  }
  return { stored, admin, author: stored.createdBy === identity.userId && !c.get('viewedBy') };
}

const audienceKey = z
  .string()
  .regex(/^(everyone|role:admin|unit:[A-Za-z0-9_.-]{1,80}|user:[A-Za-z0-9_.-]{1,80})$/);

/** Skills, under /v1/skills. */
export const skillRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('skills'))
  .get('/', async (c) => {
    const identity = c.get('identity');
    const manage = isAdministrator(identity) && !c.get('viewedBy');
    const shipped = (await baseSkills()).map((s) => ({ name: s.name, description: s.description }));
    const kept = await transaction(identity.organizationId, async (db) =>
      manage ? listSkills(db) : listSkills(db, { readerKeys: await readerKeys(db, identity) }),
    );
    return c.json({ manage, shipped, skills: kept });
  })
  // A skill made elsewhere — Claude, ChatGPT, Codex — kept here as its .zip.
  .post('/', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to keep.');
    const parsed = z
      .object({
        data: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_ARCHIVE_BYTES * 4) / 3) + 8),
        note: z.string().max(500).optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A .zip, in base64.');
    let skills: Skill[];
    try {
      skills = readSkillArchive(new Uint8Array(Buffer.from(parsed.data.data, 'base64')));
    } catch (error) {
      throw new GestureRefusal(
        422,
        'skill_invalid',
        error instanceof SkillError ? error.problems.join('; ') : 'Not a skill.',
      );
    }
    const identity = c.get('identity');
    const kept = await transaction(identity.organizationId, async (db) => {
      const out = [];
      for (const skill of skills) out.push(await keepSkill(db, identity, skill, parsed.data.note));
      return out;
    });
    return c.json({ skills: kept.map((k) => k.skill) }, 201);
  })
  .get('/:skillId', async (c) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const { stored, admin, author } = await visible(c, db);
        const skill = await readStoredSkill(db, stored.skillId);
        return {
          skill: stored,
          manage: admin || author,
          instructions: skill?.instructions ?? '',
          files: skill?.files.map((f) => f.path) ?? [],
          cases: skill ? skillCases(skill).length : 0,
          versions: await skillVersions(db, stored.skillId),
        };
      }),
    );
  })
  // Its author switches it off or brings a version back; an administrator also opens it to others.
  .post('/:skillId', async (c) => {
    const parsed = z
      .object({
        audience: z.array(audienceKey).min(1).max(50).optional(),
        enabled: z.boolean().optional(),
        version: z
          .string()
          .regex(/^[0-9a-f]{16}$/)
          .optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What changes?');
    const identity = c.get('identity');
    const skill = await transaction(identity.organizationId, async (db) => {
      const { stored, admin, author } = await visible(c, db);
      if (!admin && !author) throw new GestureRefusal(403, 'forbidden', 'Its author decides.');
      if (parsed.data.audience && !admin) {
        throw new GestureRefusal(403, 'forbidden', 'Administrators open a skill to others.');
      }
      try {
        return await updateSkill(db, stored.skillId, {
          ...(parsed.data.audience ? { audience: parsed.data.audience } : {}),
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.version ? { version: parsed.data.version } : {}),
        });
      } catch (error) {
        if (error instanceof SkillError) throw new GestureRefusal(404, 'not_found', error.message);
        throw error;
      }
    });
    return c.json({ skill });
  })
  .post('/:skillId/remove', async (c) => {
    const identity = c.get('identity');
    const removed = await transaction(identity.organizationId, async (db) => {
      const { stored, admin, author } = await visible(c, db);
      if (!admin && !author) throw new GestureRefusal(403, 'forbidden', 'Its author decides.');
      return removeSkill(db, stored.skillId);
    });
    return c.json({ removed });
  })
  // The skill as Claude, ChatGPT or Codex take it back.
  .get('/:skillId/archive', async (c) => {
    const identity = c.get('identity');
    const skill = await transaction(identity.organizationId, async (db) => {
      const { stored } = await visible(c, db);
      return readStoredSkill(db, stored.skillId);
    });
    if (!skill) throw new GestureRefusal(404, 'not_found', 'No such skill.');
    return new Response(Buffer.from(skillArchive(skill)), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${skill.name}.zip"`,
        'cache-control': 'private, no-store',
      },
    });
  })
  // Its own test cases (evals/evals.json), asked to the organization's model and judged.
  .post('/:skillId/evaluate', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to run.');
    const identity = c.get('identity');
    const skill = await transaction(identity.organizationId, async (db) => {
      const { stored } = await visible(c, db);
      return readStoredSkill(db, stored.skillId);
    });
    if (!skill) throw new GestureRefusal(404, 'not_found', 'No such skill.');
    if (!skillCases(skill).length) throw new GestureRefusal(409, 'no_cases', 'No test case.');
    const model = organizationModel();
    if (!model) throw new GestureRefusal(409, 'assistant_unavailable', 'No model is configured.');
    const report = await evaluateSkill({
      skill,
      model,
      metering: {
        store: usageStore(),
        context: {
          organizationId: identity.organizationId,
          actor: { kind: 'person', id: identity.userId, channel: 'web' },
          purpose: 'skills',
          model: '',
        },
      },
    });
    return c.json({ report });
  });
