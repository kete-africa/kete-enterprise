import { readSkillsDirectory, type Skill } from '@kete/skills';
import { fileURLToPath } from 'node:url';

// Skills (spec 031): the know-how the assistant reads as Agent Skills (agentskills.io). Kete
// Enterprise ships its own — the chat's commands — and each organization keeps its own, read by the
// people its audience opens them to.

const BASE_DIRECTORY = fileURLToPath(new URL('../../../skills/', import.meta.url));

let base: Promise<Skill[]> | undefined;

/** The skills Kete Enterprise ships (`apps/api/skills`), read once. */
export function baseSkills(): Promise<Skill[]> {
  base ??= readSkillsDirectory(BASE_DIRECTORY);
  return base;
}

/** The base skill a chat command names (`metadata.kete-command`), if any. */
export async function commandSkill(command: string): Promise<Skill | undefined> {
  return (await baseSkills()).find((s) => s.metadata['kete-command'] === command);
}
