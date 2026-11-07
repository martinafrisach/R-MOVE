'use strict';
const $=id=>document.getElementById(id);
const num=(v,d=2)=>Number(v).toLocaleString('es-ES',{useGrouping:'always',maximumFractionDigits:d,minimumFractionDigits:d});
const signed=v=>(v>0?'+':'')+num(v);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CASES={
 '2025-06-05':{file:'../../data/processed/rmove/incidencia_2025_06_05.json'},
 '2025-02-07':{file:'../../data/processed/rmove/incidencia_2025_02_07.json'}
};
let municipalities={},loadVersion=0;
let data, map, layer, tiles, selected=null, municipality='', direction='both', mode='od', currentLine, metric='variacion_observada_pct';
const METRICS={
 variacion_observada_pct:{label:'Variación de viajes frente a días comparables',unit:'%',negative:'Menos viajes que la mediana comparable',positive:'Más viajes que la mediana comparable'}
};
const metricValue=r=>Number.isFinite(r[metric])?r[metric]:null;
const comparableDays=()=>['domingos','lunes','martes','miércoles','jueves','viernes','sábados'][new Date(data.fecha_incidencia+'T12:00:00Z').getUTCDay()]+' comparables';
function metricBar(r,max){const v=metricValue(r);return v===null?`<p>${esc(r.relacion)} · Sin datos para este indicador</p>`:bars([[r.relacion,v,color(v),METRICS[metric].unit]],max);}
function visibleRelations(){
 return data.relaciones.map((r,i)=>({...r,i})).filter(r=>municipality &&
 (direction==='out'?r.municipio_origen===municipality:direction==='in'?r.municipio_destino===municipality:r.municipio_origen===municipality||r.municipio_destino===municipality))
 .sort((a,b)=>(metricValue(b)===null?-1:Math.abs(metricValue(b)))-(metricValue(a)===null?-1:Math.abs(metricValue(a))));
}
function chooseMunicipality(code){
 municipality=code;selected=null;mode='od';$('q').value='';$('municipality').value=code;
 updateExplorer();
}
function updateExplorer(){
 mode='od';$('q').value='';
 $('status').textContent=`${data.fecha_incidencia} · ${data.descripcion} · ${data.ambito}.`;
 const rows=visibleRelations();
 $('explore-title').textContent=municipality?`${municipalities[municipality][0]} · ${rows.length} relaciones`:'Empieza por un municipio';
 $('legend-negative').textContent='● '+METRICS[metric].negative;
 $('legend-positive').textContent='● '+METRICS[metric].positive;
 $('legend-help').textContent=`${METRICS[metric].label} (${METRICS[metric].unit}). Gris: cero o dato ausente (ver detalle). Flecha: destino · Conexión gruesa: selección.`;
 $('metric-description').textContent=`Ordenadas por magnitud: ${METRICS[metric].label.toLowerCase()} (${METRICS[metric].unit}).`;
 const max=Math.max(0,...rows.map(r=>Math.abs(metricValue(r)??0)));
 $('filtered').innerHTML=rows.length?rows.map(r=>`<button class="rank" data-i="${r.i}" aria-pressed="${selected===r.i}">${metricBar(r,max)}</button>`).join(''):'<p>Selecciona un municipio en el mapa o en el selector para ver sus conexiones.</p>';
 if(selected===null){$('ttl').textContent='Explora la movilidad';$('relation').innerHTML='<p>Elige un municipio y después una relación para consultar los viajes y su comparación con los días de referencia.</p>';$('selection-charts').hidden=true;$('relation-more').hidden=true;}
 document.querySelectorAll('#rows button, #ranking button').forEach(b=>b.setAttribute('aria-pressed',String(selected!==null&&+b.dataset.i===selected)));
 drawOD();
}
const color=v=>v===null||v===0?'#727878':v<0?`hsl(12 70% ${58-18*Math.min(Math.abs(v)/20,1)}%)`:`hsl(183 75% ${40-14*Math.min(Math.abs(v)/20,1)}%)`;
function initMap(){
 if(!window.L){$('mapstatus').textContent='Leaflet no está disponible. Los resultados siguen accesibles en la tabla y gráficos.';return false;}
 if(!map){map=L.map('map');layer=L.layerGroup().addTo(map);}
 return true;
}
$('basemap').onchange=()=>{
 if(!initMap())return;
 if(!$('basemap').checked){if(tiles)map.removeLayer(tiles);$('mapstatus').textContent='Fondo desactivado. Geometrías OD disponibles.';return;}
 if(!tiles){tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'});
 tiles.on('tileerror',()=>{map.removeLayer(tiles);$('basemap').checked=false;$('mapstatus').textContent='No se pudo cargar el fondo. Si hay un 403, revisar Referer, origen HTTP y política del proveedor; no se reintentará automáticamente. El mapa OD sigue disponible.';});}
 tiles.addTo(map);$('mapstatus').textContent='Fondo OpenStreetMap activado bajo su política de uso.';
};
function drawOD(){
 if(!initMap())return;
 layer.clearLayers();
 visibleRelations().sort((a,b)=>(a.i===selected)-(b.i===selected)).forEach(r=>{
 const i=r.i;
 const a=municipalities[r.municipio_origen].slice(1),b=municipalities[r.municipio_destino].slice(1);
 // Offset each direction to keep reciprocal relations independently selectable.
 const dx=b[1]-a[1],dy=b[0]-a[0],length=Math.hypot(dx,dy),offset=.008;
 const mid=[(a[0]+b[0])/2+dx/length*offset,(a[1]+b[1])/2-dy/length*offset];
 const points=Array.from({length:25},(_,j)=>{const t=j/24;return [(1-t)**2*a[0]+2*(1-t)*t*mid[0]+t*t*b[0],(1-t)**2*a[1]+2*(1-t)*t*mid[1]+t*t*b[1]];}),value=metricValue(r),c=color(value);
 L.polyline(points,{color:c,weight:selected===i?7:3,opacity:selected===null||selected===i?.95:.35}).bindTooltip(`${esc(r.relacion)} · ${METRICS[metric].label}: ${value===null?'Sin datos':signed(value)+' '+METRICS[metric].unit}`).on('click',()=>select(i)).addTo(layer);
 const pos=points[17],next=points[18];
 const angle=Math.atan2(next[0]-pos[0],next[1]-pos[1])*180/Math.PI;
 L.marker(pos,{icon:L.divIcon({className:'arrow',html:`<span style="color:${c};transform:rotate(${-angle}deg)">➤</span>`,iconSize:[20,20],iconAnchor:[10,10]})}).on('click',()=>select(i)).addTo(layer);
 });
 Object.entries(municipalities).forEach(([code,[name,lat,lon]])=>L.circleMarker([lat,lon],{radius:code===municipality?10:8,color:code===municipality?'#b85500':'#363b3e',fillColor:code===municipality?'#ffdebb':'white',fillOpacity:1}).bindTooltip(esc(name),{permanent:true,direction:'top'}).on('click',()=>chooseMunicipality(code)).addTo(layer));
 map.invalidateSize();if(!map._rmoveFit){map.fitBounds(Object.values(municipalities).map(m=>m.slice(1)),{padding:[45,45]});map._rmoveFit=true;}
}
function bars(items,max){return items.map(([label,value,c,unit])=>`<div class="barrow"><span>${esc(label)}</span><strong>${num(value)} ${unit||''}</strong><div class="track"><div style="width:${max?Math.abs(value)/max*100:0}%;background:${c}"></div></div></div>`).join('');}

function select(i){
 const r=data.relaciones[i];if(!r)return;
 if(!visibleRelations().some(x=>x.i===i)){municipality=r.municipio_origen;direction='both';$('municipality').value=municipality;$('direction').value=direction;}
 selected=i;updateExplorer();$('ttl').textContent=r.relacion;
 $('relation-more').hidden=false;renderRelationExtras(data,r);
 const valid=r.estado==='ok'&&Number.isFinite(r.variacion_observada_pct)&&r.mediana_viajes_controles>0;
 $('selection-charts').hidden=!valid;
 const date=new Date(data.fecha_incidencia+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
 const show=v=>Number.isFinite(v)?num(v,Number.isInteger(v)?0:2):'Sin datos';
 if(!valid){
  $('relation').innerHTML=`<p>Fecha: ${date}</p><p>Viajes observados: ${show(r.viajes_observados)}.</p><p>No hay una referencia comparable válida: ${esc(r.estado)}. No se calcula una variación.</p>`;
  return;
 }
 const comparison=r.variacion_observada_pct===0?'los mismos viajes que la mediana':`un ${num(Math.abs(r.variacion_observada_pct))} % ${r.variacion_observada_pct<0?'menos':'más'} de viajes que la mediana`;
 const dates=r.fechas_controles.map(d=>`<li>${esc(d)}</li>`).join('');
 $('relation').innerHTML=`<p>Fecha: ${date}</p><p class="primary-metric" style="color:${color(r.variacion_observada_pct)}">${signed(r.variacion_observada_pct)} %</p><p>de viajes respecto a los ${comparableDays()}</p><p><b>${show(r.viajes_observados)}</b> viajes observados frente a una mediana de <b>${show(r.mediana_viajes_controles)}</b>.</p><p class="explanation">Se registraron ${comparison} de los ${comparableDays()}. Es una asociación temporal; no demuestra que Rodalies causara la diferencia.</p><details class="statistical-detail"><summary>Días de referencia y distribución</summary><dl class="metrics"><dt>Días comparables utilizados</dt><dd>${r.n_controles}</dd><dt>P25–P75 de viajes comparables</dt><dd>${show(r.p25_viajes_controles)} – ${show(r.p75_viajes_controles)}</dd><dt>Modo</dt><dd>${r.modo_controles==='predictivo'?'Solo controles anteriores':'Retrospectivo: anteriores y posteriores'}</dd></dl><p>Mismo día semanal en una ventana de ${r.ventana_dias} días, sin la fecha analizada, festivos ni fechas del Excel. Se excluyen julio y agosto de objetivos y controles. P25–P75 es una banda descriptiva, no un umbral de significación.</p><ul>${dates}</ul></details>`;
 const items=[['Observados',r.viajes_observados,'#e8700a'],['Mediana de días comparables',r.mediana_viajes_controles,'#536979']];
 $('volumes').innerHTML=bars(items,Math.max(...items.map(x=>x[1])));
 const vals=[r.viajes_observados,r.mediana_viajes_controles,r.p25_viajes_controles,r.p75_viajes_controles];
 const range=Math.max(...vals)-Math.min(...vals),pad=Math.max(1,range*.15),lo=Math.max(0,Math.min(...vals)-pad),hi=Math.max(...vals)+pad;
 const position=v=>(v-lo)/(hi-lo)*100;
 $('reference').innerHTML=`<p>Mediana: <b>${show(r.mediana_viajes_controles)} viajes</b></p><div class="interval" role="img" aria-label="Rango descriptivo: de ${show(r.p25_viajes_controles)} a ${show(r.p75_viajes_controles)} viajes"><div style="left:${position(r.p25_viajes_controles)}%;width:${position(r.p75_viajes_controles)-position(r.p25_viajes_controles)}%"></div><i style="left:${position(r.mediana_viajes_controles)}%;background:#536979"></i><i style="left:${position(r.viajes_observados)}%;background:#e8700a"></i></div><p>P25: ${show(r.p25_viajes_controles)} · P75: ${show(r.p75_viajes_controles)} viajes</p><small>Banda: P25–P75 de viajes · marca gris: mediana · naranja: observado. ${r.n_controles} controles. Sin interpretación causal ni de significación.</small>`;
 drawOD();
}
function render(){
 $('analysis').hidden=false;$('list').hidden=true;mode='od';$('q').value='';
 if(!data||data.fecha_incidencia!==$('event').value){$('analysis').hidden=true;return;}
 $('municipality').innerHTML='<option value="">Vista general</option>'+Object.entries(municipalities).map(([code,m])=>`<option value="${code}" ${code===municipality?'selected':''}>${esc(m[0])}</option>`).join('');
 renderCaseContext(data);
 $('status').textContent=`${data.fecha_incidencia} · ${data.descripcion} · Datos agregados Telefónica / mediana de días comparables.`;
 const rr=data.relaciones,negative=rr.filter(r=>r.variacion_observada_pct<0).length;
 $('summary').innerHTML=`<div><b>${rr.length}</b><span>Relaciones OD analizadas</span></div><div><b>${Object.keys(municipalities).length}</b><span>Municipios</span></div><div><b>${negative} / ${rr.length-negative}</b><span>Diferencias negativas / no negativas</span></div><div><b>${rr.filter(r=>r.fuera_rango_intercuartil_viajes).length}</b><span>Fuera del intervalo P25–P75</span></div>`;
 const ordered=rr.map((r,i)=>({...r,i})).sort((a,b)=>(metricValue(a)??Infinity)-(metricValue(b)??Infinity));
 $('rows').innerHTML=ordered.map(r=>`<tr><td><button data-i="${r.i}">${esc(r.relacion)}</button></td><td>${Number.isFinite(r.viajes_observados)?num(r.viajes_observados,0):'Sin datos'}</td><td>${Number.isFinite(r.mediana_viajes_controles)?num(r.mediana_viajes_controles):'Sin datos'}</td><td>${Number.isFinite(r.variacion_observada_pct)?signed(r.variacion_observada_pct):'Sin datos'}</td><td>${Number.isFinite(r.p25_viajes_controles)?num(r.p25_viajes_controles):'Sin datos'}</td><td>${Number.isFinite(r.p75_viajes_controles)?num(r.p75_viajes_controles):'Sin datos'}</td><td>${r.n_controles}</td></tr>`).join('');
 const max=Math.max(0,...rr.map(r=>Math.abs(metricValue(r)??0)));
 $('ranking').innerHTML=`<p class="ranking-label">${METRICS[metric].label} (${METRICS[metric].unit})</p>`+[['Negativas',ordered.filter(r=>metricValue(r)!==null&&metricValue(r)<0).slice(0,5)],['Positivas',ordered.filter(r=>metricValue(r)!==null&&metricValue(r)>0).reverse().slice(0,5)]].map(([title,rows])=>`<div><h3>${title}</h3>${rows.map(r=>`<button class="rank" data-i="${r.i}">${metricBar(r,max)}</button>`).join('')||'<p>Sin relaciones para este signo.</p>'}</div>`).join('');
 updateExplorer();if(selected!==null)select(selected);
}
function showLine(id){
 if(!data||data.fecha_incidencia!==$('event').value){render();return;}
 const l=LN.find(l=>l.id===id);if(!l)return;mode='line';currentLine=id;
 $('list').hidden=true;$('analysis').hidden=false;$('q').value=l.n;
 $('status').textContent=`${l.n}: trazado aproximado heredado del prototipo, no validado con GTFS. No hay resultados por línea ni incidencias geolocalizadas exportados. El análisis OD inferior corresponde al ámbito ${data.ambito}, no a esta línea.`;
 if(!initMap())return;layer.clearLayers();const pts=l.st.map(k=>S[k].slice(1));
 L.polyline(pts,{color:l.c,weight:5,dashArray:'8 6'}).addTo(layer);
 l.st.forEach(k=>L.circleMarker(S[k].slice(1),{radius:5}).bindTooltip(S[k][0]).addTo(layer));map.invalidateSize();map.fitBounds(pts,{padding:[35,35]});map._rmoveFit=false;
}
$('lines').innerHTML=LN.map(l=>`<option value="${esc(l.n)}">`).join('');
$('back').onclick=()=>{$('analysis').hidden=true;$('list').hidden=false;$('q').value='';$('status').textContent='Red de contexto aproximada. Sin datos analizados por línea; esto no significa ausencia de incidencias.';$('list').innerHTML=LN.map(l=>`<button class="tile" data-line="${l.id}"><span class="badge" style="background:${l.c};color:#111">${esc(l.n)}</span><span>${esc(S[l.st[0]][0])} – ${esc(S[l.st.at(-1)][0])}<small>Sin resultados por línea</small></span></button>`).join('');};
$('q').onchange=()=>{const v=$('q').value.toLowerCase().trim(),l=LN.find(l=>l.n.toLowerCase()===v||l.id.toLowerCase()===v);if(l)showLine(l.id);};
$('event').onchange=load;$('results').onclick=render;
$('list').onclick=e=>{const b=e.target.closest('[data-line]');if(b)showLine(b.dataset.line);};
for(const id of ['rows','ranking','filtered'])$(id).onclick=e=>{const b=e.target.closest('[data-i]');if(b){if(mode==='line')render();select(+b.dataset.i);}};
$('municipality').onchange=()=>chooseMunicipality($('municipality').value);
$('direction').onchange=()=>{direction=$('direction').value;selected=null;mode='od';updateExplorer();};
$('metric').onchange=()=>{metric=$('metric').value;render();};
$('overview').onclick=()=>{municipality='';selected=null;direction='both';$('direction').value=direction;$('municipality').value='';if(map)map._rmoveFit=false;render();};

async function load(){
 const date=$('event').value,request=++loadVersion;
 data=null;selected=null;municipality='';direction='both';
 $('direction').value=direction;$('analysis').hidden=true;$('list').hidden=true;
 $('status').textContent='Cargando resultados reales del caso seleccionado…';
 try{
  if(!CASES[date])throw Error('No hay una exportación analizada para esta fecha');
  const response=await fetch(CASES[date].file);if(!response.ok)throw Error(`HTTP ${response.status}`);
  const json=await response.json();if(request!==loadVersion)return;
  if(json.fecha_incidencia!==date||!Array.isArray(json.relaciones)||!json.relaciones.length)throw Error('Estructura de exportación no válida');
  if(json.version_esquema!==3)throw Error('Regenera la exportación de mediana con el Notebook 04');
  if(!Array.isArray(json.municipios)||!json.municipios.length)throw Error('Falta el catálogo municipal');
  const catalog={};
  for(const m of json.municipios){
   if(typeof m.codigo!=='string'||typeof m.nombre!=='string'||!Number.isFinite(m.lat)||!Number.isFinite(m.lon))throw Error('Municipio no válido');
   catalog[m.codigo]=[m.nombre,m.lat,m.lon];
  }
  for(const r of json.relaciones){
   for(const k of ['viajes_observados','mediana_viajes_controles','variacion_observada_pct','p25_viajes_controles','p75_viajes_controles'])
    if(r[k]!==null&&!Number.isFinite(r[k]))throw Error(`Campo ausente o inválido: ${k}`);
   if(!catalog[r.municipio_origen]||!catalog[r.municipio_destino]||typeof r.relacion!=='string'||typeof r.estado!=='string')throw Error('Relación o estado no reconocido');
   if(!Number.isInteger(r.n_controles)||r.n_controles<0||!Array.isArray(r.fechas_controles)||r.fechas_controles.length!==r.n_controles)throw Error('Controles no válidos');
  }
  municipalities=catalog;data=json;if(map)map._rmoveFit=false;render();
 }catch(error){
  if(request!==loadVersion)return;
  $('analysis').hidden=true;
  $('status').textContent=`No se pudieron cargar los resultados (${error.message}). Sirve la raíz del repositorio por HTTP y abre /src/dashboard/. No abras el archivo con file://.`;
 }
}
load();
