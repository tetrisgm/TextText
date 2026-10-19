import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createShutdownDiagnostics} from './browser-adapter.mjs';
const source=readFileSync(new URL('./browser-adapter.mjs',import.meta.url),'utf8');
const options={monotonic:()=>42,utc:()=> '2026-10-19T00:00:00.000Z',pid:123};
function handler({close,retained=false,write}={}) {
 const records=[],exits=[];
 const diagnostic=createShutdownDiagnostics({...options,write:write??(line=>records.push(JSON.parse(line)))});
 const body=source.slice(source.indexOf("    async shutdown(origin = 'protocol')"),source.indexOf('\n  };',source.indexOf("    async shutdown(origin = 'protocol')")));
 const make=new Function('context','retainedFailure','shutdownDiagnostic','process',`let stopping=false;return {${body}};`);
 return {run:make({close:close??(()=>Promise.resolve())},retained,diagnostic,{exit:code=>exits.push(code)}).shutdown,records,exits};
}
test('fixed metadata is bounded and emitted once per stage/origin',()=>{
 const lines=[],emit=createShutdownDiagnostics({...options,write:line=>lines.push(line)});
 for(let i=0;i<100;i++)for(const origin of ['protocol','eof'])for(const stage of ['dispatch','handler-entry','retained-refusal','context-close-before','context-close-after','context-close-error','process-exit'])emit(stage,origin);
 emit('secret-value','protocol');emit('dispatch','secret-value');
 assert.equal(lines.length,14);for(const line of lines){assert(Buffer.byteLength(line)<=384);assert.deepEqual(Object.keys(JSON.parse(line)),['kind','stage','origin','monotonicMs','utc','pid']);}
});
test('actual shutdown handler preserves close then exit ordering',async()=>{const h=handler();await h.run('protocol');assert.deepEqual(h.records.map(x=>x.stage),['handler-entry','context-close-before','context-close-after','process-exit']);assert.deepEqual(h.exits,[0]);});
test('close rejection logs fixed error stage and preserves swallowed-error exit',async()=>{const h=handler({close:()=>Promise.reject(Error('secret URL document'))});await h.run('protocol');assert(h.records.some(x=>x.stage==='context-close-error'));assert(!JSON.stringify(h.records).includes('secret'));assert.deepEqual(h.exits,[0]);});
test('diagnostic write/clock failure cannot prevent normal shutdown',async()=>{const h=handler({write:()=>{throw Error('closed stderr');}});await h.run();assert.deepEqual(h.exits,[0]);const emit=createShutdownDiagnostics({...options,monotonic:()=>{throw Error('clock');},write:()=>assert.fail()});assert.doesNotThrow(()=>emit('dispatch','protocol'));
 const callbacks=[],delayed=handler({write:(_line,callback)=>callbacks.push(callback)});
 await delayed.run();assert.deepEqual(delayed.exits,[0]);assert.equal(callbacks.length,4);
 for(const callback of callbacks)assert.doesNotThrow(()=>callback(Error('full stderr')));
 assert(source.includes('write(2, line, callback)'));assert(!source.includes('writeSync'));
});
test('delayed close records boundary without early exit or timeout change',async()=>{let resolve;const h=handler({close:()=>new Promise(r=>resolve=r)});const pending=h.run();assert.deepEqual(h.records.map(x=>x.stage),['handler-entry','context-close-before']);assert.deepEqual(h.exits,[]);resolve();await pending;assert.deepEqual(h.exits,[0]);});
test('retained failure still refuses context close and exit',async()=>{const h=handler({retained:true,close:()=>assert.fail()});await h.run('eof');assert.deepEqual(h.records.map(x=>x.stage),['handler-entry','retained-refusal']);assert.deepEqual(h.exits,[]);});
test('protocol and EOF shutdown remain serialized on the same queue',async()=>{
 assert(source.includes("queue = queue.then(() => m.type === 'shutdown' ? handlers.shutdown('protocol') : handlers[m.type](m))"));
 assert(source.includes("queue = queue.then(() => handlers.shutdown('eof'))"));
 let resolve;const calls=[];const h=handler({close:()=>{calls.push('close');return calls.length===1?new Promise(r=>resolve=r):Promise.resolve();}});
 let queue=Promise.resolve();queue=queue.then(()=>h.run('protocol'));queue=queue.then(()=>h.run('eof'));await Promise.resolve();assert.equal(calls.length,1);resolve();await queue;assert.equal(calls.length,2);assert.deepEqual(h.records.filter(x=>x.stage==='handler-entry').map(x=>x.origin),['protocol','eof']);
 // Mock exit returns here; real process.exit ends before the queued duplicate.
});
