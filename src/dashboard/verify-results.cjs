'use strict';
// Exercise the actual dashboard with versioned results, without map network calls.
// This validates compatibility only; it does not grant publication permission.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'publication.json')));
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = ['case-views.js', 'dashboard.js'].map(name => fs.readFileSync(path.join(__dirname, name), 'utf8'));

async function verify(date) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {value: '', innerHTML: '', textContent: '', hidden: false}]));
  const loaded = [];
  const context = vm.createContext({
    document: {getElementById: id => { assert.ok(elements[id], `Missing element: ${id}`); return elements[id]; }},
    window: {},  // Leaflet unavailable: exercise the supported offline fallback.
    fetch: async relative => {
      const url = new URL(relative, 'https://example.test/R-MOVE/src/dashboard/');
      assert.equal(url.origin, 'https://example.test');
      assert.ok(url.pathname.startsWith('/R-MOVE/data/processed/rmove/'));
      const name = url.pathname.slice('/R-MOVE/'.length);
      const bytes = fs.readFileSync(path.join(root, name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.results[name].sha256);
      loaded.push(name);
      return {ok: true, json: async () => JSON.parse(bytes)};
    }
  });
  for (const script of scripts) vm.runInContext(script, context);
  await vm.runInContext(`load(${JSON.stringify(date)})`, context);
  const data = JSON.parse(fs.readFileSync(path.join(root, loaded.at(-1))));
  assert.equal(data.version_esquema, 3);
  assert.equal(data.fecha_incidencia, date);
  const codes = new Set();
  for (const place of data.municipios) {
    assert.equal(typeof place.codigo, 'string');
    assert.equal(typeof place.nombre, 'string');
    assert.ok(!codes.has(place.codigo));
    codes.add(place.codigo);
    assert.ok(Number.isFinite(place.lat) && Math.abs(place.lat) <= 90);
    assert.ok(Number.isFinite(place.lon) && Math.abs(place.lon) <= 180);
  }
  for (const relation of data.relaciones) {
    assert.equal(relation.estado, 'ok');
    assert.ok(codes.has(relation.municipio_origen) && codes.has(relation.municipio_destino));
    assert.equal(typeof relation.relacion, 'string');
    for (const field of ['variacion_observada_pct', 'diferencia_viajes', 'viajes_observados', 'mediana_viajes_controles', 'n_controles']) {
      assert.ok(Number.isFinite(relation[field]), `Invalid ${field}`);
    }
  }
  assert.equal(elements.app.hidden, false);
  assert.equal(Number(elements['kpi-relations'].textContent), data.relaciones.length);
  assert.match(elements['relation-detail'].innerHTML, /RELACIÓN SELECCIONADA/);
  assert.equal((elements['top-relations'].innerHTML.match(/data-i=/g)||[]).length,data.relaciones.length,'Show every analysed relation initially');
  assert.match(elements['top-relations'].innerHTML,/ %<small>[^<]* viajes<\/small><\/b>/);
  const order=()=>[...elements['top-relations'].innerHTML.matchAll(/data-i="(\d+)"/g)].map(match=>data.relaciones[Number(match[1])]);
  let listed=order().map(r=>r.diferencia_viajes);
  assert.ok(listed.every((value,i)=>!i||listed[i-1]<=value),'By default the largest drops in trips come first');
  for(const [mode,key,dir] of [['up_n','diferencia_viajes',-1],['down_pct','variacion_observada_pct',1],['up_pct','variacion_observada_pct',-1]]){
    elements['rel-sort'].value=mode;elements['rel-sort'].onchange();
    listed=order().map(r=>r[key]);
    assert.ok(listed.every((value,i)=>!i||dir*(value-listed[i-1])>=0),`Sort ${mode}`);
  }
  elements['rel-sort'].value='';elements['rel-unusual'].checked=true;elements['rel-unusual'].onchange();
  assert.equal(order().length,data.relaciones.filter(r=>r.fuera_rango_intercuartil_viajes!==false).length,'Unusual-only filter');
  assert.ok(order().every(r=>r.fuera_rango_intercuartil_viajes!==false));
  elements['rel-unusual'].checked=false;elements['rel-unusual'].onchange();
  assert.match(elements['rel-count'].textContent,/fuera de lo habitual/);
  vm.runInContext('chooseRelation(0)',context);
  assert.match(elements['relation-detail'].innerHTML,/Rango habitual/);
  assert.ok(!elements['relation-detail'].innerHTML.includes('NaN'));
  vm.runInContext('chooseRelation(0)',context);
  assert.equal((elements['top-relations'].innerHTML.match(/data-i=/g)||[]).length,data.relaciones.length,'Selecting a relation keeps the full list');
  assert.ok(!elements.status.textContent.startsWith('No se pudieron'));
  for (const direction of ['out', 'in', 'both']) {
    elements.municipality.onchange({target: {value: data.municipios[0].codigo}});
    elements.direction.onchange({target: {value: direction}});
    assert.ok(!elements['relation-detail'].innerHTML.includes('NaN'));
    assert.ok(!elements['top-relations'].innerHTML.includes('NaN'));
    const code=data.municipios[0].codigo;
    const expected=data.relaciones.filter(r=>direction==='out'?r.municipio_origen===code:direction==='in'?r.municipio_destino===code:r.municipio_origen===code||r.municipio_destino===code).length;
    assert.equal((elements['top-relations'].innerHTML.match(/data-i=/g)||[]).length,expected,'Filters retain every matching relation');
  }
  const before=loaded.length;
  await vm.runInContext("load('network')",context);
  assert.equal(loaded.length,before,'Network-only mode must not load case results');
  assert.equal(vm.runInContext('data',context),null);
  assert.equal(elements.app.hidden,false);
  assert.equal(elements['incident-title'].textContent,'Solo líneas de Rodalies');
  for(const id of ['case-kpis','case-results','case-information','case-filters','railway-context','variation-legend'])assert.equal(elements[id].hidden,true);
  await vm.runInContext(`load(${JSON.stringify(date)})`,context);
  assert.equal(elements['case-results'].hidden,false);
  assert.equal(elements['variation-legend'].hidden,false);
  assert.equal(Number(elements['kpi-relations'].textContent),data.relaciones.length);
  if(date==='2025-02-07') {
    let complete;const normalFetch=context.fetch;
    context.fetch=()=>new Promise(resolve=>{complete=resolve;});
    const pending=vm.runInContext('load()',context);
    await vm.runInContext("load('network')",context);
    complete({ok:true,json:async()=>data});await pending;
    assert.equal(vm.runInContext('data',context),null,'A pending case must not overwrite network-only mode');
    assert.equal(elements['incident-title'].textContent,'Solo líneas de Rodalies');
    context.fetch=normalFetch;
  }
  console.log(`${date}: ${data.municipios.length} municipalities, ${data.relaciones.length} relations; hashes, loading, detail and filters OK`);
}

(async () => {
  for (const date of ['2025-06-05', '2025-02-07','2025-03-17','2023-05-02','2024-04-29']) await verify(date);
})().catch(error => { console.error(error); process.exitCode = 1; });
