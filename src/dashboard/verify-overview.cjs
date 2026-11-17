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
  value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},attributes:{},
  setAttribute(key,value){this.attributes[key]=value;}
}]));
elements['general-direction'].value='entradas';elements['recurrence-exposure'].value='directa';
elements['case-view'].hidden=true;elements['general-content'].hidden=true;
let failGeneral=false,failBoard=false;
elements['concl-direction'].value='ida';elements['concl-group'].value='';elements['res-event-case'].value='';elements['incident-view'].hidden=true;
const context=vm.createContext({document:{getElementById:id=>{assert.ok(elements[id],`Missing element ${id}`);return elements[id];}},window:{},
  fetch:async relative=>{
    const url=new URL(relative,'https://example.test/R-MOVE/src/dashboard/');
    assert.ok(url.pathname.startsWith('/R-MOVE/data/processed/rmove/'));
    const relativePath=url.pathname.slice('/R-MOVE/'.length);
    if(failGeneral&&relativePath.endsWith('dashboard_general.json'))return {ok:false,status:503};
    if(failBoard&&relativePath.endsWith('dashboard_resultados.json'))return {ok:false,status:503};
    const bytes=fs.readFileSync(path.join(root,relativePath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.results[relativePath].sha256);
    return {ok:true,json:async()=>JSON.parse(bytes)};
  }
});
for(const name of ['case-views.js','dashboard.js','conclusions.js','overview.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,name),'utf8'),context);
(async()=>{
  assert.equal(elements['incident-board'].hidden,false,'Start on the incident selection board');
  assert.equal(elements['view-nav'].hidden,false);
  assert.equal(elements['general-view'].hidden,true);
  assert.equal(elements['case-view'].hidden,true);
  await context.window.RMoveOverview.loadBoard();
  // El panel lista los días de caos del notebook 04 (dashboard_resultados.json).
  const days=JSON.parse(fs.readFileSync(path.join(root,'data/processed/rmove/resultados/dashboard_resultados.json'))).incidencias.length;
  assert.equal((elements['board-rows'].innerHTML.match(/class="board-row"/g)||[]).length,days);
  assert.match(elements['board-rows'].innerHTML,/Robo de cobre en Montcada/);
  assert.match(elements['board-rows'].innerHTML,/dependientes/);
  assert.equal(elements['board-status'].textContent,'');
  elements['board-search'].value='montcada';elements['board-search'].oninput();
  assert.equal((elements['board-rows'].innerHTML.match(/class="board-row"/g)||[]).length,1);
  assert.match(elements['board-rows'].innerHTML,/2024-05-13/);
  elements['board-rows'].onclick({target:{closest:()=>({dataset:{caseDate:'2024-05-13'}})}});
  await new Promise(setImmediate);await new Promise(setImmediate);
  assert.equal(elements['incident-board'].hidden,true);
  assert.equal(elements['incident-view'].hidden,false);
  assert.equal(elements['view-nav'].hidden,false);
  assert.equal(elements['inc-title'].textContent,'Robo de cobre en Montcada');
  elements['inc-back'].onclick();
  assert.equal(elements['incident-board'].hidden,false);
  assert.equal(elements['incident-view'].hidden,true);
  assert.equal(elements['board-search'].value,'montcada','Keep search when returning');
  elements['board-search'].value='sin coincidencias';elements['board-search'].oninput();
  assert.match(elements['board-status'].textContent,/No hay incidencias/);
  elements['board-search'].value='';elements['board-search'].oninput();
  assert.equal((elements['board-rows'].innerHTML.match(/class="board-row"/g)||[]).length,days);
  failBoard=true;await context.window.RMoveConclusions.loadConclusions();await context.window.RMoveOverview.loadBoard();
  assert.equal(elements['board-retry'].hidden,false);
  assert.match(elements['board-status'].textContent,/No se pudieron cargar/);
  failBoard=false;await elements['board-retry'].onclick();
  assert.equal(elements['board-retry'].hidden,true);
  assert.equal((elements['board-rows'].innerHTML.match(/class="board-row"/g)||[]).length,days);
  // Las relaciones OD de los casos siguen disponibles desde el análisis general.
  context.window.RMoveOverview.showView('cases','2023-05-02');
  await new Promise(setImmediate);
  assert.equal(elements['view-nav'].hidden,true);
  assert.equal(vm.runInContext('currentCase',context),'2023-05-02');
  assert.equal(Number(elements['kpi-relations'].textContent),20);
  elements['case-back'].onclick();
  assert.equal(elements['view-nav'].hidden,false);
  assert.equal(elements['incident-board'].hidden,false);
  assert.equal(elements['case-view'].hidden,true);
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
  assert.equal(elements['nav-cases'].attributes['aria-pressed'],'true');
  assert.equal(vm.runInContext('currentCase',context),'2023-05-02');
  assert.equal(Number(elements['kpi-relations'].textContent),20);
  context.window.RMoveOverview.showView('cases','network');
  await new Promise(setImmediate);
  assert.equal(vm.runInContext('currentCase',context),'network');
  assert.equal(elements['case-view'].hidden,false);
  assert.equal(elements['case-results'].hidden,true);
  assert.equal(elements['incident-title'].textContent,'Solo líneas de Rodalies');
  context.window.RMoveOverview.showView('general');
  assert.equal(elements['case-view'].hidden,true);
  assert.equal(elements['general-view'].hidden,false);
  failGeneral=true;
  await context.window.RMoveOverview.loadOverview();
  assert.equal(elements['general-content'].hidden,true);
  assert.match(elements['general-status'].textContent,/503/);
  console.log('Overview: panel de días de caos, ficha de incidencia, cuatro preguntas, hashes reales, gráficos, filtros, cinco casos OD, navegación y errores OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
