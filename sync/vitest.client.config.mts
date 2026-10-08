import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

// Windows exercises the browser/client and pure merge contracts. The durable
// server store intentionally requires POSIX directory fsync (Oracle production).
export default defineConfig({ ...base, test: { ...base.test,
  maxWorkers: 2,
  include: [
    "src/local-vault/reference-choices.test.ts",
    'src/components/document/__tests__/field-input-advanced.test.tsx',
      "src/components/document/__tests__/plain-paragraph.test.tsx",
    'sync/{boundary,compatibility,shared-ui}.test.ts',
    'src/local-vault/{reader-write-baselines,collaboration-client,web-transport,web-watch,web-workspace-open,listing-capabilities,account-profile-loader,bootstrap-retry,folder-view,folder-view-metadata,folder-item-default,new-item-pack,template-starter,template-proposal,template-versions,windows-transport,windows-agent-tools,bridge,presence-client,agent-presence-client}.test.ts',
    'src/lib/vault/{collaboration,reconcile,pack-reconcile}.test.ts',
    'src/app/api/vault/{auth,scoped-auth,collaboration-auth}.test.ts',
    'src/lib/presentation/template-retirement.test.ts',
    'src/lib/__tests__/request-origin.test.ts',
    'src/app/api/vault/**/presence/route.test.ts',
  ],
} });
