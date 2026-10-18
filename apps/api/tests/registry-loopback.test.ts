import { afterEach, describe, expect, it } from 'vitest';
import { registerInput } from '../src/features/registry/index.js';

// An app's address is https; only a developer's machine accepts an app beside it on the loopback
// (kete-core's `pnpm platform`), never staging nor production.

const app = (address: string) => registerInput.safeParse({ kind: 'app', name: 'Finance', address });
const before = process.env.KETE_ENVIRONMENT;
afterEach(() => {
  if (before === undefined) delete process.env.KETE_ENVIRONMENT;
  else process.env.KETE_ENVIRONMENT = before;
});

describe('an app’s address', () => {
  it('is https everywhere', () => {
    process.env.KETE_ENVIRONMENT = 'production';
    expect(app('https://finance.kya.tg').success).toBe(true);
    expect(app('http://127.0.0.1:3410').success).toBe(false);
    expect(app('http://finance.kya.tg').success).toBe(false);
  });

  it('may be on the loopback on a developer’s machine only', () => {
    process.env.KETE_ENVIRONMENT = 'staging';
    expect(app('http://127.0.0.1:3410').success).toBe(false);
    process.env.KETE_ENVIRONMENT = 'development';
    expect(app('http://127.0.0.1:3410').success).toBe(true);
    expect(app('http://192.168.1.10:3410').success).toBe(false);
  });
});
