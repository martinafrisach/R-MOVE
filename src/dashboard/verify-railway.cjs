'use strict';
// Exercise layer interactions without external tiles or a browser dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const network = JSON.parse(fs.readFileSync(path.join(__dirname, 'railway-network.geojson')));
const source = fs.readFileSync(path.join(__dirname, 'railway.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /<script src="railway.js\?v=12"><\/script>/);
assert.ok(html.indexOf('src="railway.js') < html.indexOf('src="dashboard.js'));
const lines = network.features.filter(f => f.properties.kind === 'line');
const stations = network.features.filter(f => f.properties.kind === 'station');
assert.equal(lines.length, 8);
assert.equal(stations.length, 124);
const ids = new Set(stations.map(f => f.properties.id));
assert.equal(ids.size, stations.length);
function distanceToSegment(p, a, b) {
  const scale = [84000, 111000];
  const pa = p.map((v, i) => (v-a[i])*scale[i]);
  const ba = b.map((v, i) => (v-a[i])*scale[i]);
  const denom = ba[0]**2+ba[1]**2;
  const t = denom ? Math.max(0, Math.min(1, (pa[0]*ba[0]+pa[1]*ba[1])/denom)) : 0;
  return Math.hypot(pa[0]-t*ba[0], pa[1]-t*ba[1]);
}
for (const line of lines) {
  assert.match(line.properties.color, /^#[0-9a-f]{6}$/);
  const points = line.geometry.coordinates;
  assert.ok(points.length > 100, 'Detailed track geometry required');
  for (const point of points) {
    assert.ok(point.every(Number.isFinite));
    assert.ok(point[0] > 1 && point[0] < 4 && point[1] > 40 && point[1] < 43);
  }
  for (const id of line.properties.stops) {
    const station = stations.find(f => f.properties.id === id);
    assert.ok(station, `Missing ${id}`);
    assert.ok(station.properties.lines.includes(line.properties.id));
    const distance = Math.min(...points.slice(1).map((p, i) => distanceToSegment(station.geometry.coordinates, points[i], p)));
    assert.ok(distance < 250, `${station.properties.name} is ${Math.round(distance)} m off ${line.properties.id}`);
  }
}
assert.equal(lines.find(f => f.properties.id === 'R7').properties.stops[0], '78802');
assert.equal(lines.find(f => f.properties.id === 'R7').properties.color, '#ab74a4');
assert.ok(network.metadata.coordinate_corrections.some(row => row.stop_id === '77003'));

async function exercise(fail = false) {
  const elements = Object.fromEntries(['railway-line','railway-count','railway-labels','railway-legend','railway-route','railway-incident'].map(id => [id, {value:'',checked:true,disabled:true}]));
  const groups = [];
  let zoom = 10, fetches = 0, fits = 0;
  const events = {};
  const map = {createPane: () => ({style:{}}), getZoom: () => zoom,
    on: (name, fn) => {events[name] = fn;}, fitBounds: points => {assert.ok(points.length); fits++;}};
  function layer() {
    return {tooltip: null, bindTooltip(text, opts) {this.tooltip = {text,opts};return this;},
      bindPopup(text) {this.popup = text;return this;}, on(event, fn) {this[event]=fn;return this;}, addTo(group) {group.items.push(this);return this;}};
  }
  const context = vm.createContext({window:{}, document:{getElementById:id => elements[id]},
    fetch: async url => {assert.equal(url,'railway-network.geojson');fetches++;return {ok:!fail,status:503,json:async()=>network};},
    L: {layerGroup: () => {const g = {items:[],addTo(){groups.push(this);return this;},clearLayers(){this.items=[];}};return g;},
      geoJSON: (feature, options) => {const l = layer();l.feature=feature;l.options=options;return l;},
      circleMarker: (point, style) => {const l=layer();l.point=point;l.style=style;return l;}}
  });
  vm.runInContext(source, context);
  await context.window.RMoveRailway.mount(map);
  assert.equal(fetches,1);
  if (fail) {
    assert.match(elements['railway-count'].textContent, /No se pudo cargar/);
    assert.equal(elements['railway-line'].disabled,true);
    return;
  }
  assert.equal(groups[0].items.length,16);
  assert.equal(groups[1].items.length,124);
  assert.equal(groups[0].items[0].options.style.color,'#fff');
  assert.ok(groups[0].items[8].options.style.weight>=6);
  // R1 and R4 share Sants–Catalunya: separate in screen space, with the
  // same station endpoints. Source GeoJSON must remain untouched.
  const sourceBytes=JSON.stringify(network);
  function sharedSegment(id){
    const track=groups[0].items.find(layer=>layer.feature.properties.id===id&&layer.options.style.color!=='#fff').feature;
    const index=track.properties.stops.findIndex((stop,i)=>stop==='71801'&&track.properties.stops[i+1]==='78805');
    return track.geometry.coordinates[index];
  }
  function pixel([lon,lat]){const sin=Math.sin(lat*Math.PI/180),scale=256*2**zoom;return [(lon+180)/360*scale,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale];}
  function separation(){const a=sharedSegment('R1'),b=sharedSegment('R4'),i=Math.floor(a.length/2),p=pixel(a[i]),q=pixel(b[i]);return Math.hypot(p[0]-q[0],p[1]-q[1]);}
  const first=sharedSegment('R1'),second=sharedSegment('R4');
  assert.equal(JSON.stringify(first[0]),JSON.stringify(second[0]));
  assert.equal(JSON.stringify(first.at(-1)),JSON.stringify(second.at(-1)));
  assert.equal(first.length,5,'A straight shared section only needs short station joins');
  const p=first.map(pixel),q=second.map(pixel);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  assert.ok(Math.abs(cross(p[1],p[2],p[3]))<.001,'The middle section must be straight');
  const v=[p[3][0]-p[1][0],p[3][1]-p[1][1]],w=[q[3][0]-q[1][0],q[3][1]-q[1][1]];
  assert.ok(Math.abs(v[0]*w[1]-v[1]*w[0])<.001,'Shared lanes must be parallel');
  assert.ok(separation()>10,'Shared colours must be visibly separated');
  const gap=separation();zoom=13;events.zoomend();
  assert.ok(Math.abs(separation()-gap)<.1,'Lane spacing must remain stable in pixels when zoom changes');
  assert.equal(JSON.stringify(network),sourceBytes,'Visual offsets must not change source coordinates');
  zoom=10;events.zoomend();
  assert.equal(groups[1].items[0].tooltip.opts.permanent,false);
  zoom=12;events.zoomend();
  assert.equal(groups[1].items[0].tooltip.opts.permanent,true);
  elements['railway-labels'].checked=false;elements['railway-labels'].onchange();
  assert.equal(groups[1].items[0].tooltip.opts.permanent,false);
  elements['railway-line'].value='R7';elements['railway-line'].onchange();
  assert.equal(groups[0].items.length,2);
  assert.equal(groups[1].items.length,7);
  assert.equal(fits,1);
  assert.ok(groups[1].items.every(l=>l.popup.includes('R7')));
  elements['railway-line'].value='';elements['railway-line'].onchange();
  assert.equal(groups[1].items.length,124);
  const api=context.window.RMoveRailway;
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/processed/rmove/incidencia_2025_02_07.json')));
  const relation=data.relaciones.find(r=>r.municipio_origen==='08121'&&r.municipio_destino==='08019');
  assert.ok(relation);
  api.setSelection({data,rows:[{...relation,i:42}],selected:42,onChoose:()=>{}});
  const journey=api.route('08121','08019');
  assert.equal(journey.stops[0],'79500');
  assert.equal(journey.stops.at(-1),'71801');
  assert.ok(journey.edges.every(e=>e.line==='R1'));
  for(const id of ['79412','79410','79409','79408','79407','79406','79405','79404','79403','79009','78804','78805'])assert.ok(journey.stops.includes(id),`Missing intermediate station ${id}`);
  assert.ok(groups[3].items.length>journey.edges.length);
  assert.match(elements['railway-route'].textContent,/Mataró.*Barcelona/);
  assert.ok(groups[2].items.length>0,'Documented Sants–Catalunya segment');
  const reverse=api.route('08019','08121');
  assert.equal(JSON.stringify(reverse.stops),JSON.stringify([...journey.stops].reverse()));
  const transfer=api.route('08121','08187');
  assert.ok(transfer.edges.some(e=>e.line==='R1'));
  assert.ok(transfer.edges.some(e=>e.line==='R4'));
  assert.equal(api.route('unknown','08019'),null);
  elements['railway-line'].value='R7';elements['railway-line'].onchange();
  assert.match(elements['railway-route'].textContent,/Sin recorrido/);
  assert.equal(groups[3].items.length,0);
  elements['railway-line'].value='';elements['railway-line'].onchange();
  const nextData=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/processed/rmove/incidencia_2025_06_05.json')));
  api.setSelection({data:nextData,rows:[],selected:null,onChoose:()=>{}});
  assert.equal(groups[2].items.length,1,'Arc de Triomf must remain a point, not an invented segment');
  assert.equal(groups[3].items.length,0,'Clear previous relationship on case change');
  for(const date of ['2025_06_05','2025_02_07','2025_03_17','2023_05_02','2024_04_29']) {
    const caseData=JSON.parse(fs.readFileSync(path.join(__dirname,`../../data/processed/rmove/incidencia_${date}.json`)));
    api.setSelection({data:caseData,rows:[],selected:null,onChoose:()=>{}});
    const expectedIncidents={'2025_06_05':1,'2025_02_07':3,'2025_03_17':0,'2023_05_02':0,'2024_04_29':3};
    assert.equal(groups[2].items.length,expectedIncidents[date],`Incident localization: ${date}`);
    for(const row of caseData.relaciones)assert.ok(api.route(row.municipio_origen,row.municipio_destino),`Unmapped: ${row.relacion}`);
  }
  // A new date and municipalities absent from the original five cases.
  const future={fecha_incidencia:'2030-01-15',municipios:[{codigo:'08270',nombre:'Sitges'},{codigo:'08035',nombre:'Calella'}],
    incidencia_documentada:{lineas_afectadas:'R2 Sud; R1',tramo:'Sitges–Garraf'}};
  api.setSelection({data:future,rows:[],selected:null,onChoose:()=>{}});
  const futurePath=api.route('08270','08035');
  assert.ok(futurePath);
  assert.ok(futurePath.edges.some(edge=>edge.line==='R2S'));
  assert.ok(futurePath.edges.some(edge=>edge.line==='R1'));
  assert.ok(groups[2].items.length>0,'Future incident text resolves without date-specific configuration');
  const unresolved={...future,incidencia_documentada:{lineas_afectadas:'R1',tramo:'Zona no identificada'}};
  api.setSelection({data:unresolved,rows:[],selected:null,onChoose:()=>{}});
  assert.equal(groups[2].items.length,0);
  assert.match(elements['railway-incident'].textContent,/sin estación o tramo identificado/);
  const explicit={fecha_incidencia:'2030-01-16',municipios:[{codigo:'new-a',nombre:'Nombre nuevo',estaciones_renfe:['79500']},{codigo:'new-b',nombre:'Otro nombre',estaciones_renfe:['71801']}],
    incidencia_documentada:{lineas_afectadas:'R1',tramo:'Texto libre',estaciones_renfe:['79500','79409']}};
  api.setSelection({data:explicit,rows:[],selected:null,onChoose:()=>{}});
  assert.ok(api.route('new-a','new-b'));
  assert.ok(groups[2].items.length>0);
  api.showNetwork();
  assert.equal(groups[0].items.length,16);
  assert.equal(groups[1].items.length,124);
  assert.equal(groups[2].items.length,0,'Network-only mode clears incident highlights');
  assert.equal(groups[3].items.length,0,'Network-only mode clears travel variations');
  assert.equal(elements['railway-line'].value,'');
  api.setSelection({data,rows:[{...relation,i:42}],selected:42,onChoose:()=>{}});
  assert.ok(groups[3].items.length>0,'Return from network to incident restores route');
  await api.mount(map);
  assert.equal(fetches,1);
}
(async()=>{await exercise();await exercise(true);console.log('Railway: 425 OD routes, all five incident locations, future dates and new municipalities, transfers, intermediates, filters and loading errors OK');})().catch(error=>{console.error(error);process.exitCode=1;});
