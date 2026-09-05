import {it,expect} from 'vitest';
import * as Y from 'yjs';
import {preReadyTextOperations,applyPreReadyTextOperations} from '@/lib/collab/pre-ready';
function pair(base:string){const a=new Y.Doc(),b=new Y.Doc();a.getText('t').insert(0,base);Y.applyUpdate(b,Y.encodeStateAsUpdate(a));return {a,b};}
function reconcile(a:Y.Doc,base:string,local:string){applyPreReadyTextOperations(a.getText('t'),preReadyTextOperations(base,local,a.getText('t').toString()),'local');}
function sync(a:Y.Doc,b:Y.Doc){Y.applyUpdate(a,Y.encodeStateAsUpdate(b));Y.applyUpdate(b,Y.encodeStateAsUpdate(a));}
it('keeps emoji replacement intact across Yjs encoding',()=>{
 const {a,b}=pair('😀');reconcile(a,'😀','😁');sync(a,b);
 expect([a.getText('t').toString(),b.getText('t').toString()]).toEqual(['😁','😁']);a.destroy();b.destroy();
});
it('preserves local insertion order when peer deletes their separating baseline',()=>{
 const {a,b}=pair('abc');reconcile(b,'abc','');Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 reconcile(a,'abc','aXbYc');sync(a,b);
 expect([a.getText('t').toString(),b.getText('t').toString()]).toEqual(['XY','XY']);a.destroy();b.destroy();
});
it('does not delete a repeated peer insertion when deleting the last baseline character',()=>{
 const {a,b}=pair('aaa');b.getText('t').insert(2,'a');Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 reconcile(a,'aaa','aa');
 // B deletes its original baseline characters, leaving its inserted character.
 b.getText('t').delete(3,1);b.getText('t').delete(0,2);sync(a,b);
 expect([a.getText('t').toString(),b.getText('t').toString()]).toEqual(['a','a']);a.destroy();b.destroy();
});
it('preserves a peer replacement with identical visible text',()=>{
 const {a,b}=pair('abc');b.getText('t').delete(1,1);b.getText('t').insert(1,'b');Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 reconcile(a,'abc','ac');sync(a,b);
 expect([a.getText('t').toString(),b.getText('t').toString()]).toEqual(['abc','abc']);a.destroy();b.destroy();
});
it.each([
 ['abc','aXbc','ac','aXc'],['abc','ac','aYbc','aYc'],
 ['abcd','aXd','abYd','aXYd'],
 ['a'.repeat(200000)+'MIDDLE'+'z'.repeat(200000),'a'.repeat(200000)+'LOCAL'+'z'.repeat(200000),'a'.repeat(200000)+'MIDDLE'+'z'.repeat(200000)+'R','a'.repeat(200000)+'LOCAL'+'z'.repeat(200000)+'R'],
])('control %#',(base,local,remote,expected)=>{
 const a=new Y.Doc();a.getText('t').insert(0,remote);reconcile(a,base,local);expect(a.getText('t').toString()).toBe(expected);a.destroy();
});
it('does not damage a peer emoji replacement while deleting the original emoji',()=>{
 const {a,b}=pair('😀');b.getText('t').delete(0,2);b.getText('t').insert(0,'😁');Y.applyUpdate(a,Y.encodeStateAsUpdate(b));
 reconcile(a,'😀','');sync(a,b);
 expect([a.getText('t').toString(),b.getText('t').toString()]).toEqual(['😁','😁']);a.destroy();b.destroy();
});
