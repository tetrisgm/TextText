import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

export default defineConfig({ ...base, test: { ...base.test,
  maxWorkers: 2,
  include: [
    'sync/**/*.test.ts',
    'src/local-vault/{collaboration-client,web-transport,web-watch,windows-transport,windows-agent-tools,bridge,presence-client,agent-presence-client}.test.ts',
    'src/lib/vault/{server-collaboration,server-store,server-trash,collaboration,reconcile,pack-reconcile,server-presence,server-item-comments}.test.ts',
    // Hosted agents mutate the same durable files and must pass the sync gate.
    'src/lib/mcp/__tests__/vault-{tools,mutations,organization,comments,agent-presence}.test.ts',
    'src/lib/mcp/__tests__/native-file-command-route.test.ts',
    'src/app/api/vault/{auth,scoped-auth,collaboration-auth}.test.ts',
    'src/lib/__tests__/request-origin.test.ts',
    'src/app/api/vault/**/presence/route.test.ts',
  ],
} });
