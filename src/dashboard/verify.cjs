const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const real=JSON.parse(fs.readFileSync('data/processed/rmove/incidencia_2025_06_05.json','utf8'));
const elements={}, features=[];
const document={getElementById(id){return elements[id]??={value:id==='event'?'2025-06-05':'',hidden:false,innerHTML:'',textContent:''};},querySelectorAll(){return [];}};
function feature(type,coordinates,options){return {type,coordinates,options,events:{},bindTooltip(){return this;},on(event,fn){this.events[event]=fn;return this;},addTo(){features.push(this);return this;}};}
const L={map:()=>({invalidateSize(){},fitBounds(){},removeLayer(){}}),layerGroup:()=>({addTo(){return this;},clearLayers(){features.length=0;}}),polyline:(p,o)=>feature('line',p,o),circleMarker:(p,o)=>feature('node',p,o),marker:(p,o)=>feature('arrow',p,o),divIcon:o=>o};
const context=vm.createContext({document,L,window:{L},console,fetch:async()=>({ok:true,json:async()=>real})});
const run=code=>vm.runInContext(code,context);
run(fs.readFileSync('src/dashboard/network.js','utf8'));
run(fs.readFileSync('src/dashboard/dashboard.js','utf8'));
setImmediate(async()=>{
 assert.equal(features.filter(f=>f.type==='line').length,0);
 assert.equal(features.filter(f=>f.type==='node').length,5);
 assert.equal((elements.rows.innerHTML.match(/<tr>/g)||[]).length,20);
 assert.equal(elements['selection-charts'].hidden,true);
 features.find(f=>f.type==='node'&&f.coordinates[0]===41.306).events.click();
 assert.equal(features.filter(f=>f.type==='line').length,8);
 for(const code of ['08019','08056','08089','08301','08169']){
  elements.municipality.value=code;elements.municipality.onchange();
  for(const direction of ['out','in','both']){
   elements.direction.value=direction;elements.direction.onchange();
   const expected=real.relaciones.filter(r=>direction==='out'?r.municipio_origen===code:direction==='in'?r.municipio_destino===code:r.municipio_origen===code||r.municipio_destino===code);
   assert.equal(features.filter(f=>f.type==='line').length,expected.length);
   const visible=run('visibleRelations().map(r=>r.diferencia_pp)');
   for(let i=1;i<visible.length;i++)assert.ok(Math.abs(visible[i-1])>=Math.abs(visible[i]));
  }
 }
 run("chooseMunicipality('08089')");
 features.find(f=>f.type==='line').events.click();
 assert.equal(features.filter(f=>f.type==='line'&&f.options.weight===7).length,1);
 for(let i=0;i<20;i++){run(`select(${i})`);assert.equal(elements.ttl.textContent,real.relaciones[i].relacion);assert.ok(elements.filtered.innerHTML.includes(`data-i="${i}" aria-pressed="true"`));}
 run('select(0)');
 assert.match(elements.relation.innerHTML,/2\.834/);
 assert.match(elements.relation.innerHTML,/14,16/);
 assert.match(elements.relation.innerHTML,/-18,88 puntos porcentuales/);
 assert.match(elements.relation.innerHTML,/aumento fue inferior/);
 elements.overview.onclick();assert.equal(features.filter(f=>f.type==='line').length,0);assert.equal(elements['selection-charts'].hidden,true);
 elements.event.value='2025-03-07';elements.event.onchange();assert.equal(elements.analysis.hidden,true);assert.match(elements.status.textContent,/anomalía/);
 elements.q.value='R1';elements.q.onchange();assert.equal(elements.analysis.hidden,true);
 elements.event.value='2025-06-05';elements.event.onchange();assert.equal(elements.analysis.hidden,false);
 elements.back.onclick();assert.equal((elements.list.innerHTML.match(/data-line=/g)||[]).length,18);
 context.fetch=async()=>({ok:false,status:404});await run('load()');assert.equal(elements.analysis.hidden,true);assert.match(elements.status.textContent,/HTTP 404/);
 for(const name of ['index.html','dashboard.js','dashboard.css','network.js']){
  const text=fs.readFileSync(`src/dashboard/${name}`,'utf8');assert.ok(!/[\uFFFD\u00C3\u00C2]/u.test(text),`${name}: damaged encoding`);
 }
 assert.ok(!fs.readFileSync('src/dashboard/index.html','utf8').includes('Desviaci?n'));
 console.log('PASS: initial nodes only; municipality clicks; 15 municipality/direction combinations; map selection; all 20 relations; magnitude sorting; detail values; reset; pending event; lines; error handling; UTF-8.');
});
