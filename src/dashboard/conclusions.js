'use strict';
// Página «Conclusiones»: presenta resultados ya calculados en los notebooks de M2 y M3; no estima nada en el navegador.
const CONCLUSIONS_DATA='../../data/processed/rmove/conclusiones/dashboard_conclusiones.json';
(function () {
  const byId=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('es-ES',{maximumFractionDigits:d,minimumFractionDigits:d}):'Sin datos';
  const signed=(v,d=1)=>Number.isFinite(v)?`${v>0?'+':v<0?'−':''}${number(Math.abs(v),d)}`:'Sin datos';
  const pText=p=>!Number.isFinite(p)?'p no disponible':p<0.001?'p < 0,001':`p = ${number(p,p<0.01?3:2)}`;
  const dateLabel=value=>new Date(value+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const GROUPS={dependientes:'Dependientes de Rodalies',cercanos:'Cercanos sin metro/FGC',metro_fgc:'Con metro/FGC',sin_rodalies:'Sin Rodalies (control)'};
  let data=null,map=null,markers=null,caseIndex=0,selected=null,fitted=false,sequence=0;

  // Escala divergente: azul = menos viajes, naranja = más viajes; saturada en ±30 %.
  function color(value){
    const t=Math.max(-1,Math.min(1,value/30)),neutral=[107,127,144];
    const end=t<0?[128,186,255]:[255,177,110],k=Math.abs(t);
    return `rgb(${neutral.map((n,i)=>Math.round(n+(end[i]-n)*k)).join(',')})`;
  }
  const currentCase=()=>data.mapa[caseIndex];
  function visibleMunicipalities(){
    const group=byId('concl-group').value;
    return currentCase().municipios.filter(m=>!group||m.grupo===group);
  }

  function valid(json){
    if(json?.version_esquema!==1||!Array.isArray(json.kpis)||!Array.isArray(json.conclusiones)||json.conclusiones.length!==4)return false;
    if(!Array.isArray(json.mapa)||!json.mapa.length||!Array.isArray(json.evento)||!json.evento.length||!Array.isArray(json.barrios))return false;
    for(const c of json.mapa){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)||!Array.isArray(c.municipios)||!c.municipios.length||!Array.isArray(c.grupos))return false;
      for(const m of c.municipios)if(![m.lat,m.lon,m.efecto_pct,m.viajes_referencia].every(Number.isFinite)||!Object.hasOwn(GROUPS,m.grupo))return false;
    }
    return json.evento.every(e=>[e.dia,e.efecto_pct,e.ic_inf,e.ic_sup].every(Number.isFinite))
      &&json.barrios.every(b=>[b.con_estacion,b.sin_estacion].every(Number.isFinite));
  }

  function eventChart(rows){
    const values=rows.flatMap(r=>[r.ic_inf,r.ic_sup,0]);
    const lower=Math.floor(Math.min(...values)/2)*2-1,upper=Math.ceil(Math.max(...values)/2)*2+1;
    const x=d=>70+(d-rows[0].dia)/(rows.at(-1).dia-rows[0].dia||1)*540,y=v=>20+(upper-v)/(upper-lower)*190;
    let svg='<svg viewBox="0 0 650 250" role="img" aria-label="Efecto por día relativo al corte con intervalos del 95 %"><title>Efecto en los municipios dependientes antes y después del corte</title>';
    for(let t=0;t<=4;t++){const v=lower+(upper-lower)*t/4;svg+=`<line x1="60" y1="${y(v)}" x2="620" y2="${y(v)}" stroke="#edf0f2"/><text x="52" y="${y(v)+4}" text-anchor="end" class="axis-label">${signed(v,0)} %</text>`;}
    svg+=`<line x1="60" y1="${y(0)}" x2="620" y2="${y(0)}" stroke="#8b98a3" stroke-dasharray="4 4"/>`;
    for(const r of rows){
      const day=r.dia===0,fill=day?'#d5630b':'#314a62';
      svg+=`<line x1="${x(r.dia)}" y1="${y(r.ic_inf)}" x2="${x(r.dia)}" y2="${y(r.ic_sup)}" stroke="${fill}" stroke-width="4" stroke-linecap="round"/>`;
      svg+=`<circle cx="${x(r.dia)}" cy="${y(r.efecto_pct)}" r="${day?7:5.5}" fill="${fill}" stroke="white" stroke-width="2"><title>Día ${signed(r.dia,0)}: ${signed(r.efecto_pct)} % (IC95 ${signed(r.ic_inf)}; ${signed(r.ic_sup)})</title></circle>`;
      svg+=`<text x="${x(r.dia)}" y="236" text-anchor="middle" class="${day?'chart-value':'axis-label'}">${r.dia===0?'Día del corte':signed(r.dia,0)}</text>`;
      if(day)svg+=`<text x="${x(r.dia)+12}" y="${y(r.efecto_pct)+4}" class="chart-value">${signed(r.efecto_pct)} %</text>`;
    }
    return svg+'</svg>';
  }

  function neighbourhoodChart(rows){
    if(!rows.length)return '<p class="empty-state">No hay resultados para este sentido.</p>';
    const values=rows.flatMap(r=>[r.con_estacion,r.sin_estacion,0]);
    const lower=Math.min(...values)-4,upper=Math.max(...values)+4,x=v=>220+(v-lower)/(upper-lower)*380;
    let svg=`<svg viewBox="0 0 650 ${44+rows.length*72}" role="img" aria-label="Variación de viajes hacia barrios con y sin estación"><title>Barrios con estación frente a barrios sin estación</title>`;
    svg+=`<line x1="${x(0)}" y1="10" x2="${x(0)}" y2="${18+rows.length*72}" stroke="#8b98a3" stroke-dasharray="4 4"/>`;
    rows.forEach((r,i)=>{
      const top=20+i*72;
      svg+=`<text x="10" y="${top+14}" class="chart-label">${escape(r.caso)}</text><text x="10" y="${top+32}" class="axis-label">Diferencia: ${escape(pText(r.p_diferencia))}</text>`;
      [['con_estacion','Con estación','#ffac55',0],['sin_estacion','Sin estación','#8eacc8',24]].forEach(([key,label,fill,offset])=>{
        const v=r[key],a=Math.min(x(0),x(v)),w=Math.max(2,Math.abs(x(v)-x(0)));
        svg+=`<rect x="${a}" y="${top+offset}" width="${w}" height="18" rx="3" fill="${fill}"><title>${label}: ${signed(v)} %</title></rect>`;
        svg+=`<text x="${v<0?a-6:a+w+6}" y="${top+offset+13}" text-anchor="${v<0?'end':'start'}" class="chart-value">${signed(v)} %</text>`;
      });
    });
    const legendY=26+rows.length*72;
    svg+=`<rect x="220" y="${legendY}" width="12" height="12" rx="2" fill="#ffac55"/><text x="238" y="${legendY+10}" class="axis-label">Barrios con estación de Rodalies</text><rect x="420" y="${legendY}" width="12" height="12" rx="2" fill="#8eacc8"/><text x="438" y="${legendY+10}" class="axis-label">Barrios sin estación</text>`;
    return svg+'</svg>';
  }

  function renderDetail(){
    const c=currentCase(),m=c.municipios.find(x=>x.codigo===selected);
    const groups=c.grupos.map(g=>`<div><small>${escape(GROUPS[g.grupo]||g.grupo)}</small><strong class="${g.efecto_pct<0?'down':g.efecto_pct>0?'up':''}">${signed(g.efecto_pct)} %</strong><small>${escape(pText(g.p_valor))}</small></div>`).join('');
    const head=m?`<div class="detail-title"><small>${escape(GROUPS[m.grupo])}</small><h2>${escape(m.nombre)} → Barcelona</h2></div>
      <div class="main-value ${m.efecto_pct<0?'down':m.efecto_pct>0?'up':''}">${signed(m.efecto_pct)} %</div>
      <p class="delta-caption">Viajes frente a lo esperado ese día, descontando el cambio de los municipios sin Rodalies · ${escape(pText(m.p_valor))}</p>
      <p class="absolute">${number(m.viajes_referencia,0)} viajes en un día habitual</p>`
      :'<div class="detail-title"><small>MUNICIPIO</small><h2>Selecciona un municipio en el mapa o en la lista</h2></div>';
    byId('concl-detail').innerHTML=head+`<div class="numbers concl-groups"><p class="delta-caption">Efecto por grupo frente al control · ${escape(dateLabel(c.fecha))}</p>${groups}</div>`;
  }

  function renderRanking(){
    const rows=[...visibleMunicipalities()].sort((a,b)=>a.efecto_pct-b.efecto_pct).slice(0,15);
    byId('concl-ranking').innerHTML=rows.length?rows.map(m=>`<button type="button" class="top-item ${m.codigo===selected?'active':''}" data-code="${escape(m.codigo)}"><span>${escape(m.nombre)}</span><b class="${m.efecto_pct<0?'down':m.efecto_pct>0?'up':'neutral'}">${signed(m.efecto_pct)} %</b></button>`).join(''):'<p class="empty-state">No hay municipios en este grupo.</p>';
  }

  function drawMap(){
    if(!map||!data)return;
    markers.clearLayers();
    const rows=visibleMunicipalities(),maxTrips=Math.max(...currentCase().municipios.map(m=>m.viajes_referencia),1);
    for(const m of [...rows].sort((a,b)=>b.viajes_referencia-a.viajes_referencia)){
      const significant=Number.isFinite(m.p_valor)&&m.p_valor<0.05,active=m.codigo===selected;
      L.circleMarker([m.lat,m.lon],{radius:3+10*Math.sqrt(m.viajes_referencia/maxTrips),fillColor:color(m.efecto_pct),fillOpacity:.85,color:active?'#ffc477':significant?'#ffffff':'#14212c',weight:active?3:significant?1.6:.8,pane:'concl-points'})
        .bindTooltip(`<strong>${escape(m.nombre)}</strong><br>${signed(m.efecto_pct)} % · ${escape(pText(m.p_valor))}`,{direction:'top'})
        .on('click',()=>choose(m.codigo)).addTo(markers);
    }
    if(!fitted&&rows.length){map.fitBounds(rows.map(m=>[m.lat,m.lon]),{padding:[30,30]});fitted=true;}
  }

  function update(){if(!data)return;renderDetail();renderRanking();drawMap();}
  function choose(code){selected=code;update();}
  function chooseCase(index){
    caseIndex=index;const c=currentCase();
    byId('concl-case-description').textContent=`${c.titulo} · ${c.descripcion}`;
    // Enlace al estudio de caso cuando ese día también es una incidencia del listado.
    byId('concl-open-case').hidden=!(typeof CASES!=='undefined'&&Object.hasOwn(CASES,c.fecha));
    const dependent=[...c.municipios].filter(m=>m.grupo==='dependientes').sort((a,b)=>a.efecto_pct-b.efecto_pct)[0];
    selected=dependent?.codigo??null;update();
  }

  async function addRailway(){
    try{
      const response=await fetch('railway-network.geojson');if(!response.ok)throw Error(`HTTP ${response.status}`);
      const network=await response.json();
      L.geoJSON({type:'FeatureCollection',features:network.features.filter(f=>f.properties?.kind==='line')},{pane:'concl-rail',interactive:false,style:f=>({color:f.properties.color,weight:3,opacity:.7})}).addTo(map);
    }catch(error){/* La red es contexto visual: sin ella el mapa sigue siendo válido. */}
  }
  function initMap(){
    if(map)return true;
    if(!window.L){byId('concl-map').innerHTML='<p class="empty-state">Mapa no disponible: Leaflet no se ha cargado. Comprueba la conexión a Internet.</p>';return false;}
    map=L.map('concl-map',{scrollWheelZoom:false,zoomSnap:.25});
    map.createPane('concl-rail').style.zIndex=350;map.createPane('concl-points').style.zIndex=450;
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'});
    tiles.on('tileerror',()=>{if(map.hasLayer(tiles))map.removeLayer(tiles);});tiles.addTo(map);
    markers=L.layerGroup().addTo(map);void addRailway();
    return true;
  }
  // Leaflet necesita el contenedor visible para medirlo: el mapa se crea al abrir la página.
  function show(){
    if(byId('conclusions-view').hidden||!data)return;
    if(initMap()){map.invalidateSize();drawMap();}
  }

  function render(){
    byId('conclusions-period').textContent=`${dateLabel(data.periodo.inicio)} — ${dateLabel(data.periodo.fin)}`;
    byId('conclusions-kpis').innerHTML=data.kpis.map(k=>`<div class="general-kpi"><strong>${k.valor<0?signed(k.valor,k.decimales):number(k.valor,k.decimales)}${escape(k.unidad)}</strong><span>${escape(k.etiqueta)}</span></div>`).join('');
    byId('conclusions-cards').innerHTML=data.conclusiones.map((q,i)=>`<article class="research-card"><span class="question-number">0${i+1}</span><p class="question-text">${escape(q.pregunta)}</p><h2>${escape(q.titulo)}</h2><p>${escape(q.texto)}</p></article>`).join('');
    byId('concl-case').innerHTML=data.mapa.map((c,i)=>`<option value="${i}">${escape(dateLabel(c.fecha))} · ${escape(c.titulo)}</option>`).join('');
    byId('concl-event').innerHTML=eventChart([...data.evento].sort((a,b)=>a.dia-b.dia));
    renderNeighbourhoods();
    byId('concl-method').innerHTML=Object.entries(data.metodo||{}).map(([key,value])=>`<p><strong>${escape({mapa:'Mapa',grupos:'Grupos',evento:'Duración',barrios:'Barrios'}[key]||key)}:</strong> ${escape(value)}</p>`).join('')+`<p><strong>Fuente:</strong> ${escape(data.fuente)}</p><ul>`+(data.limitaciones||[]).map(t=>`<li>${escape(t)}</li>`).join('')+'</ul>';
    byId('conclusions-content').hidden=false;byId('conclusions-status').textContent='';
    chooseCase(0);show();
  }
  function renderNeighbourhoods(){if(data)byId('concl-barrios').innerHTML=neighbourhoodChart(data.barrios.filter(r=>r.sentido===byId('concl-direction').value));}

  async function loadConclusions(){
    const id=++sequence;
    try{
      const response=await fetch(CONCLUSIONS_DATA);if(!response.ok)throw Error(`HTTP ${response.status}`);
      const json=await response.json();if(id!==sequence)return;
      if(!valid(json))throw Error('Esquema de conclusiones incompatible');
      data=json;render();
    }catch(error){if(id===sequence){byId('conclusions-content').hidden=true;byId('conclusions-status').textContent=`No se pudieron cargar las conclusiones (${error.message}). Ejecuta la celda de exportación del notebook de M2 y sirve el proyecto mediante HTTP.`;}}
  }

  byId('concl-case').onchange=e=>{fitted=false;chooseCase(Number(e.target.value));};
  byId('concl-group').onchange=()=>{const rows=visibleMunicipalities();if(!rows.some(m=>m.codigo===selected))selected=[...rows].sort((a,b)=>a.efecto_pct-b.efecto_pct)[0]?.codigo??null;update();};
  byId('concl-ranking').onclick=e=>{const button=e.target.closest('[data-code]');if(button)choose(button.dataset.code);};
  byId('concl-direction').onchange=renderNeighbourhoods;
  byId('concl-open-case').onclick=()=>{if(data)window.RMoveOverview?.showView('cases',currentCase().fecha);};
  window.RMoveConclusions={show,loadConclusions};
  void loadConclusions();
})();
