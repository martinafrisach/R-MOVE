'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'publication.json')));
const elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{
  value:'',textContent:'',innerHTML:'',hidden:false,attributes:{},
  setAttribute(key,value){this.attributes[key]=value;}
}]));
elements.event.value='2025-06-05';elements.sort.value='absolute';
elements['general-direction'].value='entradas';elements['recurrence-exposure'].value='directa';
elements['case-view'].hidden=true;elements['general-content'].hidden=true;
let failGeneral=false;
const context=vm.createContext({document:{getElementById:id=>{assert.ok(elements[id],`Missing element ${id}`);return elements[id];}},window:{},
  fetch:async relative=>{
    const url=new URL(relative,'https://example.test/R-MOVE/src/dashboard/');
    assert.ok(url.pathname.startsWith('/R-MOVE/data/processed/rmove/'));
    const relativePath=url.pathname.slice('/R-MOVE/'.length);
    if(failGeneral&&relativePath.endsWith('dashboard_general.json'))return {ok:false,status:503};
    const bytes=fs.readFileSync(path.join(root,relativePath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.results[relativePath].sha256);
    return {ok:true,json:async()=>JSON.parse(bytes)};
  }
});
for(const name of ['case-views.js','dashboard.js','overview.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,name),'utf8'),context);
(async()=>{
  await context.window.RMoveOverview.loadOverview();
  assert.equal(elements['general-content'].hidden,false);
  assert.equal(elements['general-status'].textContent,'');
  assert.equal((elements['research-questions'].innerHTML.match(/<article/g)||[]).length,4);
  assert.equal((elements['case-links'].innerHTML.match(/class="case-link"/g)||[]).length,5);
  assert.match(elements['magnitude-chart'].innerHTML,/<svg/);
  assert.match(elements['robustness-table'].innerHTML,/Sin las 5/);
  assert.match(elements['general-method'].innerHTML,/no son observaciones independientes/);
  for(const direction of ['entradas','salidas'])for(const exposure of ['directa','indirecta']){
    elements['general-direction'].value=direction;elements['recurrence-exposure'].value=exposure;
    elements['general-direction'].onchange();elements['recurrence-exposure'].onchange();
    for(const id of ['magnitude-chart','recurrence-table','robustness-table'])assert.ok(!/NaN|undefined/.test(elements[id].innerHTML));
  }
  context.window.RMoveOverview.showView('cases','2023-05-02');
  await new Promise(setImmediate);
  assert.equal(elements['general-view'].hidden,true);
  assert.equal(elements['case-view'].hidden,false);
  assert.equal(elements['case-picker'].hidden,false);
  assert.equal(elements['nav-cases'].attributes['aria-pressed'],'true');
  assert.equal(elements.event.value,'2023-05-02');
  assert.equal(Number(elements['kpi-relations'].textContent),20);
  context.window.RMoveOverview.showView('general');
  assert.equal(elements['case-view'].hidden,true);
  assert.equal(elements['general-view'].hidden,false);
  failGeneral=true;
  await context.window.RMoveOverview.loadOverview();
  assert.equal(elements['general-content'].hidden,true);
  assert.match(elements['general-status'].textContent,/503/);
  console.log('Overview: four questions, real data hashes, chart, sensitivity, filters, five case links, navigation and error handling OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
