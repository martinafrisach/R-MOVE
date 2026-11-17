'use strict';
// Comprueba las páginas «Resultados» y ficha de incidencia con el JSON real exportado por el notebook 04 y su hash.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'publication.json')));
const relativeData='data/processed/rmove/resultados/dashboard_resultados.json';
const raw=fs.readFileSync(path.join(root,relativeData));
assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.results[relativeData]?.sha256,'Actualiza el hash de resultados en publication.json');
assert.ok(html.indexOf('src="conclusions.js')<html.indexOf('src="overview.js'),'conclusions.js debe cargarse antes que overview.js');
const elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{
  value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},parentElement:null
}]));
elements['concl-direction'].value='ida';elements['concl-group'].value='';elements['res-event-case'].value='';
elements['conclusions-view'].hidden=true;elements['conclusions-content'].hidden=true;elements['incident-view'].hidden=true;
let fail=false;const opened=[];
const context=vm.createContext({document:{getElementById:id=>{assert.ok(elements[id],`Missing element ${id}`);return elements[id];}},window:{},
  fetch:async relative=>{
    const url=new URL(relative,'https://example.test/R-MOVE/src/dashboard/');
    if(url.pathname.endsWith('railway-network.geojson'))return {ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'railway-network.geojson')))};
    assert.equal(url.pathname,'/R-MOVE/'+relativeData);
    if(fail)return {ok:false,status:503};
    return {ok:true,json:async()=>JSON.parse(raw)};
  }});
context.window=context;context.window.RMoveOverview={showView:(view,date)=>opened.push([view,date])};
vm.runInContext(fs.readFileSync(path.join(__dirname,'conclusions.js'),'utf8'),context);
const clean=id=>assert.ok(!/NaN|undefined|Infinity/.test(elements[id].innerHTML),`${id} contiene valores no válidos`);
(async()=>{
  await context.RMoveConclusions.ready;await new Promise(setImmediate);
  const data=JSON.parse(raw);
  assert.equal(elements['conclusions-content'].hidden,false);
  assert.equal(elements['conclusions-status'].textContent,'');
  assert.match(elements['res-answer'].innerHTML,/alternativa/);
  assert.equal((elements['conclusions-cards'].innerHTML.match(/<article/g)||[]).length,4);
  assert.equal((elements['conclusions-kpis'].innerHTML.match(/general-kpi/g)||[]).length,data.kpis.length);
  for(const id of ['res-who','res-loss','res-lines','res-placebo','concl-event','concl-barrios']){assert.match(elements[id].innerHTML,/<svg/,id);clean(id);}
  assert.match(elements['res-who'].innerHTML,/p &lt; 0,001|p < 0,001|n\.s\./);
  assert.equal((elements['res-loss'].innerHTML.match(/data-date=/g)||[]).length,data.incidencias.length);
  assert.equal((elements['res-lines'].innerHTML.match(/data-date=/g)||[]).length,data.incidencias.length);
  assert.match(elements['res-placebo'].innerHTML,/Efecto observado/);
  assert.equal((elements['res-event-case'].innerHTML.match(/<option/g)||[]).length,data.incidencias.length+1);
  for(const c of ['',...data.incidencias.map(i=>i.fecha)]){elements['res-event-case'].value=c;elements['res-event-case'].onchange();assert.match(elements['concl-event'].innerHTML,/Día 0/);clean('concl-event');}
  for(const direction of ['ida','vuelta']){elements['concl-direction'].value=direction;elements['concl-direction'].onchange();assert.match(elements['concl-barrios'].innerHTML,/<rect/);clean('concl-barrios');}
  // Pulsar un día del gráfico abre su ficha.
  elements['res-lines'].onclick({target:{closest:()=>({dataset:{date:data.incidencias[0].fecha}})}});
  assert.deepEqual(opened.at(-1),['incident',data.incidencias[0].fecha]);
  // Ficha de cada incidencia.
  elements['incident-view'].hidden=false;
  for(const c of data.incidencias){
    assert.equal(await context.RMoveConclusions.showIncident(c.fecha),c.fecha);
    assert.equal(elements['inc-content'].hidden,false);
    assert.equal(elements['inc-title'].textContent,c.titulo);
    assert.equal((elements['inc-kpis'].innerHTML.match(/general-kpi/g)||[]).length,4);
    for(const id of ['inc-series','inc-event','inc-tramos']){assert.match(elements[id].innerHTML,/<svg/,`${id} ${c.fecha}`);clean(id);}
    assert.match(elements['inc-series'].innerHTML,/Día de caos/);
    for(const group of ['','dependientes','cercanos','metro_fgc','sin_rodalies']){
      elements['concl-group'].value=group;elements['concl-group'].onchange();
      for(const id of ['concl-detail','concl-ranking'])clean(id);
    }
    elements['concl-group'].value='';elements['concl-group'].onchange();
    assert.match(elements['concl-detail'].innerHTML,/Efecto por grupo/);
  }
  // Por defecto el mapa y el ranking solo muestran municipios con efecto claro (p < 0,05).
  for(const c of data.incidencias){
    await context.RMoveConclusions.showIncident(c.fecha);
    const claros=c.municipios.filter(m=>m.p_valor<0.05).length;
    elements['inc-show-all'].checked=false;elements['inc-show-all'].onchange();
    assert.equal((elements['concl-ranking'].innerHTML.match(/data-code=/g)||[]).length,Math.min(15,claros),`ranking claro ${c.fecha}`);
    assert.match(elements['inc-map-count'].textContent,new RegExp(`^${claros} de ${c.municipios.length}`));
    elements['inc-show-all'].checked=true;elements['inc-show-all'].onchange();
    assert.equal((elements['concl-ranking'].innerHTML.match(/data-code=/g)||[]).length,Math.min(15,c.municipios.length));
    elements['inc-show-all'].checked=false;elements['inc-show-all'].onchange();
  }
  const first=data.incidencias[0];
  await context.RMoveConclusions.showIncident(first.fecha);
  elements['concl-ranking'].onclick({target:{closest:()=>({dataset:{code:first.municipios[0].codigo}})}});
  assert.match(elements['concl-detail'].innerHTML,new RegExp(first.municipios[0].nombre.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  fail=true;await context.RMoveConclusions.loadConclusions();
  assert.equal(elements['conclusions-content'].hidden,true);
  assert.match(elements['conclusions-status'].textContent,/503/);
  assert.equal(await context.RMoveConclusions.showIncident(first.fecha),null);
  assert.match(elements['inc-status'].textContent,/503/);
  console.log('Resultados: hash, respuesta, KPI, tarjetas, seis gráficos, selectores, fichas de las incidencias, mapa/ranking solo con efecto claro y error de carga OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
