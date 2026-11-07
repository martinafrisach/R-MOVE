/* Vistas del caso y gráficos SVG a partir de los datos exportados por Notebook 04. */
function caseNumber(v){return Number.isFinite(v)?num(v,Number.isInteger(v)?0:2):'Sin datos';}
function casePercent(v){return Number.isFinite(v)?signed(v)+' %':'Sin referencia';}

function caseLineChart(rows, dateKey, tracks, incident, label){
 const times=rows.map(r=>Date.parse(r[dateKey]+'T12:00:00Z'));
 const values=rows.flatMap(r=>tracks.map(t=>r[t.key])).filter(Number.isFinite);
 if(!values.length||times.length<2)return '<p>No hay serie suficiente para este gráfico.</p>';
 const w=700,h=245,left=78,right=20,top=16,bottom=40;
 const start=Math.min(...times),end=Math.max(...times),max=Math.max(...values)*1.08||1;
 const x=t=>left+(t-start)/(end-start||1)*(w-left-right);
 const y=v=>h-bottom-v/max*(h-top-bottom);
 const grid=[0,.5,1].map(k=>`<line x1="${left}" y1="${y(max*k)}" x2="${w-right}" y2="${y(max*k)}" stroke="#e5e8e8"/><text x="${left-8}" y="${y(max*k)+5}" text-anchor="end" font-size="13">${num(max*k,0)}</text>`).join('');
 const lines=tracks.map(t=>{
  let open=false,d='';
  const dots=[];
  rows.forEach((r,i)=>{
   const value=r[t.key];
   if(!Number.isFinite(value)){open=false;return;}
   const px=x(times[i]),py=y(value);
   d+=(open?' L':' M')+px.toFixed(2)+' '+py.toFixed(2);open=true;
   dots.push(`<circle cx="${px}" cy="${py}" r="2.3" fill="${t.color}"><title>${esc(r[dateKey])} · ${esc(t.label)}: ${caseNumber(value)}</title></circle>`);
  });
  return `<path d="${d}" fill="none" stroke="${t.color}" stroke-width="2" ${t.dash?'stroke-dasharray="6 4"':''}/>${dots.join('')}`;
 }).join('');
 const when=Date.parse(incident+'T12:00:00Z');
 const marker=when>=start&&when<=end?`<line x1="${x(when)}" x2="${x(when)}" y1="${top}" y2="${h-bottom}" stroke="#9e622f" stroke-dasharray="3 4"/>`:'';
 const indices=[0,Math.floor(rows.length/2),rows.length-1];
 const ticks=indices.map(i=>`<text x="${x(times[i])}" y="${h-13}" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}" font-size="13">${esc(rows[i][dateKey])}</text>`).join('');
 const legend=tracks.map(t=>`<span style="color:${t.color}">● ${esc(t.label)}</span>`).join(' · ');
 return `<div class="series-legend">${legend} · Línea vertical: incidencia</div><svg class="series-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${grid}${marker}${lines}${ticks}</svg>`;
}

function renderCaseContext(d){
 const f=d.incidencia_documentada;
 const source=f&&/^https?:\/\//i.test(f.url)?`<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Fuente verificable del registro</a>`:'';
 $('case-info').innerHTML=f?`<h2>${esc(f.id)} · ${esc(d.ambito)}</h2><p><b>${esc(f.causa)}</b> · ${esc(f.tramo)}</p><p>${esc(f.afectacion)}</p><p class="sum">Líneas documentadas: ${esc(f.lineas_afectadas)} · ${esc(f.horario)}</p><details><summary>Documentación y cautelas del Excel</summary><p>${esc(f.cautelas)}</p><p>Fuente: ${esc(f.fuente)}. Las cifras de la documentación ferroviaria no son resultados de este análisis de movilidad.</p>${source}</details>`:'';
 const indicators=d.diagnostico_provincial?.indicadores||[];
 const volume=indicators.find(r=>r.indicador==='viajes_observados');
 const records=indicators.find(r=>r.indicador==='registros');
 $('coverage-note').textContent=volume&&records?`Contexto provincial: viajes ${casePercent(volume.variacion_pct)} y registros ${casePercent(records.variacion_pct)} frente a sus días comparables (${volume.n_controles} controles). Consulta la cobertura antes de interpretar las diferencias OD.`:'Contexto provincial no disponible.';
 $('coverage').innerHTML=`<div class="tablewrap"><table><thead><tr><th>Indicador provincial</th><th>Observado</th><th>Mediana comparable</th><th>Variación</th><th>N</th></tr></thead><tbody>${indicators.map(r=>`<tr><td>${esc(({viajes_observados:'Viajes',registros:'Registros',n_od:'Relaciones OD disponibles',viajes_por_registro:'Viajes por registro'})[r.indicador]||r.indicador)}</td><td>${caseNumber(r.observado)}</td><td>${caseNumber(r.mediana_controles)}</td><td>${casePercent(r.variacion_pct)}</td><td>${r.n_controles}</td></tr>`).join('')}</tbody></table></div>`;
 const day=new Date(d.fecha_incidencia+'T12:00:00Z').getUTCDay();
 const series=(d.diagnostico_provincial?.serie||[]).filter(r=>new Date(r.day+'T12:00:00Z').getUTCDay()===day);
 $('province-series').innerHTML=series.length?`<p>Se muestran únicamente los mismos días semanales. La tabla identifica cuáles se usaron como controles.</p><div class="charts">${[{key:'viajes_observados',label:'Viajes provinciales',ref:volume},{key:'registros',label:'Registros',ref:records}].map(t=>`<div><h3>${t.label}</h3>${caseLineChart(series.map(r=>({...r,mediana:t.ref?.mediana_controles})), 'day',[{key:t.key,label:'Observado',color:'#e8700a'},{key:'mediana',label:'Mediana de controles',color:'#536979',dash:true}],d.fecha_incidencia,t.label)}</div>`).join('')}</div><div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Viajes</th><th>Registros</th><th>Referencia utilizada</th></tr></thead><tbody>${series.map(r=>`<tr><td>${esc(r.day)}</td><td>${caseNumber(r.viajes_observados)}</td><td>${caseNumber(r.registros)}</td><td>${r.day===d.fecha_incidencia?'Incidencia':r.es_control?'Sí':'No'}</td></tr>`).join('')}</tbody></table></div>`:'<p>Sin serie provincial exportada.</p>';
 $('case-conclusions').innerHTML=(d.conclusiones||[]).map(s=>`<p>${esc(s)}</p>`).join('');
 const availability=d.disponibilidad_od||[];
 const excluded=availability.filter(r=>!r.seleccionada);
 $('availability-title').textContent=`Disponibilidad: ${d.relaciones.length} relaciones analizadas; ${excluded.length} excluidas`;
 $('availability').innerHTML=`<p>Criterios: al menos 300 días y media de 100 viajes/día en 2024, observación válida del episodio y mínimo tres controles. La exclusión no significa ausencia de movilidad.</p><div class="tablewrap"><table><thead><tr><th>Relación</th><th>Días 2024</th><th>Media viajes/día 2024</th><th>Observados del episodio</th><th>N controles</th><th>Selección</th></tr></thead><tbody>${availability.map(r=>`<tr><td>${esc(r.relacion)}</td><td>${r.dias_observados_2024}</td><td>${caseNumber(r.viajes_medios_2024)}</td><td>${caseNumber(r.viajes_observados_fecha)}</td><td>${r.n_controles}</td><td>${r.seleccionada?'Incluida':esc(r.motivo)}</td></tr>`).join('')}</tbody></table></div>`;
 $('relations-title').textContent=`Consultar las ${d.relaciones.length} relaciones · ${d.ambito}`;
 $('download-json').href=CASES[d.fecha_incidencia].file;
 const csv=d.archivos?.controles;
 $('download-controls').href=/^[a-zA-Z0-9_.-]+\.csv$/.test(csv||'')?'../../data/processed/rmove/'+csv:'#';
}

function renderRelationExtras(d,r){
 const series=(d.evolucion_temporal||[]).filter(x=>x.relacion===r.relacion);
 $('temporal-title').textContent=`Evolución temporal · ${r.relacion}`;
 $('temporal').innerHTML=caseLineChart(series,'fecha',[
  {key:'viajes_observados',label:'Viajes observados',color:'#e8700a'},
  {key:'mediana_viajes_controles',label:'Mediana retrospectiva por fecha',color:'#536979',dash:true},
 ],d.fecha_incidencia,'Viajes observados y mediana retrospectiva por fecha');
 const rows=(d.sensibilidad||[]).filter(x=>x.relacion===r.relacion);
 $('sensitivity').innerHTML=rows.length?`<p>Son referencias distintas: el modo retrospectivo utiliza futuro; el predictivo solo días anteriores.</p><div class="tablewrap"><table><thead><tr><th>Modo</th><th>Ventana</th><th>N controles</th><th>Variación</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.modo_controles==='predictivo'?'Solo anteriores':'Anteriores y posteriores'}</td><td>${x.ventana_dias} días</td><td>${x.n_controles}</td><td>${casePercent(x.variacion_observada_pct)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No hay comparación de ventanas exportada.</p>';
}
