const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const fixtures=Object.fromEntries(['2025-06-05','2025-02-07'].map(date=>[date,JSON.parse(fs.readFileSync(`data/processed/rmove/incidencia_${date.replaceAll('-','_')}.json`,'utf8'))]));
const elements={},features=[];
const document={getElementById(id){return elements[id]??={value:id==='event'?'2025-06-05':'',hidden:false,innerHTML:'',textContent:''};},querySelectorAll(){return [];}};
function feature(type,coordinates,options){return {type,coordinates,options,events:{},bindTooltip(){return this;},on(event,fn){this.events[event]=fn;return this;},addTo(){features.push(this);return this;}};}
const L={map:()=>({invalidateSize(){},fitBounds(){},removeLayer(){}}),layerGroup:()=>({addTo(){return this;},clearLayers(){features.length=0;}}),polyline:(p,o)=>feature('line',p,o),circleMarker:(p,o)=>feature('node',p,o),marker:(p,o)=>feature('arrow',p,o),divIcon:o=>o};
let delayFebruary=false;
async function fetchFixture(url){
 const date=url.includes('2025_02_07')?'2025-02-07':'2025-06-05';
 if(delayFebruary&&date==='2025-02-07')await new Promise(r=>setTimeout(r,20));
 return {ok:true,json:async()=>structuredClone(fixtures[date])};
}
const context=vm.createContext({document,L,window:{L},console,fetch:fetchFixture});
const run=code=>vm.runInContext(code,context);
for(const file of ['network.js','case-views.js','dashboard.js'])run(fs.readFileSync('src/dashboard/'+file,'utf8'));
setImmediate(async()=>{try{
 for(const date of ['2025-06-05','2025-02-07']){
  elements.event.value=date;await elements.event.onchange();const fixture=fixtures[date];
  assert.equal(features.filter(f=>f.type==='line').length,0);
  assert.equal(features.filter(f=>f.type==='node').length,5);
  assert.equal((elements.rows.innerHTML.match(/<tr>/g)||[]).length,fixture.relaciones.length);
  assert.ok(elements['case-info'].innerHTML.includes(fixture.incidencia_documentada.id));
  assert.ok(elements['province-series'].innerHTML.includes('<svg'));
  assert.equal(elements['selection-charts'].hidden,true);
  features.find(f=>f.type==='node'&&f.coordinates[0]===fixture.municipios[1].lat).events.click();
  for(const m of fixture.municipios){
   elements.municipality.value=m.codigo;elements.municipality.onchange();
   for(const direction of ['out','in','both']){
    elements.direction.value=direction;elements.direction.onchange();
    const expected=fixture.relaciones.filter(r=>direction==='out'?r.municipio_origen===m.codigo:direction==='in'?r.municipio_destino===m.codigo:r.municipio_origen===m.codigo||r.municipio_destino===m.codigo);
    assert.equal(features.filter(f=>f.type==='line').length,expected.length);
    const visible=run('visibleRelations().map(r=>r.variacion_observada_pct)');
    for(let i=1;i<visible.length;i++)assert.ok(Math.abs(visible[i-1])>=Math.abs(visible[i]));
   }
  }
  for(let i=0;i<fixture.relaciones.length;i++){
   run(`select(${i})`);assert.equal(elements.ttl.textContent,fixture.relaciones[i].relacion);
   assert.ok(elements.filtered.innerHTML.includes(`data-i="${i}" aria-pressed="true"`));
   assert.ok(elements.temporal.innerHTML.includes('<svg'));
   assert.ok(elements.sensitivity.innerHTML.includes('Solo anteriores'));
  }
  const markers=features.filter(f=>f.type==='line');markers[0].events.click();
  assert.equal(features.filter(f=>f.type==='line'&&f.options.weight===7).length,1);
  assert.match(elements.reference.innerHTML,/viajes/);
  if(date==='2025-06-05'){
   run(`select(${fixture.relaciones.findIndex(r=>r.municipio_origen==='08089'&&r.municipio_destino==='08301')})`);
   assert.match(elements.relation.innerHTML,/-10,37 %/);assert.match(elements.relation.innerHTML,/3\.162/);
  }else{
   run(`select(${fixture.relaciones.findIndex(r=>r.municipio_origen==='08121'&&r.municipio_destino==='08019')})`);
   assert.match(elements.relation.innerHTML,/viernes comparables/);
   assert.match(elements.relation.innerHTML,/11\.646/);assert.match(elements.relation.innerHTML,/11\.224/);
   assert.match(elements['coverage-note'].textContent,/\+0,34 %/);
   assert.match(elements['availability-title'].textContent,/18.*2 excluidas/);
   assert.ok(!elements.municipality.innerHTML.includes('Castelldefels'));
  }
  elements.overview.onclick();assert.equal(features.filter(f=>f.type==='line').length,0);
  assert.equal(elements['relation-more'].hidden,true);
 }
 // Late responses must not replace the most recently selected case.
 delayFebruary=true;elements.event.value='2025-02-07';const older=elements.event.onchange();
 elements.event.value='2025-06-05';const newer=elements.event.onchange();await Promise.all([older,newer]);
 assert.equal(run('data.fecha_incidencia'),'2025-06-05');
 assert.ok(elements.municipality.innerHTML.includes('Castelldefels'));
 elements.back.onclick();assert.equal((elements.list.innerHTML.match(/data-line=/g)||[]).length,18);
 context.fetch=async()=>({ok:false,status:404});elements.event.value='2025-02-07';await elements.event.onchange();
 assert.equal(elements.analysis.hidden,true);assert.match(elements.status.textContent,/HTTP 404/);assert.equal(run('data'),null);
 for(const file of ['index.html','dashboard.js','case-views.js','dashboard.css'])assert.ok(!/[\uFFFD\u00C3\u00C2]/u.test(fs.readFileSync('src/dashboard/'+file,'utf8')));
 console.log('PASS: June and February; 30 municipality/direction combinations; 38 selectable OD; documentation; coverage; exclusions; series; sensitivity; reset; request race; errors; UTF-8.');
}catch(error){console.error(error);process.exitCode=1;}});
