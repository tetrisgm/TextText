import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

export default defineConfig({ ...base, test: { ...base.test,
  maxWorkers: 2,
  include: [
    'sync/**/*.test.ts',
    'src/local-vault/{collaboration-client,web-transport,bridge,presence-client}.test.ts',
    'src/lib/vault/{server-collaboration,server-store,collaboration,reconcile,pack-reconcile,server-presence}.test.ts',
    'src/app/api/vault/{auth,scoped-auth,collaboration-auth}.test.ts',
    'src/lib/__tests__/request-origin.test.ts',
  ],
} });
