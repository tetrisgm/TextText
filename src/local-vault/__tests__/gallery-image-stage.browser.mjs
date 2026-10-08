import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const result = await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{GalleryImageStage}from'./src/local-vault/GalleryImageStage';function Test(){const[id,setId]=useState(1),[caption,setCaption]=useState('Photo');return <><button onClick={()=>setCaption('Edited caption')}>Caption</button><button onClick={()=>setId(id+1)}>Next asset</button><GalleryImageStage key={id} src={'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#2d5778"/><rect width="150" height="150" fill="#ffd358"/><rect x="1050" y="650" width="150" height="150" fill="#eb846a"/></svg>')} alt={caption}/></>};createRoot(document.getElementById('root')).render(<Test/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/tmp/texttext-gallery-stage', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await chromium.launch();
try {
 const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
 const failures=[];page.on('pageerror',error=>failures.push(error.message));
 await page.setContent('<div class="vault-app" id="root"></div>');
 await page.addStyleTag({content:await readFile('src/local-vault/style.css','utf8')});
 await page.addStyleTag({content:result.outputFiles.find(file=>file.path.endsWith('.css')).text+' .vault-app .vault-gallery-stage{width:800px;height:600px;}'});
 await page.addScriptTag({content:result.outputFiles.find(file=>file.path.endsWith('.js')).text});
 const stage=page.getByRole('group',{name:'Image viewer',exact:true}), image=stage.locator('img');
 await image.waitFor();await page.waitForFunction(()=>document.querySelector('.vault-gallery-image-viewport img')?.naturalWidth===1200);
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 const box=await stage.boundingBox();assert(box);
 await stage.focus();for(let i=0;i<30;i++)await page.keyboard.press('ArrowLeft');for(let i=0;i<30;i++)await page.keyboard.press('ArrowUp');
 let bounds=await image.boundingBox();assert(Math.abs(bounds.x-box.x)<1);assert(Math.abs(bounds.y-box.y)<1);
 for(let i=0;i<30;i++)await page.keyboard.press('ArrowRight');for(let i=0;i<30;i++)await page.keyboard.press('ArrowDown');
 bounds=await image.boundingBox();assert(Math.abs(bounds.x+bounds.width-box.x-box.width)<1);assert(Math.abs(bounds.y+bounds.height-box.y-box.height)<1);
 const before=await image.getAttribute('style');await page.getByRole('button',{name:'Caption',exact:true}).click();assert.equal(await image.getAttribute('style'),before);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+100,box.y+box.height/2+100,{steps:5});await page.mouse.up();assert.notEqual(await image.getAttribute('style'),before);
 await page.getByRole('button',{name:'Fit image',exact:true}).click();assert.equal(await stage.getAttribute('data-zoomed'),'false');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Next asset',exact:true}).click();assert.equal(await stage.getAttribute('data-zoomed'),'false');
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:`/tmp/texttext-gallery-stage-${theme}.png`});}
 await page.setViewportSize({width:390,height:700});await page.addStyleTag({content:'.vault-app .vault-gallery-stage{width:360px;height:550px;}'});await page.screenshot({path:'/tmp/texttext-gallery-stage-narrow.png'});
 assert.deepEqual(failures,[]);console.log('PASS Gallery stage: keyboard reaches all edges, pointer pan, caption preserves position, fit and asset change reset, both themes and narrow layout.');
}finally{await browser.close();}
