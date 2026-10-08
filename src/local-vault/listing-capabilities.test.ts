import {describe,it,expect} from 'vitest';
import {listingCapabilities} from './listing-capabilities';
import type {VaultListing} from './bridge';
const base:VaultListing={root:'/local',items:[{path:'Notes/a.textpack',itemId:'a',canEditContent:true},{path:'Notes/b.textpack',itemId:'b',canEditContent:false}],fullAccess:false,canCreateContent:false,writableFolders:['Notes']};
describe('shared listing capabilities',()=>{
 it('allows folder editor creation only within granted folder, not move/delete',()=>{const c=listingCapabilities(base,null,true);expect(c.create('Notes')).toBe(true);expect(c.create('Notes/Child')).toBe(true);expect(c.create('NotesOther')).toBe(false);expect(c.create('')).toBe(false);expect(c.manageFiles).toBe(false);expect(c.edit('Notes/a.textpack')).toBe(true);expect(c.edit('Notes/b.textpack')).toBe(false);expect(c.edit('retained-copy.textpack')).toBe(false);});
 it('denies missing scoped permissions and honors explicit view-only on native',()=>{const c=listingCapabilities({...base,writableFolders:undefined,items:[{path:'Notes/a.textpack'}]},null,true);expect(c.create('Notes')).toBe(false);expect(c.edit('Notes/a.textpack')).toBe(false);});
 it('requires both full access and write capability for move/delete',()=>{expect(listingCapabilities({...base,fullAccess:true},null,true).manageFiles).toBe(false);expect(listingCapabilities({...base,fullAccess:true,canCreateContent:true},null,true).manageFiles).toBe(true);});
 it('retains legacy local-only adapter behavior without granting web defaults',()=>{const legacy={root:'/local',items:[{path:'a'}]};expect(listingCapabilities(legacy,null,true).edit('a')).toBe(true);expect(listingCapabilities(legacy,null,false).edit('a')).toBe(false);});
});
