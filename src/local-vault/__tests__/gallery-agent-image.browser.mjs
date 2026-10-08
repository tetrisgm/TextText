import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import { createWebAssistant } from './src/local-vault/web-assistant';
import { emptyDocumentSnapshot } from './src/lib/documents/model';
import { galleryAgentImage } from './src/local-vault/gallery-agent-image';
function png(color, width) { const canvas=document.createElement('canvas');canvas.width=width;canvas.height=100;const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,width,100);return canvas.toDataURL('image/png').split(',')[1]; }
const documentSnapshot=emptyDocumentSnapshot();documentSnapshot.content.assets=[{id:'neighbor',kind:'image',src:'assets/red.png'},{id:'selected',kind:'image',src:'assets/blue.png'}];
const file={path:'Gallery/A.textpack',hash:'current',markdown:'---\\ntextTextId: "photo-item"\\n---\\n',documentJSON:JSON.stringify(documentSnapshot),assets:[{filename:'red.png',contentType:'image/png',data:png('#ff0000',100)},{filename:'blue.png',contentType:'image/png',data:png('#0000ff',2000)}]};
window.__requests=[];window.__events=[];window.__file=file;
const fetcher=async(url,init)=>{window.__requests.push(JSON.parse(init.body));return new Response(JSON.stringify({type:'complete',text:'Prepared'})+'\\n');};
window.__adapter=createWebAssistant('test',async()=>file,fetcher,event=>window.__events.push(event),true);
window.__send=(id='selected')=>window.__adapter.request('agentSend',{taskId:'photo-turn',path:file.path,prompt:'Describe selected photo',imageAssetId:id});
window.__noise=async()=>{const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1600;const context=canvas.getContext('2d'),pixels=context.createImageData(1600,1600);let seed=17;for(let i=0;i<pixels.data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;pixels.data[i]=i%4===3?255:seed>>>24;}context.putImageData(pixels,0,0);const data=canvas.toDataURL('image/png').split(',')[1];const noisy={...file,assets:[file.assets[0],{filename:'blue.png',contentType:'image/png',data}]};const before=JSON.stringify(noisy);const attachment=await galleryAgentImage(noisy,'selected');const bitmap=await createImageBitmap(await(await fetch(attachment.dataUrl)).blob());try{return {length:attachment.dataUrl.length,width:bitmap.width,height:bitmap.height,unchanged:JSON.stringify(noisy)===before,originalLength:canvas.toDataURL('image/jpeg',0.75).length};}finally{bitmap.close();}};
` }, bundle: true, write: false, format: "iife", platform: "browser" });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const original = await page.evaluate(() => JSON.stringify(window.__file));
  await page.evaluate(() => window.__send());
  const result = await page.evaluate(async () => {
    const context = window.__requests[0].context, attachment = context.attachments[0];
    const image = await createImageBitmap(await (await fetch(attachment.dataUrl)).blob());
    try { const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const drawing=canvas.getContext('2d');drawing.drawImage(image,0,0);return { context, width:image.width, pixel:[...drawing.getImageData(0,0,1,1).data], count:window.__requests.length }; } finally { image.close(); }
  });
  assert.equal(result.count, 1); assert.equal(result.context.postId, "photo-item");
  assert.equal(result.context.mode, "workspace_review"); assert.equal(result.context.attachments.length, 1);
  assert.equal(result.width, 1600); assert.ok(result.pixel[2] > 240 && result.pixel[0] < 20);
  assert.ok(result.context.attachments[0].dataUrl.length < 1_000_000);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__file)), original);
  const noisy = await page.evaluate(() => window.__noise());
  assert.ok(noisy.originalLength > 1_000_000, 'fixture must exercise adaptive resizing');
  assert.ok(noisy.length <= 1_000_000); assert.ok(noisy.width < 1600);
  assert.equal(noisy.width, noisy.height); assert.equal(noisy.unchanged, true);
  await page.evaluate(() => window.__send("missing"));
  assert.match(await page.evaluate(() => window.__events.at(-1).message), /selected photo changed/);
  assert.equal(await page.evaluate(() => window.__requests.length), 1);
  await page.evaluate(() => {
    const decode = window.createImageBitmap;
    window.createImageBitmap = async (...args) => { const image = await decode(...args); return new Promise(resolve => { window.__finishDecode=()=>resolve(image); }); };
    window.__pending=window.__send();
  });
  await page.waitForFunction(() => !!window.__finishDecode);
  await page.evaluate(async () => { window.__adapter.destroy();window.__finishDecode();await window.__pending; });
  assert.equal(await page.evaluate(() => window.__requests.length), 1);
  assert.equal(await page.evaluate(() => window.__events.at(-1).type), "turn-cancelled");
  console.log("Selected-image browser conversion, bounded input, unchanged originals and cancellation passed.");
} finally { await browser.close(); }
