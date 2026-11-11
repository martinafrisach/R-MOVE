'use strict';
/* La aplicación consume los resultados del Notebook 04, sin recalcular las referencias. */
const $=id=>document.getElementById(id);
const fmt=v=>Number.isFinite(v)?v.toLocaleString('es-ES',{minimumFractionDigits:0,maximumFractionDigits:Number.isInteger(v)?0:2}):'Sin datos';
const signed=(v,d=2)=>Number.isFinite(v)?`${v>0?'+':''}${v.toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d})}`:'Sin datos';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CASES={'2025-06-05':'../../data/processed/rmove/incidencia_2025_06_05.json','2025-02-07':'../../data/processed/rmove/incidencia_2025_02_07.json','2025-03-17':'../../data/processed/rmove/incidencia_2025_03_17.json','2023-05-02':'../../data/processed/rmove/incidencia_2023_05_02.json','2024-04-29':'../../data/processed/rmove/incidencia_2024_04_29.json'};
let currentCase=Object.keys(CASES)[0];
let data=null,places={},map=null,bg=null,selected=null,municipality='',direction='both',request=0;
function filtered(){return data.relaciones.map((r,i)=>({...r,i})).filter(r=>!municipality||(direction==='out'?r.municipio_origen===municipality:direction==='in'?r.municipio_destino===municipality:r.municipio_origen===municipality||r.municipio_destino===municipality));}
function ranked(rows){return [...rows].sort((a,b)=>b.diferencia_viajes-a.diferencia_viajes);}
function chooseMunicipality(code){municipality=code;selected=null;$('municipality').value=code;update();}
function chooseRelation(i){const r=data?.relaciones[i];if(!r)return;selected=i;update();}
function showRanking(){
 const rows=ranked(filtered());
 $('top-relations').innerHTML=rows.map(r=>`<button class="top-item ${selected===r.i?'active':''}" data-i="${r.i}"><span>${esc(r.relacion)}</span><b class="${r.variacion_observada_pct<0?'down':r.variacion_observada_pct>0?'up':'neutral'}">${signed(r.diferencia_viajes,Number.isInteger(r.diferencia_viajes)?0:1)} viajes</b></button>`).join('');
}
function initMap(){if(!window.L){$('status').textContent='Mapa no disponible: Leaflet no se ha cargado. Comprueba la conexión a Internet.';return false;}if(!map){map=L.map('map');bg=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'});bg.on('tileerror',()=>{if(map.hasLayer(bg))map.removeLayer(bg);});bg.addTo(map);if(window.RMoveRailway)window.RMoveRailway.mount(map);}return true;}
function drawMap(){if($('case-view')?.hidden)return;if(!initMap())return;const rows=filtered();
 map.invalidateSize();if(!map._fitForCase){map.fitBounds(Object.values(places).map(p=>[p.lat,p.lon]),{padding:[55,55]});map._fitForCase=true;}
 if(window.RMoveRailway)window.RMoveRailway.setSelection({data,rows,selected,onChoose:chooseRelation});}

function update(){if(!data)return;$('relation-detail').innerHTML=relationHTML(selected===null?null:data.relaciones[selected]);showRanking();drawMap();}
function setNetworkMode(enabled){
 $('app').className=enabled?'network-only':'';
 for(const id of ['case-information','case-kpis','case-filters','case-results','case-limitations','railway-context','variation-legend'])$(id).hidden=enabled;
 $('map-title').textContent=enabled?'Red de Rodalies':'Mapa de movilidad';
 $('map-description').textContent=enabled?'Explora las líneas y sus estaciones. Selecciona una línea o acerca el mapa.':'Selecciona un municipio, un trayecto o un tramo del mapa.';
}
function renderNetwork(){
 data=null;places={};selected=null;municipality='';direction='both';
 setNetworkMode(true);$('app').hidden=false;$('status').textContent='';
 $('incident-title').textContent='Solo líneas de Rodalies';$('incident-description').textContent='Todas las líneas con sus colores oficiales y estaciones.';
 $('relation-detail').innerHTML='';$('top-relations').innerHTML='';$('information').innerHTML='';
 if(initMap()){map.invalidateSize();map._fitForCase=false;window.RMoveRailway?.showNetwork();}
}
function render(){setNetworkMode(false);const f=data.incidencia_documentada||{};places=Object.fromEntries(data.municipios.map(p=>[p.codigo,p]));$('app').hidden=false;$('status').textContent='';$('incident-title').textContent=`${new Date(data.fecha_incidencia+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})} · ${data.ambito}`;$('incident-description').textContent=[f.causa||data.descripcion,f.tramo].filter(Boolean).join(' · ');
 const prov=data.diagnostico_provincial?.indicadores?.find(x=>x.indicador==='viajes_observados');$('information').innerHTML=`<p><strong>Incidencia:</strong> ${esc(f.afectacion||'Sin detalles')}</p><p><strong>Líneas documentadas:</strong> ${esc(f.lineas_afectadas||'No especificadas')}. ${esc(f.horario||'')}</p><p>${esc(f.cautelas||'')}</p>${typeof f.url==='string'&&/^https?:\/\//i.test(f.url)?`<a target="_blank" rel="noopener noreferrer" href="${esc(f.url)}">Fuente documental</a>`:''}<hr><p><strong>Método:</strong> mediana de los mismos días de la semana en ±42 días, sin fechas del Excel, festivos de Cataluña ni julio/agosto; al menos tres controles.</p><p><strong>Calidad:</strong> ${data.relaciones.length} de ${data.disponibilidad_od?.length||data.relaciones.length} relaciones candidatas; contexto provincial ${prov?signed(prov.variacion_pct)+' %':'no disponible'} frente a controles.</p><p>Movilidad agregada de todos los modos: no permite demostrar causalidad ni identificar viajes ferroviarios. El trazado muestra un recorrido ferroviario de referencia entre municipios, no viajes ferroviarios observados.</p>`;
 const rr=data.relaciones;$('kpi-relations').textContent=rr.length;$('kpi-decrease').textContent=rr.filter(r=>r.variacion_observada_pct<0).length;$('kpi-increase').textContent=rr.filter(r=>r.variacion_observada_pct>0).length;
 $('municipality').innerHTML='<option value="">Todos</option>'+data.municipios.map(p=>`<option value="${esc(p.codigo)}">${esc(p.nombre)}</option>`).join('');municipality='';direction='both';selected=null;$('direction').value='both';$('municipality').value='';if(map)map._fitForCase=false;
 // Seleccionar la primera relación del listado ordenado.
 const first=ranked(rr.map((r,i)=>({...r,i})))[0];if(first)selected=first.i;update();}
async function load(date=currentCase){currentCase=date;const id=++request;if(date==='network'){renderNetwork();return;}$('app').hidden=true;$('status').textContent='Cargando resultados…';try{const res=await fetch(CASES[date]);if(!res.ok)throw Error(`HTTP ${res.status}`);const json=await res.json();if(id!==request)return;if(json.version_esquema!==3||json.fecha_incidencia!==date||!Array.isArray(json.relaciones)||!Array.isArray(json.municipios)||!json.relaciones.length)throw Error('JSON de resultados no válido');for(const r of json.relaciones)if(r.estado!=='ok'||!Number.isFinite(r.variacion_observada_pct)||!Number.isFinite(r.diferencia_viajes))throw Error('Relación no válida: '+r.relacion);data=json;render();}catch(e){if(id!==request)return;$('status').textContent=`No se pudieron cargar los datos (${e.message}). Abre /src/dashboard/ sirviendo la raíz del repositorio con python -m http.server 8000.`;}}
$('municipality').onchange=e=>chooseMunicipality(e.target.value);$('direction').onchange=e=>{direction=e.target.value;selected=null;update();};$('top-relations').onclick=e=>{const button=e.target.closest('[data-i]');if(button)chooseRelation(Number(button.dataset.i));};
