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
  elements.event.value = date;
  elements.sort.value = 'absolute';
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
  await vm.runInContext('load()', context);
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
  assert.ok(elements['top-relations'].innerHTML.includes('top-item'));
  assert.ok(!elements.status.textContent.startsWith('No se pudieron'));
  for (const direction of ['out', 'in', 'both']) {
    elements.municipality.onchange({target: {value: data.municipios[0].codigo}});
    elements.direction.onchange({target: {value: direction}});
    elements.sort.onchange({target: {value: 'percent'}});
    assert.ok(!elements['relation-detail'].innerHTML.includes('NaN'));
    assert.ok(!elements['top-relations'].innerHTML.includes('NaN'));
  }
  console.log(`${date}: ${data.municipios.length} municipalities, ${data.relaciones.length} relations; hashes, loading, detail and filters OK`);
}

(async () => {
  for (const date of ['2025-06-05', '2025-02-07']) await verify(date);
})().catch(error => { console.error(error); process.exitCode = 1; });
