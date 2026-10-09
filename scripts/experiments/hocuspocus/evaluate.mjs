// Isolated loopback evaluation, not a production service or acceptance substitute.
import { Server } from '@hocuspocus/server';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'texttext-provider-evaluation-'));
const persisted = path.join(directory, 'saved.bin');
let saved = execFileSync(process.execPath, ['--import', 'tsx', '-e', `const {emptyDocumentSnapshot}=require('./src/lib/documents/model.ts');const {encodeDocumentBaseline}=require('./src/lib/collab/document.ts');const d=emptyDocumentSnapshot();d.content.title='Provider evaluation';d.content.body='Baseline';process.stdout.write(Buffer.from(encodeDocumentBaseline(d,'provider-evaluation')));`], { cwd: root });
let stores = 0;
let server;
const clients = [];
const body = doc => doc.getMap('document').get('body');
async function until(fn) { const end=Date.now()+10000; while(!fn()){if(Date.now()>end)throw Error('Convergence timed out');await new Promise(r=>setTimeout(r,20));} }
async function boot(port=0) {
 server=new Server({port,address:'127.0.0.1',quiet:true,debounce:10,maxDebounce:25,
  async onAuthenticate({token}) {if(token!=='local-fixture')throw Error('Denied');},
  async onLoadDocument({document}) {Y.applyUpdate(document,saved);},
  async onStoreDocument({document}) {saved=Y.encodeStateAsUpdate(document);await writeFile(persisted,saved);stores++;},
 }); await server.listen();
}
async function client() {
 const doc=new Y.Doc();const socket=new HocuspocusProviderWebsocket({url:server.webSocketURL,WebSocketPolyfill:WebSocket,initialDelay:10,minDelay:10,maxDelay:100});
 const provider=new HocuspocusProvider({name:'texttext-fixture',document:doc,token:'local-fixture',websocketProvider:socket});
 provider.attach();clients.push({doc,provider,socket});await until(()=>provider.isSynced);return clients.at(-1);
}
try {
 await boot();const a=await client(),b=await client();
 a.socket.disconnect(); b.socket.disconnect();
 await new Promise(r=>setTimeout(r,100));
 body(a.doc).insert(body(a.doc).length,' [A]');body(b.doc).insert(body(b.doc).length,' [B]');
 await a.socket.connect();await b.socket.connect();
 await until(()=>body(a.doc).toString()===body(b.doc).toString()&&body(a.doc).toString().includes('[A]')&&body(a.doc).toString().includes('[B]'));
 console.log('PASS disconnected simultaneous edits converge through standard providers');
 const connection=await server.hocuspocus.openDirectConnection('texttext-fixture');
 await connection.transact(doc=>body(doc).insert(body(doc).length,' [FILE]'));
 await connection.disconnect();await until(()=>body(a.doc).toString().includes('[FILE]')&&body(b.doc).toString().includes('[FILE]'));
 console.log('PASS server-side file projection reaches both existing Y.Docs');
 const expected=body(a.doc).toString();await until(()=>stores>0);
 const port=server.address.port;
 for(const c of clients){c.provider.destroy();c.socket.destroy();c.doc.destroy();}clients.length=0;
 await server.destroy();saved=await readFile(persisted);
 await boot(port);const c=await client();assert.equal(body(c.doc).toString(),expected);
 assert.equal(expected.split('[A]').length,2);assert.equal(expected.split('[B]').length,2);
 console.log('PASS binary persistence and server restart preserve content without reseeding');
} finally {for(const c of clients){c.provider.destroy();c.socket.destroy();c.doc.destroy();}await server?.destroy();}
