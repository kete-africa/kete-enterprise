import type { CapabilityTool } from '@kete/capabilities';
import {
  ConversionError,
  fillTemplate,
  pdfConverterFromEnv,
  TemplateError,
  templateFields,
  type PdfConverter,
} from '@kete/files';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { readModules, requireModule } from '../organization/index.js';
import { isAdministrator } from '../rights/index.js';
import {
  documentsOf,
  fileName,
  insertTemplate,
  keepDocument,
  listTemplates,
  PDF,
  readDocumentOf,
  readTemplate,
  removeDocument,
  removeTemplate,
  templateInput,
  updateTemplate,
  WORD,
  type GeneratedDocument,
} from './documents.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

let converterOverride: PdfConverter | null | undefined;

/** Tests: turn documents into PDF another way (`null`: as if no converter were configured). */
export function usePdfConverter(next: PdfConverter | null | undefined): void {
  converterOverride = next;
}

/** The PDF converter (Gotenberg, `KETE_GOTENBERG_URL`); a 409 when there is none. */
function converter(): PdfConverter {
  const found = converterOverride === undefined ? pdfConverterFromEnv() : converterOverride;
  if (!found) {
    throw new GestureRefusal(409, 'pdf_unavailable', 'No PDF conversion is configured here.');
  }
  return found;
}

function admin(c: Ctx): Identity {
  const identity = c.get('identity');
  if (!isAdministrator(identity) || c.get('viewedBy')) {
    throw new GestureRefusal(403, 'forbidden', 'Administrators set the templates.');
  }
  return identity;
}

const values = z.record(z.string().max(100), z.unknown());
const fillInput = z.object({ values, format: z.enum(['docx', 'pdf']).default('docx') });

/** A template filled for her into a .docx or a PDF, kept for her alone. */
async function fill(
  identity: Identity,
  templateId: string,
  input: z.infer<typeof fillInput>,
): Promise<GeneratedDocument> {
  const template = await transaction(identity.organizationId, (db) => readTemplate(db, templateId));
  if (!template || !template.enabled) {
    throw new GestureRefusal(404, 'not_found', 'No such template.');
  }
  const pdf = input.format === 'pdf' ? converter() : null;
  let content: Uint8Array;
  try {
    content = fillTemplate(template.content, input.values);
    if (pdf) content = await pdf.fromWord(content);
  } catch (error) {
    if (error instanceof TemplateError) {
      throw new GestureRefusal(422, 'template_invalid', 'This template cannot be filled.');
    }
    if (error instanceof ConversionError) {
      throw new GestureRefusal(409, 'pdf_failed', 'The PDF conversion failed.');
    }
    throw error;
  }
  return transaction(identity.organizationId, (db) =>
    keepDocument(db, {
      organizationId: identity.organizationId,
      userId: identity.userId,
      templateId,
      name: fileName(template.name, pdf ? 'pdf' : 'docx'),
      contentType: pdf ? PDF : WORD,
      content,
    }),
  );
}

/** A document written in Markdown — the assistant's canvas — turned into her PDF. */
async function markdownToPdf(identity: Identity, title: string, markdown: string) {
  const pdf = converter();
  let content: Uint8Array;
  try {
    content = await pdf.fromMarkdown(markdown, { title });
  } catch (error) {
    if (error instanceof ConversionError) {
      throw new GestureRefusal(409, 'pdf_failed', 'The PDF conversion failed.');
    }
    throw error;
  }
  return transaction(identity.organizationId, (db) =>
    keepDocument(db, {
      organizationId: identity.organizationId,
      userId: identity.userId,
      name: fileName(title, 'pdf'),
      contentType: PDF,
      content,
    }),
  );
}

/** Documents, under /v1/documents. */
export const documentRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('documents'))
  .get('/templates', async (c) => {
    const identity = c.get('identity');
    const manage = isAdministrator(identity) && !c.get('viewedBy');
    const templates = await transaction(identity.organizationId, (db) =>
      listTemplates(db, { all: manage }),
    );
    return c.json({
      manage,
      templates,
      pdf: (converterOverride ?? pdfConverterFromEnv()) !== null,
    });
  })
  .post('/templates', async (c) => {
    const identity = admin(c);
    const parsed = templateInput
      .extend({
        data: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_TEMPLATE_BYTES * 4) / 3) + 8),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A name and a .docx.');
    const content = new Uint8Array(Buffer.from(parsed.data.data, 'base64'));
    let fields: string[];
    try {
      fields = templateFields(content);
    } catch {
      throw new GestureRefusal(422, 'template_invalid', 'Not a Word template.');
    }
    const template = await transaction(identity.organizationId, (db) =>
      insertTemplate(db, {
        organizationId: identity.organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        fields,
        content,
        by: identity.userId,
      }),
    );
    return c.json({ template }, 201);
  })
  .post('/templates/:templateId', async (c) => {
    const identity = admin(c);
    const parsed = templateInput
      .partial()
      .extend({ enabled: z.boolean().optional() })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What changes?');
    const change = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as { name?: string; description?: string; enabled?: boolean };
    const template = await transaction(identity.organizationId, (db) =>
      updateTemplate(db, c.req.param('templateId'), change),
    );
    if (!template) throw new GestureRefusal(404, 'not_found', 'No such template.');
    return c.json({ template });
  })
  .post('/templates/:templateId/remove', async (c) => {
    const identity = admin(c);
    const removed = await transaction(identity.organizationId, (db) =>
      removeTemplate(db, c.req.param('templateId')),
    );
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such template.');
    return c.json({ removed });
  })
  // Filled for her: what she produces is hers, never another person's.
  .post('/templates/:templateId/fill', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to produce.');
    const parsed = fillInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Its values.');
    return c.json(
      { document: await fill(c.get('identity'), c.req.param('templateId'), parsed.data) },
      201,
    );
  })
  .post('/pdf', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to produce.');
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(160),
        markdown: z.string().min(1).max(200_000),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A title and a text.');
    return c.json(
      { document: await markdownToPdf(c.get('identity'), parsed.data.title, parsed.data.markdown) },
      201,
    );
  })
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json({
      documents: await transaction(organizationId, (db) => documentsOf(db, userId)),
    });
  })
  .get('/:documentId', async (c) => {
    const { organizationId, userId } = c.get('identity');
    const document = await transaction(organizationId, (db) =>
      readDocumentOf(db, c.req.param('documentId'), userId),
    );
    if (!document) throw new GestureRefusal(404, 'not_found', 'No such document of hers.');
    return new Response(Buffer.from(document.content), {
      headers: {
        'content-type': document.contentType,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
        'cache-control': 'private, no-store',
      },
    });
  })
  .post('/:documentId/remove', async (c) => {
    const { organizationId, userId } = c.get('identity');
    const removed = await transaction(organizationId, (db) =>
      removeDocument(db, c.req.param('documentId'), userId),
    );
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such document of hers.');
    return c.json({ removed });
  });

/** Whether her organization uses documents. */
export async function documentsOpen(identity: Identity): Promise<boolean> {
  return transaction(identity.organizationId, async (db) => (await readModules(db)).documents);
}

const listInput = z.object({});
const fillToolInput = z.object({
  templateId: z.string().min(1).max(80).describe('Le modèle choisi (document_templates)'),
  values: values.describe('La valeur de chaque champ du modèle, par son nom'),
  format: z.enum(['docx', 'pdf']).default('docx').describe('Word, ou PDF prêt à envoyer'),
});

/**
 * The assistant's tools (level 1: they produce a file for her, change nothing elsewhere): the
 * organization's templates with their fields, and a template filled into her document.
 */
export function documentTools(identity: Identity): CapabilityTool[] {
  return [
    {
      name: 'document_templates',
      description:
        'Liste les modèles de documents de l’entreprise (courriers, devis, attestations…) et les champs que chacun demande.',
      input: listInput,
      jsonSchema: z.toJSONSchema(listInput) as Record<string, unknown>,
      autonomy: 1,
      async execute() {
        const templates = await transaction(identity.organizationId, (db) => listTemplates(db));
        return {
          status: 'done',
          output: {
            templates: templates.map((t) => ({
              templateId: t.templateId,
              name: t.name,
              description: t.description,
              fields: t.fields,
            })),
          },
        };
      },
    },
    {
      name: 'document_fill',
      description:
        'Remplit un modèle de l’entreprise avec les valeurs données et produit le document final de la personne (Word ou PDF). Donne-lui ensuite le lien de téléchargement.',
      input: fillToolInput,
      jsonSchema: z.toJSONSchema(fillToolInput) as Record<string, unknown>,
      autonomy: 1,
      async execute(input) {
        const parsed = fillToolInput.safeParse(input);
        if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
        try {
          const document = await fill(identity, parsed.data.templateId, parsed.data);
          return {
            status: 'done',
            output: { name: document.name, href: document.href, contentType: document.contentType },
          };
        } catch (error) {
          // What could not be produced, said to the model: an unknown template, no PDF here.
          if (error instanceof GestureRefusal)
            return { status: 'done', output: { error: error.code } };
          throw error;
        }
      },
    },
  ];
}
