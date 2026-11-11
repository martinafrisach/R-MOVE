'use strict';
// Geographic reference only; this layer never changes the mobility analysis.
window.RMoveRailway = (() => {
  let map, network, linesLayer, stationsLayer, highlightLayer, incidentLayer, networkOnly = false;
  const get = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Explicit municipal station associations for the municipalities in the five cases.
  // Multiple stations are alternatives on different corridors, not inferred centroids.
  const MUNICIPAL_STOPS = {
    '08019':['71801'], '08121':['79500'], '08172':['79409'], '08118':['79407'], '08006':['79600'],
    '08194':['79403'], '08015':['79404'], '08126':['79405'], '08219':['79410'],
    '08125':['78800','78708','78707','79005','77002'], '08260':['77003','72508'],
    '08124':['79006','77004'], '08159':['77005'], '08096':['79100','77006'],
    '08266':['78706','72503'], '08252':['78705'], '08187':['78704'], '08279':['78700'],
    '08101':['72305'], '08073':['72303'], '08217':['72302'], '08211':['72301'],
    '08123':['72300'], '08114':['72209'], '08169':['71707'], '08307':['71700'],
    '08089':['71706'], '08056':['71705'], '08135':['79007'], '08105':['79011']
  };
  const normalize = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  let municipalStops = {}, incident = null;
  function affectedLines() {
    const raw=context?.incidencia_documentada?.lineas_afectadas||'';
    if(/todas|totes/i.test(raw))return Object.keys(lineIndex);
    return [...new Set((raw.match(/R(?:G|L|T)?\d+(?:\s*(?:Nord|Sud|N|S)\b)?/gi)||[]).map(s=>s.toUpperCase().replace(/\s*NORD/,'N').replace(/\s*SUD/,'S').replace(/\s/g,'')))].filter(id=>lineIndex[id]);
  }
  function resolveContext() {
    if(!network||!stationIndex)return;
    municipalStops={};
    for(const municipality of context?.municipios||[]) {
      const explicit=municipality.estaciones_renfe;
      if(Array.isArray(explicit)) {
        municipalStops[municipality.codigo]=explicit.filter(id=>stationIndex[id]);
        continue;
      }
      if(MUNICIPAL_STOPS[municipality.codigo]) {
        municipalStops[municipality.codigo]=MUNICIPAL_STOPS[municipality.codigo];continue;
      }
      // Conservative fallback for new municipalities: whole-name prefixes,
      // never nearest-town snapping. Explicit IDs override ambiguous names.
      const name=normalize(municipality.nombre);
      municipalStops[municipality.codigo]=Object.values(stationIndex).filter(station=>{
        const label=normalize(station.properties.name);
        return name&&(label===name||label.startsWith(name+' '));
      }).map(station=>station.properties.id);
    }
    const documented=context?.incidencia_documentada||{}, text=normalize(documented.tramo);
    const lines=affectedLines();
    if(Array.isArray(documented.estaciones_renfe)) {
      const valid=documented.estaciones_renfe.every(id=>stationIndex[id]);
      incident={stops:valid?documented.estaciones_renfe:[],lines,note:documented.tramo||'Localización por identificadores de estación',resolved:valid};return;
    }
    const hits=[];
    for(const station of Object.values(stationIndex)) {
      const name=normalize(station.properties.name);
      const aliases=new Set([name,name.replace(/^barcelona /,'')]);
      if(station.properties.id==='78805')aliases.add('placa catalunya');
      for(const alias of aliases) {
        const start=(' '+text+' ').indexOf(' '+alias+' ');
        if(start>=0)hits.push({id:station.properties.id,start,end:start+alias.length});
      }
    }
    const accepted=[];
    for(const hit of hits.sort((a,b)=>(b.end-b.start)-(a.end-a.start))) {
      if(!accepted.some(other=>hit.start<other.end&&hit.end>other.start))accepted.push(hit);
    }
    const stops=[...new Set(accepted.sort((a,b)=>a.start-b.start).map(hit=>hit.id))];
    incident={stops,lines,note:documented.tramo||'sin localización documentada',resolved:stops.length>0};
  }
  let corridors = {}, graph, stationIndex, lineIndex, selection = null, context = null, onChoose = null;
  const variationColor = value => value < 0 ? '#356fb3' : value > 0 ? '#dc7835' : '#82929f';
  const percent = value => `${value>0?'+':''}${value.toLocaleString('es-ES',{maximumFractionDigits:2})} %`;
  function projected(point) {return [point[0]*84000, point[1]*111000];}
  function locate(points, point) {
    const p = projected(point); let best = {distance:Infinity};
    for (let i=0;i<points.length-1;i++) {
      const a=projected(points[i]), b=projected(points[i+1]), dx=b[0]-a[0], dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
      const distance=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
      if(distance<best.distance)best={distance,position:i+t,point:points[i].map((v,k)=>v+t*(points[i+1][k]-v))};
    }
    return best;
  }
  function sliceTrack(feature, from, to) {
    const points=feature.geometry.coordinates;
    let a=locate(points,stationIndex[from].geometry.coordinates), b=locate(points,stationIndex[to].geometry.coordinates);
    const reverse=a.position>b.position;if(reverse)[a,b]=[b,a];
    const result=[a.point,...points.slice(Math.floor(a.position)+1,Math.ceil(b.position)),b.point];
    return reverse?result.reverse():result;
  }
  function buildGraph() {
    graph={};
    stationIndex=Object.fromEntries(network.features.filter(f=>f.properties.kind==='station').map(f=>[f.properties.id,f]));
    lineIndex=Object.fromEntries(network.features.filter(f=>f.properties.kind==='line').map(f=>[f.properties.id,f]));
    for(const [line,feature] of Object.entries(lineIndex)) {
      const stops=feature.properties.stops;
      for(let i=1;i<stops.length;i++) {
        const a=stops[i-1],b=stops[i],points=sliceTrack(feature,a,b);
        const length=points.slice(1).reduce((sum,p,j)=>{const q=projected(p),r=projected(points[j]);return sum+Math.hypot(q[0]-r[0],q[1]-r[1]);},0);
        (graph[a]??=[]).push({from:a,to:b,line,points,length});
        (graph[b]??=[]).push({from:b,to:a,line,points:[...points].reverse(),length});
      }
    }
  }
  // Group physical links by consecutive station pair. Shared links use one
  // canonical geometry so small differences between GTFS shapes cannot swap lanes.
  function corridorKey(a,b){return [a,b].sort().join('|');}
  function buildCorridors(){
    corridors={};
    for(const edges of Object.values(graph))for(const edge of edges){
      const key=corridorKey(edge.from,edge.to);
      const corridor=corridors[key]??={points:edge.from<edge.to?edge.points:[...edge.points].reverse(),lines:[]};
      if(!corridor.lines.includes(edge.line))corridor.lines.push(edge.line);
    }
    const order=Object.keys(lineIndex);
    for(const corridor of Object.values(corridors))corridor.lines.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  }
  function offsetTrack(points,offset){
    // Straight, parallel middle sections with short joins into each real
    // station. This changes presentation only, never the routing graph.
    const scale=256*2**map.getZoom();
    const project=([lon,lat])=>{const sin=Math.sin(lat*Math.PI/180);return [(lon+180)/360*scale,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale];};
    const a=project(points[0]),b=project(points.at(-1));
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(length<.001)return points;
    const join=Math.min(.12,12/length);
    return [0,join,.5,1-join,1].map((t,i)=>{
      const shift=i===0||i===4?0:offset;
      const x=a[0]+t*dx-dy/length*shift,y=a[1]+t*dy+dx/length*shift;
      return [x/scale*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/scale)))*180/Math.PI];
    });
  }
  function displayEdge(edge){
    if(get('railway-line').value)return edge.points;
    const corridor=corridors[corridorKey(edge.from,edge.to)];
    if(!corridor||corridor.lines.length<2)return edge.points;
    const lane=corridor.lines.indexOf(edge.line)-(corridor.lines.length-1)/2;
    const stops=[edge.from,edge.to].sort();
    const points=offsetTrack(stops.map(id=>stationIndex[id].geometry.coordinates),lane*12);
    return edge.from<edge.to?points:[...points].reverse();
  }
  function displayLine(feature){
    if(get('railway-line').value)return feature;
    const stops=feature.properties.stops,coordinates=[];
    for(let i=1;i<stops.length;i++){
      const edge=graph[stops[i-1]].find(edge=>edge.to===stops[i]&&edge.line===feature.properties.id);
      if(edge)coordinates.push(displayEdge(edge));
    }
    return {...feature,geometry:{type:'MultiLineString',coordinates}};
  }
  function route(fromCode,toCode,allowedLine='') {
    if(!graph)return null;
    const starts=(municipalStops[fromCode]??MUNICIPAL_STOPS[fromCode]??[]).filter(id=>stationIndex[id]);
    const ends=new Set((municipalStops[toCode]??MUNICIPAL_STOPS[toCode]??[]).filter(id=>stationIndex[id]));
    if(!starts.length||!ends.size)return null;
    const preferred=new Set(affectedLines());
    const queue=starts.map(id=>({id,line:'',cost:0,edges:[],stops:[id]})),costs=new Map();
    while(queue.length) {
      queue.sort((a,b)=>b.cost-a.cost);const current=queue.pop(),key=current.id+'|'+current.line;
      if(costs.has(key)&&costs.get(key)<current.cost)continue;
      if(ends.has(current.id)&&current.edges.length)return current;
      for(const edge of graph[current.id]||[]) {
        if(allowedLine&&edge.line!==allowedLine)continue;
        const transfer=current.line&&current.line!==edge.line?3000:0;
        const penalty=preferred.size&&!preferred.has('Todas')&&!preferred.has(edge.line)?1.15:1;
        const cost=current.cost+edge.length*penalty+transfer,nextKey=edge.to+'|'+edge.line;
        if(costs.has(nextKey)&&costs.get(nextKey)<=cost)continue;
        costs.set(nextKey,cost);queue.push({id:edge.to,line:edge.line,cost,edges:[...current.edges,edge],stops:[...current.stops,edge.to]});
      }
    }
    return null;
  }
  function featureFor(points) {return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points}};}
  function paint(points,style,tooltip,layer,click) {
    const item=L.geoJSON(featureFor(points),{pane:'railway-highlight',style}).bindTooltip(tooltip);
    if(click)item.on('click',click);
    item.addTo(layer);
  }
  function showIncident() {
    // Hide the extent overlay for the 2 May case as requested.
    if(context?.fecha_incidencia==='2023-05-02')return;
    if(!incident)return;
    const filter=get('railway-line').value;
    if(incident.stops.length>=2)for(const line of incident.lines) {
      if(filter&&filter!==line)continue;
      const feature=lineIndex[line];
      if(feature&&incident.stops.every(id=>feature.properties.stops.includes(id)))paint(sliceTrack(feature,incident.stops[0],incident.stops.at(-1)),{color:'#9b2547',weight:23,opacity:.8,dashArray:'5 8'},`Incidencia documentada · ${escape(incident.note)}`,incidentLayer);
    }
    if(incident.stops.length===1) {
      const station=stationIndex[incident.stops[0]];
      if(filter&&!station.properties.lines.includes(filter))return;
      L.circleMarker([...station.geometry.coordinates].reverse(),{pane:'railway-highlight',radius:11,color:'#9b2547',weight:4,fillColor:'#fff',fillOpacity:1})
        .bindTooltip(`Incidencia documentada · ${escape(incident.note)}`).addTo(incidentLayer);
    }
  }
  function drawSelection(fit=false) {
    highlightLayer.clearLayers();incidentLayer.clearLayers();
    if(!network)return;
    showIncident();
    const rows=selection?.rows||[], active=rows.find(r=>r.i===selection.selected);
    // With no selected relation, show the strongest relation per physical edge.
    // Never sum percentages or assign a municipal change to intermediate towns.
    const displayed=active?[active]:[...rows].sort((a,b)=>Math.abs(a.variacion_observada_pct)-Math.abs(b.variacion_observada_pct));
    const segments=new Map();let activeRoute=null,unmapped=0;
    for(const row of displayed) {
      const path=route(row.municipio_origen,row.municipio_destino,get('railway-line').value);
      if(!path){unmapped++;continue;}
      if(active)activeRoute=path;
      for(const edge of path.edges)segments.set(edge.line+'|'+[edge.from,edge.to].sort().join('|'),{row,edge});
    }
    for(const {row,edge} of segments.values()) {
      const tooltip=`${escape(row.relacion)} · ${percent(row.variacion_observada_pct)} · ${lineIndex[edge.line].properties.name}`;
      paint(displayEdge(edge),{color:'#d62828',weight:active?16:11,opacity:1,lineCap:'round',lineJoin:'round'},tooltip,highlightLayer,()=>onChoose?.(row.i));
      paint(displayEdge(edge),{color:variationColor(row.variacion_observada_pct),weight:active?5:3,opacity:1,dashArray:'8 7',lineCap:'round'},tooltip,highlightLayer,()=>onChoose?.(row.i));
    }
    const detail=get('railway-route');
    if(activeRoute) {
      const names=activeRoute.stops.map(id=>stationIndex[id].properties.name);
      const used=[...new Set(activeRoute.edges.map(e=>lineIndex[e.line].properties.name))];
      detail.textContent=`${active.relacion} · ${percent(active.variacion_observada_pct)} de viajes · ${used.join(' → ')} · ${names.length} estaciones, de ${names[0]} a ${names.at(-1)}.`;
      let previousLine=null;
      for(let i=0;i<activeRoute.edges.length;i++) {
        const edge=activeRoute.edges[i];
        if(edge.line===previousLine)continue;
        previousLine=edge.line;
        const run=[];for(let j=i;j<activeRoute.edges.length&&activeRoute.edges[j].line===edge.line;j++)run.push(...displayEdge(activeRoute.edges[j]));
        const point=run[Math.floor(run.length/2)];
        L.circleMarker([...point].reverse(),{pane:'railway-highlight',radius:0,weight:0,opacity:0,fillOpacity:0,interactive:false})
          .bindTooltip(escape(lineIndex[edge.line].properties.name),{permanent:true,direction:'center',className:'railway-line-tag'}).addTo(highlightLayer);
      }
      const stationSet=new Set(activeRoute.stops);
      for(const id of stationSet) {
        const station=stationIndex[id],endpoint=id===activeRoute.stops[0]||id===activeRoute.stops.at(-1);
        L.circleMarker([...station.geometry.coordinates].reverse(),{pane:'railway-highlight',radius:endpoint?9:6,color:variationColor(active.variacion_observada_pct),weight:3,fillColor:endpoint?variationColor(active.variacion_observada_pct):'#fff',fillOpacity:1})
          .bindTooltip(escape(station.properties.name),{permanent:endpoint||get('railway-labels').checked&&map.getZoom()>=12,direction:'top',className:'railway-station-label'}).addTo(highlightLayer);
      }
      if(fit)map.fitBounds(activeRoute.stops.map(id=>[...stationIndex[id].geometry.coordinates].reverse()),{padding:[45,45]});
    } else if(active) detail.textContent='Sin recorrido ferroviario de referencia para esta relación con el filtro de línea actual. Selecciona «Todas las líneas» o consulta otra relación.';
    else detail.textContent=rows.length?`Relaciones filtradas sobre la red. En tramos compartidos se muestra la mayor variación absoluta; selecciona una relación para ver su recorrido completo.${unmapped?' Algunas relaciones no tienen recorrido con este filtro.':''}`:'Selecciona un municipio o una relación para ver la variación sobre el trazado ferroviario.';
    get('railway-incident').textContent=`Incidencia documentada: ${incident?.note||'sin localización documentada'}${incident&&!incident.resolved?' · sin estación o tramo identificado en la red disponible':''}.`;
  }
  function showNetwork() {
    networkOnly=true;context=null;selection=null;onChoose=null;incident=null;municipalStops={};
    get('railway-line').value='';
    if(network)draw(true);
  }
  function setSelection(value) {
    networkOnly=false;
    const changed=selection?.selected!==value.selected||context?.fecha_incidencia!==value.data.fecha_incidencia;
    context=value.data;selection=value;onChoose=value.onChoose;
    resolveContext();
    if(network)draw(false,changed);
  }
  function draw(fit = false, fitSelection = false) {
    if (!network) return;
    linesLayer.clearLayers();
    stationsLayer.clearLayers();
    const lineId = get('railway-line').value;
    const lines = network.features.filter(f => f.properties.kind === 'line');
    const selected = lines.filter(f => !lineId || f.properties.id === lineId);
    const stations = network.features.filter(f => f.properties.kind === 'station' && (!lineId || f.properties.lines.includes(lineId)));
    const colors = Object.fromEntries(lines.map(f => [f.properties.id, f.properties.color]));
    {
      const tracks=selected.map(displayLine);
      // Paint all casings first so the white edge of one lane cannot hide
      // a neighbouring line's colour.
      tracks.forEach(feature=>L.geoJSON(feature,{pane:'railway-tracks',interactive:false,style:{color:'#fff',weight:lineId?12:9,opacity:.95,lineCap:'round',lineJoin:'round'}}).addTo(linesLayer));
      tracks.forEach(feature=>L.geoJSON(feature,{
        pane:'railway-tracks',style:{color:feature.properties.color,weight:lineId?8:6,opacity:selection?.rows?.length ? .75 : 1,lineCap:'round',lineJoin:'round'}
      }).bindTooltip(`${escape(feature.properties.name)} · ${escape(feature.properties.description)}`).addTo(linesLayer));
      stations.forEach(feature => {
        const p = feature.properties, [lon, lat] = feature.geometry.coordinates;
        const marker = L.circleMarker([lat, lon], {pane: 'railway-stations', radius: lineId ? 5 : 4,
          color: colors[lineId || p.lines[0]], weight: 2, fillColor: '#fff', fillOpacity: 1});
        marker.bindTooltip(escape(p.name), {permanent: get('railway-labels').checked && map.getZoom() >= 12,
          direction: 'top', offset: [0, -4], className: 'railway-station-label'});
        marker.bindPopup(`<strong>${escape(p.name)}</strong><p>Estación de Rodalies</p><div class="railway-badges">${p.lines.map(id => `<span style="background:${colors[id]}">${escape(lines.find(f => f.properties.id === id).properties.name)}</span>`).join('')}</div>`);
        marker.addTo(stationsLayer);
      });
    }
    drawSelection(fitSelection);
    get('railway-count').textContent = `${selected.length} ${selected.length === 1 ? 'línea' : 'líneas'} · ${stations.length} estaciones`;
    if (fit && stations.length) map.fitBounds(stations.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]), {padding: [35, 35]});
  }
  async function mount(instance) {
    if (map) return;
    map = instance;
    map.createPane('railway-tracks').style.zIndex = 350;
    map.createPane('railway-stations').style.zIndex = 450;
    map.createPane('railway-highlight').style.zIndex = 460;
    linesLayer = L.layerGroup().addTo(map);
    stationsLayer = L.layerGroup().addTo(map);
    incidentLayer = L.layerGroup().addTo(map);
    highlightLayer = L.layerGroup().addTo(map);
    get('railway-count').textContent = 'Cargando red ferroviaria…';
    get('railway-line').onchange = () => draw(!selection?.rows?.some(r=>r.i===selection.selected),true);
    get('railway-labels').onchange = () => draw();
    map.on('zoomend', () => draw());
    try {
      const response = await fetch('railway-network.geojson');
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      network = await response.json();
      if (network.type !== 'FeatureCollection' || !Array.isArray(network.features)) throw Error('Formato incorrecto');
      const lines = network.features.filter(f => f.properties.kind === 'line');
      get('railway-line').innerHTML = '<option value="">Todas las líneas</option>' + lines.map(f => `<option value="${escape(f.properties.id)}">${escape(f.properties.name)} · ${escape(f.properties.description)}</option>`).join('');
      get('railway-legend').innerHTML = lines.map(f => `<span><i style="background:${f.properties.color}"></i>${escape(f.properties.name)}</span>`).join('');
      get('railway-line').disabled = false;
      buildGraph();
      buildCorridors();
      resolveContext();
      draw(networkOnly,!networkOnly);
    } catch (error) {
      get('railway-count').textContent = `No se pudo cargar la red ferroviaria (${error.message}). Recarga la página para reintentar.`;
    }
  }
  return {mount, setSelection, route, showNetwork};
})();
