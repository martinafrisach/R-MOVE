'use strict';
const $=id=>document.getElementById(id);
const num=(v,d=2)=>Number(v).toLocaleString('es-ES',{useGrouping:'always',maximumFractionDigits:d,minimumFractionDigits:d});
const signed=v=>(v>0?'+':'')+num(v);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const municipalities={'08019':['Barcelona',41.387,2.17],'08056':['Castelldefels',41.281,1.976],'08089':['Gavà',41.306,2.001],'08301':['Viladecans',41.315,2.019],'08169':['El Prat de Llobregat',41.327,2.094]};
let data, map, layer, tiles, selected=null, municipality='', direction='both', mode='od', currentLine;
function visibleRelations(){
 return data.relaciones.map((r,i)=>({...r,i})).filter(r=>municipality &&
 (direction==='out'?r.municipio_origen===municipality:direction==='in'?r.municipio_destino===municipality:r.municipio_origen===municipality||r.municipio_destino===municipality))
 .sort((a,b)=>Math.abs(b.diferencia_pp)-Math.abs(a.diferencia_pp));
}
function chooseMunicipality(code){
 municipality=code;selected=null;mode='od';$('q').value='';$('municipality').value=code;
 updateExplorer();
}
function updateExplorer(){
 mode='od';$('q').value='';
 $('status').textContent=`${data.fecha_incidencia} · ${data.descripcion} · Resultados del corredor sur.`;
 const rows=visibleRelations();
 $('explore-title').textContent=municipality?`${municipalities[municipality][0]} · ${rows.length} relaciones`:'Empieza por un municipio';
 $('filtered').innerHTML=rows.length?rows.map(r=>`<button class="rank" data-i="${r.i}" aria-pressed="${selected===r.i}">${bars([[r.relacion,r.diferencia_pp,color(r.diferencia_pp),'pp']],Math.max(...rows.map(x=>Math.abs(x.diferencia_pp))))}</button>`).join(''):'<p>Selecciona un municipio en el mapa o en el selector para ver sus conexiones.</p>';
 if(selected===null){$('ttl').textContent='Explora la movilidad';$('relation').innerHTML='<p>Elige un municipio y después una relación para consultar los viajes y su comparación con los días de referencia.</p>';$('selection-charts').hidden=true;}
 document.querySelectorAll('#rows button, #ranking button').forEach(b=>b.setAttribute('aria-pressed',String(selected!==null&&+b.dataset.i===selected)));
 drawOD();
}
const color=v=>v===0?'#727878':v<0?`hsl(12 70% ${58-18*Math.min(Math.abs(v)/20,1)}%)`:`hsl(183 75% ${40-14*Math.min(Math.abs(v)/20,1)}%)`;
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
 const points=Array.from({length:25},(_,j)=>{const t=j/24;return [(1-t)**2*a[0]+2*(1-t)*t*mid[0]+t*t*b[0],(1-t)**2*a[1]+2*(1-t)*t*mid[1]+t*t*b[1]];}),c=color(r.diferencia_pp);
 L.polyline(points,{color:c,weight:selected===i?7:3,opacity:selected===null||selected===i?.95:.35}).bindTooltip(`${esc(r.relacion)} · ${signed(r.diferencia_pp)} pp`).on('click',()=>select(i)).addTo(layer);
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
 if(mode==='line'){mode='od';$('q').value='';}
 if(!visibleRelations().some(x=>x.i===i)){municipality=r.municipio_origen;direction='both';$('municipality').value=municipality;$('direction').value=direction;}
 selected=i;updateExplorer();$('selection-charts').hidden=false;
 $('ttl').textContent=r.relacion;
 const explanation=r.desviacion_pct>0&&r.diferencia_pp<0?'Aunque se registraron más viajes de los previstos por la regresión, el aumento fue inferior a la mediana de las desviaciones de los días comparables.':`Los viajes observados estuvieron ${r.desviacion_pct>=0?'por encima':'por debajo'} de lo previsto por la regresión. La desviación fue ${r.diferencia_pp>=0?'mayor':'menor'} que la mediana de los días comparables.`;
 $('relation').innerHTML=`<p>Fecha: ${new Date(data.fecha_incidencia+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}</p><dl class="metrics"><dt>Viajes observados</dt><dd>${num(r.viajes_observados,0)}</dd><dt>Viajes esperados por la regresión</dt><dd>${num(r.viajes_esperados)}</dd><dt>Desviación respecto al modelo</dt><dd>${signed(r.desviacion_pct)} %</dd><dt>Diferencia respecto a la mediana de los días comparables</dt><dd style="color:${color(r.diferencia_pp)}">${signed(r.diferencia_pp)} puntos porcentuales</dd></dl><p class="explanation">${explanation}</p><small>Un valor negativo en esta última diferencia no implica necesariamente menos viajes observados.</small>`;
 $('volumes').innerHTML=bars([['Observados',r.viajes_observados,'#e8700a'],['Esperados (regresión)',r.viajes_esperados,'#536979']],Math.max(r.viajes_observados,r.viajes_esperados));
 const vals=[r.desviacion_pct,r.mediana_controles_pct,r.p25_controles_pct,r.p75_controles_pct],lo=Math.min(0,...vals)-3,hi=Math.max(0,...vals)+3,position=v=>(v-lo)/(hi-lo)*100;
 $('reference').innerHTML=`<p>Desviación del día: <b>${signed(r.desviacion_pct)} %</b><br>Mediana controles: <b>${signed(r.mediana_controles_pct)} %</b></p><div class="interval" role="img" aria-label="Intervalo intercuartil de controles de ${num(r.p25_controles_pct)} a ${num(r.p75_controles_pct)} por ciento; desviación ${num(r.desviacion_pct)} por ciento"><div style="left:${position(r.p25_controles_pct)}%;width:${position(r.p75_controles_pct)-position(r.p25_controles_pct)}%"></div><i style="left:${position(r.mediana_controles_pct)}%;background:#536979"></i><i style="left:${position(r.desviacion_pct)}%;background:#e8700a"></i></div><p>P25: ${signed(r.p25_controles_pct)} % · P75: ${signed(r.p75_controles_pct)} %</p><small>Banda: P25–P75 · marca gris: mediana · naranja: día analizado. ${r.n_controles} controles.</small>`;
 document.querySelectorAll('#rows button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.i===i)));
 drawOD();
}
function render(){
 $('analysis').hidden=false;$('list').hidden=true;mode='od';$('q').value='';
 if($('event').value!=='2025-06-05'){$('analysis').hidden=true;$('status').textContent='7 marzo 2025: pendiente de explicación por una anomalía metropolitana generalizada. Sin resultados analizados disponibles aquí; no se atribuye la caída a Rodalies.';return;}
 if(!data)return;
 $('status').textContent=`${data.fecha_incidencia} · ${data.descripcion} · Datos agregados Telefónica / regresión y controles.`;
 const rr=data.relaciones,negative=rr.filter(r=>r.diferencia_pp<0).length;
 $('summary').innerHTML=`<div><b>${rr.length}</b><span>Relaciones OD analizadas</span></div><div><b>${Object.keys(municipalities).length}</b><span>Municipios</span></div><div><b>${negative} / ${rr.length-negative}</b><span>Diferencias negativas / no negativas</span></div><div><b>${rr.filter(r=>r.fuera_rango_intercuartil).length}</b><span>Fuera del intervalo P25–P75</span></div>`;
 const ordered=rr.map((r,i)=>({...r,i})).sort((a,b)=>a.diferencia_pp-b.diferencia_pp);
 $('rows').innerHTML=ordered.map(r=>`<tr><td><button data-i="${r.i}">${esc(r.relacion)}</button></td><td>${num(r.viajes_observados,0)}</td><td>${num(r.viajes_esperados)}</td><td>${signed(r.desviacion_pct)}</td><td>${signed(r.mediana_controles_pct)}</td><td style="color:${color(r.diferencia_pp)}"><b>${signed(r.diferencia_pp)}</b></td><td>${r.fuera_rango_intercuartil?'Sí':'No'}</td></tr>`).join('');
 const max=Math.max(...rr.map(r=>Math.abs(r.diferencia_pp)));
 $('ranking').innerHTML=[['Negativas',ordered.filter(r=>r.diferencia_pp<0).slice(0,5)],['Positivas',ordered.filter(r=>r.diferencia_pp>0).reverse().slice(0,5)]].map(([title,rows])=>`<div><h3>${title}</h3>${rows.map(r=>`<button class="rank" data-i="${r.i}">${bars([[r.relacion,r.diferencia_pp,color(r.diferencia_pp),'pp']],max)}</button>`).join('')}</div>`).join('');
 updateExplorer();if(selected!==null)select(selected);
}
function showLine(id){
 if($('event').value!=='2025-06-05'||!data){render();return;}
 const l=LN.find(l=>l.id===id);if(!l)return;mode='line';currentLine=id;
 $('list').hidden=true;$('analysis').hidden=false;$('q').value=l.n;
 $('status').textContent=`${l.n}: trazado aproximado heredado del prototipo, no validado con GTFS. No hay resultados por línea ni incidencias geolocalizadas exportados. El análisis OD inferior corresponde al corredor sur completo, no a esta línea.`;
 if(!initMap())return;layer.clearLayers();const pts=l.st.map(k=>S[k].slice(1));
 L.polyline(pts,{color:l.c,weight:5,dashArray:'8 6'}).addTo(layer);
 l.st.forEach(k=>L.circleMarker(S[k].slice(1),{radius:5}).bindTooltip(S[k][0]).addTo(layer));map.invalidateSize();map.fitBounds(pts,{padding:[35,35]});map._rmoveFit=false;
}
$('lines').innerHTML=LN.map(l=>`<option value="${esc(l.n)}">`).join('');
$('back').onclick=()=>{$('analysis').hidden=true;$('list').hidden=false;$('q').value='';$('status').textContent='Red de contexto aproximada. Sin datos analizados por línea; esto no significa ausencia de incidencias.';$('list').innerHTML=LN.map(l=>`<button class="tile" data-line="${l.id}"><span class="badge" style="background:${l.c};color:#111">${esc(l.n)}</span><span>${esc(S[l.st[0]][0])} – ${esc(S[l.st.at(-1)][0])}<small>Sin resultados por línea</small></span></button>`).join('');};
$('q').onchange=()=>{const v=$('q').value.toLowerCase().trim(),l=LN.find(l=>l.n.toLowerCase()===v||l.id.toLowerCase()===v);if(l)showLine(l.id);};
$('event').onchange=render;$('results').onclick=render;
$('list').onclick=e=>{const b=e.target.closest('[data-line]');if(b)showLine(b.dataset.line);};
for(const id of ['rows','ranking','filtered'])$(id).onclick=e=>{const b=e.target.closest('[data-i]');if(b){if(mode==='line')render();select(+b.dataset.i);}};
$('municipality').onchange=()=>chooseMunicipality($('municipality').value);
$('direction').onchange=()=>{direction=$('direction').value;selected=null;mode='od';updateExplorer();};
$('overview').onclick=()=>{municipality='';selected=null;direction='both';$('direction').value=direction;$('municipality').value='';if(map)map._rmoveFit=false;render();};
async function load(){
 try{
 const response=await fetch('../../data/processed/rmove/incidencia_2025_06_05.json');if(!response.ok)throw Error(`HTTP ${response.status}`);
 const json=await response.json();if(json.fecha_incidencia!=='2025-06-05'||!Array.isArray(json.relaciones)||!json.relaciones.length)throw Error('Estructura de exportación no válida');
 for(const r of json.relaciones){for(const k of ['viajes_observados','viajes_esperados','desviacion_pct','mediana_controles_pct','diferencia_pp','p25_controles_pct','p75_controles_pct','n_controles'])if(typeof r[k]!=='number'||!Number.isFinite(r[k]))throw Error(`Campo ausente o inválido: ${k}`);if(!municipalities[r.municipio_origen]||!municipalities[r.municipio_destino]||typeof r.relacion!=='string'||typeof r.fuera_rango_intercuartil!=='boolean')throw Error('Relación o municipio no reconocido');}
 data=json;render();
 }catch(error){$('analysis').hidden=true;$('status').textContent=`No se pudieron cargar los resultados (${error.message}). Sirve la raíz del repositorio por HTTP y abre /src/dashboard/. No abras el archivo con file://.`;}
}
load();
