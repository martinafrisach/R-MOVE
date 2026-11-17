/* Panel único de resultados: porcentajes, volumen y referencia, sin tablas duplicadas. */
function relationHTML(r){
 if (!r) return '<h2>Selecciona una relación</h2><p class="muted">Elige una conexión del mapa o del ranking.</p>';
 if (r.estado !== 'ok' || !Number.isFinite(r.variacion_observada_pct)) return `<h2>${esc(r.relacion)}</h2><p>Sin referencia comparable válida.</p>`;
 const v=r.variacion_observada_pct, cls=v<0?'down':v>0?'up':'neutral';
 const delta=r.diferencia_viajes;
 return `<div class="detail-title"><small>RELACIÓN SELECCIONADA</small><h2>${esc(r.relacion)}</h2></div>
 <div class="main-value ${cls}">${signed(v,2)} %</div>
 <p class="delta-caption">${v<0?'Menos viajes':v>0?'Más viajes':'Sin cambio'} respecto a la mediana comparable</p>
 <p class="absolute ${cls}">${signed(delta,Number.isInteger(delta)?0:1)} viajes respecto a la referencia</p>
 <div class="numbers"><div><small>Viajes observados</small><strong>${fmt(r.viajes_observados)}</strong></div><div><small>Mediana comparable</small><strong>${fmt(r.mediana_viajes_controles)}</strong></div></div>
 ${rangeHTML(r)}
 <div class="range-caption">Referencia calculada con <b>${r.n_controles}</b> días del mismo día semanal.</div>`;
}
/* Rango habitual (percentiles 25–75 de los días comparables) frente al valor del día. */
function rangeHTML(r){
 const lo=r.p25_viajes_controles,hi=r.p75_viajes_controles,obs=r.viajes_observados,med=r.mediana_viajes_controles;
 if(![lo,hi,obs,med].every(Number.isFinite))return '';
 const min=Math.min(lo,obs,med),max=Math.max(hi,obs,med),pad=(max-min)*0.12||Math.max(1,max*0.05),a=min-pad,b=max+pad,x=v=>((v-a)/(b-a)*100).toFixed(1);
 const out=r.fuera_rango_intercuartil_viajes!==false,cls=obs<med?'down':'up';
 return `<div class="range-box"><div class="range-head"><small>Rango habitual (días comparables)</small><span class="range-pill ${out?cls:'neutral'}">${out?'Fuera de lo habitual':'Dentro de lo habitual'}</span></div>
 <div class="range-bar" role="img" aria-label="Rango habitual de ${fmt(lo)} a ${fmt(hi)} viajes; ese día ${fmt(obs)}"><span class="band" style="left:${x(lo)}%;width:${(x(hi)-x(lo)).toFixed(1)}%"></span><i class="med" style="left:${x(med)}%"></i><i class="obs ${cls}" style="left:${x(obs)}%"></i></div>
 <div class="range-scale"><span>${fmt(lo)}–${fmt(hi)} viajes habituales</span><span class="${cls}">Ese día: ${fmt(obs)}</span></div></div>`;
}
