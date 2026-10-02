import pg from 'pg';
import { seedDemo } from '../db/demo/seed.js';
import { permissionCatalog } from '../src/app.js';

// Seeds a demo organization with the KYA profile (spec 010), as the instance's operator:
//   OWNER_DATABASE_URL=… DATABASE_URL=… tsx scripts/seed-demo.ts --organization <id>
// The organization must exist at the identity; its people are fictitious.
const ownerUrl = process.env.OWNER_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error('OWNER_DATABASE_URL and DATABASE_URL must be set.');
const index = process.argv.indexOf('--organization');
const organizationId = index > 0 ? process.argv[index + 1] : undefined;
if (!organizationId) throw new Error('Name the organization: --organization <id>.');

const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const app = new pg.Pool({ connectionString: appUrl, max: 2 });
try {
  const report = await seedDemo({
    app,
    owner,
    schema: 'public',
    organizationId,
    permissions: permissionCatalog,
  });
  console.log(`[seed-demo] ${JSON.stringify(report)}`);
} finally {
  await owner.end();
  await app.end();
}
