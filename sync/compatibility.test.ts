import { expect, it } from 'vitest';
import * as Y from 'yjs';
import fixture from './fixtures/v1-pending-journal.json';
import { FileCollaborationClient } from '@/sync/client';
import { applyVaultCollaboration } from '@/sync/server';
import { documentText } from '@/lib/collab/document';

it('reopens a previous-version journal and delivers its original operation exactly once', async () => {
  let state = structuredClone(fixture.state);
  let bytes = new Uint8Array(Buffer.from(fixture.pack, 'base64'));
  let saved = JSON.stringify(fixture.journal);
  const operations = new Set<string>();
  const originalOperation = fixture.journal.batch!.operationId;
  const editor = new FileCollaborationClient({ server: 'https://fixture.invalid', workspaceId: 'compatibility', itemId: 'compatibility-item',
    journal: { load: () => saved, save: (_key, value) => { saved = value; }, remove: () => { saved = ''; } },
    request: async (method, params) => {
      if (method === 'read') return { ...state, relativePath: 'Notes/Compatibility.textpack', canEditContent: true, canComment: true };
      expect(params.operationId).toBe(originalOperation);
      const operation = params.operationId as string;
      if (!operations.has(operation)) {
        const next = applyVaultCollaboration(state, bytes, params.updates as string[], 'Notes/Compatibility.textpack');
        state = next.state; bytes = new Uint8Array(next.bytes); operations.add(operation);
      }
      return { status: 'written', revision: state.revision };
    },
  });
  try {
    await editor.start(); await editor.flush(); await editor.flush();
    expect(editor.hasPendingChanges).toBe(false);
    expect(operations.size).toBe(1);
    const server = new Y.Doc();
    try {
      Y.applyUpdate(server, Buffer.from(state.update, 'base64'));
      expect(documentText(server, 'body').toString()).toBe(fixture.expectedBody);
      expect(documentText(editor.doc, 'body').toString()).toBe(fixture.expectedBody);
    } finally { server.destroy(); }
  } finally { editor.destroy(); }
});


it('preserves an unsupported future journal without rewriting or uploading it', async () => {
  const saved = JSON.stringify({ ...fixture.journal, version: 999 });
  let writes = 0, requests = 0;
  const editor = new FileCollaborationClient({ server: 'https://fixture.invalid', workspaceId: 'compatibility', itemId: 'compatibility-item',
    journal: { load: () => saved, save: () => { writes++; }, remove: () => { writes++; } },
    request: async () => { requests++; throw new Error('Should not send incompatible state'); },
  });
  try {
    await editor.start();
    expect(editor.status).toBe('error');
    expect(writes).toBe(0);
    expect(requests).toBe(0);
  } finally { editor.destroy(); }
});
