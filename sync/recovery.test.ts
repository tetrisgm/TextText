import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as Y from 'yjs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { buildTextpack } from '@/lib/github/textpack';
import { emptyDocumentSnapshot } from '@/lib/documents/model';
import { documentText } from '@/lib/collab/document';
import { readVaultCollaboration, pushVaultCollaboration, readVaultTextpack, writeVaultTextpack } from '@/lib/vault/server-store';

// Each seed is replayable. These are the real durable store, TextPack projector
// and Yjs operations, not an imitation of the production merge algorithm.
describe('mixed writers converge despite reordered delivery and lost acknowledgements', () => {
  it.each([1, 7, 19, 41, 97, 313])('seed %i retains browser, Mac and direct-file edits exactly once', async seed => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'texttext-sync-chaos-'));
    const location = { root, workspaceId: 'workspace', itemId: 'item', onReceipt: async () => {} };
    const relativePath = 'Notes/Shared.textpack';
    const document = emptyDocumentSnapshot(); document.content.body = 'Original.';
    try {
      await writeVaultTextpack({ ...location, operationId: 'create', relativePath, baseRevision: null,
        bytes: buildTextpack('Shared', { document, markdown: '---\ntextTextId: item\n---\n\nOriginal.' }) });
      const initial = (await readVaultCollaboration(location))!;
      const updates = ['Browser', 'Mac', 'Agent'].map((name, index) => {
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, Buffer.from(initial.update, 'base64'));
          doc.clientID = seed * 10 + index + 1;
          const vector = Y.encodeStateVector(doc);
          const text = documentText(doc, 'body'); text.insert(text.length, ` ${name}-${seed}.`);
          return { name, update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64') };
        } finally { doc.destroy(); }
      });
      // A file agent saves while all three CRDT writers are still offline.
      const file = (await readVaultTextpack(location))!;
      const entries = unzipSync(file.bytes);
      const markdown = Object.keys(entries).find(name => name.endsWith('/text.md'))!;
      entries[markdown] = strToU8(strFromU8(entries[markdown]) + ` File-${seed}.`);
      await writeVaultTextpack({ ...location, operationId: 'file-edit', relativePath,
        baseRevision: file.revision, bytes: zipSync(entries), liveReconcile: true });
      let random = seed;
      const order = [...updates];
      for (let i = order.length - 1; i > 0; i--) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const j = random % (i + 1); [order[i], order[j]] = [order[j], order[i]];
      }
      for (const entry of order) {
        const request = { ...location, operationId: entry.name, epoch: initial.epoch,
          updates: [entry.update], audit: { actorUserId: entry.name, actorType: 'human' as const } };
        // Persist first, lose the response/audit acknowledgement, then replay.
        await expect(pushVaultCollaboration({ ...request, onReceipt: async () => { throw new Error('Lost acknowledgement'); } }))
          .rejects.toThrow('Lost acknowledgement');
        await pushVaultCollaboration(request);
        await pushVaultCollaboration(request);
      }
      const final = (await readVaultCollaboration(location))!;
      expect(final.epoch).toBe(initial.epoch);
      const restarted = new Y.Doc();
      try {
        Y.applyUpdate(restarted, Buffer.from(final.update, 'base64'));
        const body = documentText(restarted, 'body').toString();
        for (const marker of ['Original.', ...['Browser', 'Mac', 'Agent', 'File'].map(n => `${n}-${seed}.`)]) {
          expect(body.split(marker).length - 1, `${marker} must survive exactly once`).toBe(1);
        }
        const stable = (await readVaultTextpack(location))!;
        await readVaultCollaboration(location);
        expect((await readVaultTextpack(location))!.revision).toBe(stable.revision);
      } finally { restarted.destroy(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
