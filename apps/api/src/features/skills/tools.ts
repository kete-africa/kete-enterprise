import type { CapabilityTool } from '@kete/capabilities';
import { skillsCatalog, skillTools, type Skill } from '@kete/skills';
import { z } from 'zod';

/**
 * The skills as the assistant reads them (spec 031): their names and descriptions in its
 * instructions, `skill_load` and `skill_read` as level 1 tools — they read, they change nothing.
 */
export function skillsForModel(skills: readonly Skill[]): {
  prompt: string;
  tools: CapabilityTool[];
} {
  const set = skillTools(skills);
  const tools = Object.entries(set).map(([name, tool]): CapabilityTool => {
    const input = tool.inputSchema as z.ZodObject;
    return {
      name,
      description: typeof tool.description === 'string' ? tool.description : name,
      input,
      jsonSchema: z.toJSONSchema(input) as Record<string, unknown>,
      autonomy: 1,
      async execute(value) {
        const parsed = input.safeParse(value);
        if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
        const run = tool.execute as (input: unknown, options: unknown) => Promise<unknown>;
        return {
          status: 'done',
          output: await run(parsed.data, { toolCallId: name, messages: [] }),
        };
      },
    };
  });
  return { prompt: skillsCatalog(skills), tools };
}
