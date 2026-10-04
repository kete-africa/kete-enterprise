import type { Embedder } from '@kete/knowledge';
import type { TestSchema } from '@kete/testing';
import PizZip from 'pizzip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { documentTools, usePdfConverter } from '../src/features/documents/index.js';
import { useEmbedder } from '../src/features/knowledge/index.js';
import { useTranscriber } from '../src/platform/extract.js';
import { startApi, tokenFor } from './support.js';

// Spec 035: the organization's Word templates filled for a person into a .docx or a PDF, kept for
// her alone; the canvas turned into a PDF; scans read by the model when the library indexes them.

let db: TestSchema;
const api = createApi();
const t = { admin: '', ama: '', kofi: '' };
let key = 0;

/** A minimal Word document whose body is these paragraphs. */
function word(...paragraphs: string[]): Uint8Array {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
      .join('')}</w:body></w:document>`,
  );
  return zip.generate({ type: 'uint8array' });
}
const base64 = (data: Uint8Array | string) => Buffer.from(data).toString('base64');
const fakePdf = {
  fromWord: async (document: Uint8Array) =>
    new TextEncoder().encode(`%PDF-fake ${document.byteLength}`),
  fromHtml: async () => new TextEncoder().encode('%PDF-fake html'),
  fromMarkdown: async (markdown: string, options?: { title?: string }) =>
    new TextEncoder().encode(`%PDF-fake ${options?.title}: ${markdown}`),
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `documents-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const type = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    type,
    body: type.includes('json') ? ((await response.json()) as Answer) : {},
    bytes: type.includes('json') ? null : new Uint8Array(await response.arrayBuffer()),
  };
}

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.ama = await tokenFor('usr_ama', { name: 'Ama Agbeko' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Mensah' });
});

afterAll(async () => {
  usePdfConverter(undefined);
  useTranscriber(undefined);
  useEmbedder(undefined);
  await db?.drop();
});

describe('document templates', () => {
  let templateId = '';

  it('answer only when their module is on', async () => {
    expect((await call(t.ama, 'GET', '/documents/templates')).body).toMatchObject({
      error: 'module_disabled',
    });
    await call(t.admin, 'POST', '/organization/modules', { module: 'documents', enabled: true });
  });

  it('are set by administrators, their fields read from the Word document', async () => {
    const letter = word('Madame {client},', 'Intervention le {date}.', 'Cordialement.');
    expect(
      (
        await call(t.ama, 'POST', '/documents/templates', {
          name: 'Courrier',
          data: base64(letter),
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(t.admin, 'POST', '/documents/templates', { name: 'Faux', data: base64('x') }))
        .body,
    ).toMatchObject({ error: 'template_invalid' });
    const created = await call(t.admin, 'POST', '/documents/templates', {
      name: 'Courrier d’intervention',
      description: 'Annonce une intervention au client',
      data: base64(letter),
    });
    expect(created).toMatchObject({
      status: 201,
      body: { template: { name: 'Courrier d’intervention', fields: ['client', 'date'] } },
    });
    templateId = (created.body.template as { templateId: string }).templateId;
    expect((await call(t.ama, 'GET', '/documents/templates')).body).toMatchObject({
      manage: false,
      templates: [{ templateId, fields: ['client', 'date'] }],
    });
  });

  it('are filled for a person into her own .docx, which nobody else may read', async () => {
    const filled = await call(t.ama, 'POST', `/documents/templates/${templateId}/fill`, {
      values: { client: 'Mme Efua Owusu', date: '12 octobre' },
    });
    expect(filled).toMatchObject({
      status: 201,
      body: { document: { name: 'Courrier d intervention.docx' } },
    });
    const document = filled.body.document as { documentId: string; href: string };
    expect(document.href).toBe(`/api/documents/${document.documentId}`);
    const downloaded = await call(t.ama, 'GET', `/documents/${document.documentId}`);
    expect(downloaded.type).toContain('wordprocessingml');
    const text = new PizZip(downloaded.bytes as Uint8Array).file('word/document.xml')?.asText();
    expect(text).toContain('Mme Efua Owusu');
    expect(text).toContain('12 octobre');
    expect((await call(t.kofi, 'GET', `/documents/${document.documentId}`)).status).toBe(404);
    expect((await call(t.kofi, 'GET', '/documents')).body).toEqual({ documents: [] });
    expect(((await call(t.ama, 'GET', '/documents')).body.documents as unknown[]).length).toBe(1);
  });

  it('give a PDF when a conversion is configured, and say so otherwise', async () => {
    usePdfConverter(null);
    expect(
      (
        await call(t.ama, 'POST', `/documents/templates/${templateId}/fill`, {
          values: { client: 'Kwame' },
          format: 'pdf',
        })
      ).body,
    ).toMatchObject({ error: 'pdf_unavailable' });
    usePdfConverter(fakePdf);
    const pdf = await call(t.ama, 'POST', `/documents/templates/${templateId}/fill`, {
      values: { client: 'Kwame' },
      format: 'pdf',
    });
    const id = (pdf.body.document as { documentId: string }).documentId;
    const downloaded = await call(t.ama, 'GET', `/documents/${id}`);
    expect(downloaded.type).toBe('application/pdf');
    expect(new TextDecoder().decode(downloaded.bytes as Uint8Array)).toMatch(/^%PDF-fake \d+/);
    const canvas = await call(t.ama, 'POST', '/documents/pdf', {
      title: 'Compte rendu',
      markdown: '# Compte rendu\n\nTout va bien.',
    });
    expect(canvas.body).toMatchObject({ document: { name: 'Compte rendu.pdf' } });
  });

  it('are offered to the assistant, which fills them for her', async () => {
    const [list, fill] = documentTools({
      organizationId: 'org_kya',
      userId: 'usr_ama',
      name: 'Ama Agbeko',
      role: 'member',
    } as Parameters<typeof documentTools>[0]);
    expect(await list?.execute({})).toMatchObject({
      status: 'done',
      output: { templates: [{ templateId, fields: ['client', 'date'] }] },
    });
    expect(
      await fill?.execute({ templateId, values: { client: 'M. Yaw', date: 'demain' } }),
    ).toMatchObject({
      status: 'done',
      output: {
        name: 'Courrier d intervention.docx',
        href: expect.stringMatching(/^\/api\/documents\//),
      },
    });
    expect(await fill?.execute({ templateId: 'dtpl_none', values: {} })).toEqual({
      status: 'done',
      output: { error: 'not_found' },
    });
  });

  it('can be switched off by an administrator', async () => {
    await call(t.admin, 'POST', `/documents/templates/${templateId}`, { enabled: false });
    expect((await call(t.ama, 'GET', '/documents/templates')).body).toMatchObject({
      templates: [],
    });
    expect(
      (await call(t.ama, 'POST', `/documents/templates/${templateId}/fill`, { values: {} })).status,
    ).toBe(404);
  });
});

describe('scans in the library', () => {
  it('are read by the model, then indexed and found', async () => {
    const fake: Embedder = {
      dimensions: 1536,
      async embed(texts) {
        return texts.map((text) => {
          const v = new Array<number>(1536).fill(0);
          for (const w of text.toLowerCase().split(/\W+/))
            if (w.length > 2) v[(w.length * 31) % 1536] = 1;
          return v;
        });
      },
    };
    useEmbedder(fake);
    useTranscriber(async () => ['Bon de livraison numéro 42, livré à Lomé.']);
    await call(t.admin, 'POST', '/organization/modules', { module: 'knowledge', enabled: true });
    const source = await call(t.admin, 'POST', '/knowledge/sources', { name: 'Archives' });
    const sourceId = (source.body.source as { sourceId: string }).sourceId;
    const indexed = await call(t.admin, 'POST', `/knowledge/sources/${sourceId}/documents`, {
      name: 'bon-42.png',
      contentType: 'image/png',
      data: base64(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    });
    expect(indexed.status).toBe(201);
    const found = await call(
      t.ama,
      'GET',
      `/knowledge/search?q=${encodeURIComponent('livraison 42')}`,
    );
    expect(JSON.stringify(found.body)).toContain('Bon de livraison');
  });
});
