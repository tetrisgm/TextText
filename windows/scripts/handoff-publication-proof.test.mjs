import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('native wire preserves only the typed pre-open handoff proof',()=>{
 const main=read('TextText.Windows/MainWindow.cs'),bridge=read('TextText.Windows/WindowsBridge.cs');
 assert.match(main,/catch\(HandoffNotOpenException\)[^\n]*code = "handoff_not_open"/);
 assert.ok(main.indexOf('catch(HandoffNotOpenException)')<main.indexOf('code = "NATIVE_ERROR"'));
 const start=bridge.indexOf('case "collaboration.open":'),open=bridge.indexOf('await editing.OpenAsync',start);
 const preparation=bridge.slice(start,open);
 assert.match(preparation,/catch\(RetainedReplacementProfile\.PreparationBusyException\)/);
 assert.match(preparation,/ct\.ThrowIfCancellationRequested\(\)/);
 assert.match(preparation,/RequireLocalHandoffPrincipal/);
 assert.match(preparation,/editingItems\.Values\.Contains/);
 assert.ok(preparation.indexOf('var itemId=Required')<preparation.indexOf('AccountRootOwnership.Open'));
 assert.match(bridge,/await editing\.RecoverAsync[^\n]*;editingItems\.Remove\(token\)/);
 assert.equal(bridge.slice(open,bridge.indexOf('case "collaboration.checkpoint":',open)).includes('catch('),false);
});
test('lease busy classification is restricted to native sharing and lock errors',()=>{
 const lease=read('TextText.Core/RetainedFileReplacement.cs'),profile=read('TextText.Core/RetainedReplacementProfile.cs');
 assert.match(lease,/if\(error is 32 or 33\)throw new LeaseBusyException\(\)/);
 assert.match(profile,/catch\(RetainedFileReplacement\.LeaseBusyException error\)/);
 assert.equal(profile.includes('catch(IOException error)'),false);
});
