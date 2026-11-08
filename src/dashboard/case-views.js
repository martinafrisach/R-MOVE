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
 <div class="range-caption">Referencia calculada con <b>${r.n_controles}</b> días del mismo día semanal.</div>`;
}
