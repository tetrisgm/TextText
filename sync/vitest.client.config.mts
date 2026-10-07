import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

// Windows exercises the browser/client and pure merge contracts. The durable
// server store intentionally requires POSIX directory fsync (Oracle production).
export default defineConfig({ ...base, test: { ...base.test,
  maxWorkers: 2,
  include: [
    'src/local-vault/{collaboration-client,web-transport,bridge,presence-client}.test.ts',
    'src/lib/vault/{collaboration,reconcile,pack-reconcile}.test.ts',
    'src/app/api/vault/{auth,scoped-auth,collaboration-auth}.test.ts',
    'src/lib/__tests__/request-origin.test.ts',
  ],
} });
