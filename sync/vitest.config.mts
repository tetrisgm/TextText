import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

export default defineConfig({ ...base, test: { ...base.test,
  maxWorkers: 2,
  include: [
      "src/components/document/__tests__/plain-paragraph.test.tsx",
    'sync/**/*.test.ts',
    'src/local-vault/{reader-write-baselines,collaboration-client,web-transport,web-assistant,web-watch,web-workspace-open,listing-capabilities,bootstrap-retry,folder-view,folder-item-default,new-item-pack,template-starter,template-proposal,template-versions,windows-transport,windows-agent-tools,bridge,presence-client,agent-presence-client}.test.ts',
    'src/lib/vault/{server-collaboration,server-store,server-trash,collaboration,reconcile,pack-reconcile,server-presence,server-item-comments}.test.ts',
    // Hosted agents mutate the same durable files and must pass the sync gate.
    'src/lib/mcp/__tests__/vault-*.test.ts',
    'src/lib/mcp/__tests__/native-file-command-route.test.ts',
    'src/lib/mcp/__tests__/hosted-proposals.test.ts',
    'src/lib/ai/__tests__/{cloud-tools,guarded-cloud-tools,canonical-context,cloud-turn-presence,write-proposals,write-proposal-preview}.test.ts',
    'src/app/api/vault/{auth,scoped-auth,collaboration-auth}.test.ts',
    'src/app/api/vault/shared/route.test.ts',
    'src/app/api/vault/workspaces/route.test.ts',
    'src/app/api/vault/**/items/route.test.ts',
    'src/lib/presentation/template-retirement.test.ts',
    'src/lib/presentation/vault-template-retirement.test.ts',
    'src/lib/__tests__/request-origin.test.ts',
    'src/lib/__tests__/{ai-route,ai-write-proposal-route}.test.ts',
    'src/app/api/vault/**/presence/route.test.ts',
    'src/app/api/vault/**/trash/route.test.ts',
  ],
} });
