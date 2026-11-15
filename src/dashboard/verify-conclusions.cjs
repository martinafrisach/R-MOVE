'use strict';
// Comprueba la página «Conclusiones» con el JSON real exportado y su hash de publication.json.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'publication.json')));
const relativeData='data/processed/rmove/conclusiones/dashboard_conclusiones.json';
const raw=fs.readFileSync(path.join(root,relativeData));
assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.results[relativeData]?.sha256,'Actualiza el hash de conclusiones en publication.json');
const elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{
  value:'',textContent:'',innerHTML:'',hidden:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;}
}]));
elements['concl-direction'].value='ida';elements['concl-group'].value='';
elements['conclusions-view'].hidden=true;elements['conclusions-content'].hidden=true;
let fail=false;
const context=vm.createContext({document:{getElementById:id=>{assert.ok(elements[id],`Missing element ${id}`);return elements[id];}},window:{},
  fetch:async relative=>{
    const url=new URL(relative,'https://example.test/R-MOVE/src/dashboard/');
    if(url.pathname.endsWith('railway-network.geojson'))return {ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'railway-network.geojson')))};
    assert.equal(url.pathname,'/R-MOVE/'+relativeData);
    if(fail)return {ok:false,status:503};
    return {ok:true,json:async()=>JSON.parse(raw)};
  }});
context.window=context;
vm.runInContext(fs.readFileSync(path.join(__dirname,'conclusions.js'),'utf8'),context);
(async()=>{
  await new Promise(setImmediate);await new Promise(setImmediate);
  const data=JSON.parse(raw);
  assert.equal(elements['conclusions-content'].hidden,false);
  assert.equal(elements['conclusions-status'].textContent,'');
  assert.equal((elements['conclusions-cards'].innerHTML.match(/<article/g)||[]).length,4);
  assert.equal((elements['conclusions-kpis'].innerHTML.match(/general-kpi/g)||[]).length,data.kpis.length);
  assert.equal((elements['concl-case'].innerHTML.match(/<option/g)||[]).length,data.mapa.length);
  assert.match(elements['concl-event'].innerHTML,/<svg/);
  assert.match(elements['concl-event'].innerHTML,/Día del corte/);
  for(const direction of ['ida','vuelta']){
    elements['concl-direction'].value=direction;elements['concl-direction'].onchange();
    assert.match(elements['concl-barrios'].innerHTML,/<rect/);
    assert.ok(!/NaN|undefined/.test(elements['concl-barrios'].innerHTML));
  }
  data.mapa.forEach((c,i)=>{
    elements['concl-case'].onchange({target:{value:String(i)}});
    for(const group of ['','dependientes','cercanos','metro_fgc','sin_rodalies']){
      elements['concl-group'].value=group;elements['concl-group'].onchange();
      for(const id of ['concl-detail','concl-ranking','concl-event'])assert.ok(!/NaN|undefined/.test(elements[id].innerHTML),`${id} ${c.fecha} ${group}`);
    }
    elements['concl-group'].value='';elements['concl-group'].onchange();
    assert.match(elements['concl-detail'].innerHTML,/Media por grupo/);
  });
  const first=data.mapa[0].municipios[0];
  elements['concl-case'].onchange({target:{value:'0'}});
  elements['concl-ranking'].onclick({target:{closest:()=>({dataset:{code:first.codigo}})}});
  assert.match(elements['concl-detail'].innerHTML,new RegExp(first.nombre.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  fail=true;await context.RMoveConclusions.loadConclusions();
  assert.equal(elements['conclusions-content'].hidden,true);
  assert.match(elements['conclusions-status'].textContent,/503/);
  console.log('Conclusiones: hash, cuatro tarjetas, KPI, selector de días, filtros de grupo, gráficos y error de carga OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
