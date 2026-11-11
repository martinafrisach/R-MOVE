'use strict';
// Presentación de resultados calculados en Python; no estima efectos en el navegador.
const GENERAL_DATA='../../data/processed/rmove/general/dashboard_general.json';
(function () {
  const byId=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('es-ES',{maximumFractionDigits:d,minimumFractionDigits:d}):'Sin datos';
  const integer=v=>number(v,0);
  const dateLabel=value=>new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  let overview=null,sequence=0;

  function showView(view,date) {
    const cases=view==='cases';
    byId('general-view').hidden=cases;
    byId('case-view').hidden=!cases;
    byId('case-picker').hidden=!cases;
    byId('nav-general').setAttribute('aria-pressed',String(!cases));
    byId('nav-cases').setAttribute('aria-pressed',String(cases));
    if(window.history?.replaceState&&window.location){
      const address=new URL(window.location.href);
      if(cases){address.searchParams.set('view','cases');address.searchParams.set('date',date||byId('event').value);}
      else{address.searchParams.delete('view');address.searchParams.delete('date');}
      window.history.replaceState(null,'',address);
    }
    if(cases){
      if(date&&Object.hasOwn(CASES,date))byId('event').value=date;
      void load().then(()=>{if(!byId('case-view').hidden)update();});
    }
  }

  function intervalChart(rows) {
    const labels={directa_vs_placebo_propio:'Directa vs. placebo propio',indirecta_vs_placebo_propio:'Indirecta vs. placebo propio',directa_menos_indirecta_mismas_fechas:'Directa menos indirecta'};
    const valid=rows.filter(r=>Number.isFinite(r.estimacion_pp));
    if(!valid.length)return '<p class="empty-state">No hay fechas suficientes para este contraste.</p>';
    const endpoints=valid.flatMap(r=>[r.estimacion_pp,r.ic95_inferior_pp,r.ic95_superior_pp]).filter(Number.isFinite);
    const lower=Math.min(0,...endpoints)-.4,upper=Math.max(0,...endpoints)+.4;
    const x=v=>230+(v-lower)/(upper-lower)*360;
    let svg='<svg viewBox="0 0 650 234" role="img" aria-label="Estimaciones e intervalos exploratorios en puntos porcentuales"><title>Magnitud del cambio respecto a placebos</title>';
    for(let t=0;t<=4;t++){
      const value=lower+(upper-lower)*t/4;
      svg+=`<line x1="${x(value)}" y1="16" x2="${x(value)}" y2="194" stroke="#edf0f2"/><text x="${x(value)}" y="218" text-anchor="middle" class="axis-label">${number(value,1)}</text>`;
    }
    svg+=`<line x1="${x(0)}" y1="16" x2="${x(0)}" y2="194" stroke="#8b98a3" stroke-dasharray="4 4"/>`;
    valid.forEach((r,i)=>{
      const y=43+i*60,color=i===0?'#d5630b':i===1?'#087e86':'#314a62';
      const hasInterval=Number.isFinite(r.ic95_inferior_pp)&&Number.isFinite(r.ic95_superior_pp);
      svg+=`<text x="10" y="${y-2}" class="chart-label">${escape(labels[r.comparacion]||r.comparacion)}</text><text x="10" y="${y+17}" class="axis-label">${integer(r.n_fechas)} fechas · ${integer(r.n_bloques)} bloques</text>`;
      if(hasInterval)svg+=`<line x1="${x(r.ic95_inferior_pp)}" y1="${y}" x2="${x(r.ic95_superior_pp)}" y2="${y}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
      svg+=`<circle cx="${x(r.estimacion_pp)}" cy="${y}" r="6" fill="${color}" stroke="white" stroke-width="2"/><text x="625" y="${y+5}" text-anchor="end" class="chart-value">${number(r.estimacion_pp)}</text>`;
      svg+=`<text x="230" y="${y+21}" class="axis-label">${hasInterval?`IC95 [${number(r.ic95_inferior_pp)}; ${number(r.ic95_superior_pp)}]`:'Sin bloques suficientes para IC'}</text>`;
    });
    return svg+'</svg>';
  }

  function renderTables() {
    if(!overview)return;
    const direction=byId('general-direction').value;
    const rows=overview.contrastes.filter(r=>r.sentido===direction&&r.metrica==='exceso_magnitud_pp');
    byId('magnitude-chart').innerHTML=intervalChart(rows);
    const interval=r=>!r?'Sin datos':`${number(r.estimacion_pp)}<small>${Number.isFinite(r.ic95_inferior_pp)?`[${number(r.ic95_inferior_pp)}; ${number(r.ic95_superior_pp)}]`:'IC no disponible'} · ${integer(r.n_fechas)} fechas</small>`;
    const scenarios=[['completo','Todas las fechas'],['sin_top_1_fechas','Sin la más extrema'],['sin_top_3_fechas','Sin las 3 más extremas'],['sin_top_5_fechas','Sin las 5 más extremas']];
    byId('robustness-table').innerHTML='<table><caption class="sr-only">Sensibilidad a fechas extremas en '+escape(direction)+'</caption><thead><tr><th>Escenario</th><th>Directa · pp</th><th>Indirecta · pp</th></tr></thead><tbody>'+scenarios.map(([id,label])=>{
      const subset=overview.robustez.filter(r=>r.escenario===id&&r.sentido===direction&&r.metrica==='exceso_magnitud_pp');
      return `<tr><th scope="row">${label}</th><td>${interval(subset.find(r=>r.comparacion==='directa_vs_placebo_propio'))}</td><td>${interval(subset.find(r=>r.comparacion==='indirecta_vs_placebo_propio'))}</td></tr>`;
    }).join('')+'</tbody></table>';
    const exposure=byId('recurrence-exposure').value;
    const recurrent=overview.recurrencia.filter(r=>r.sentido===direction&&r.exposicion===exposure).slice(0,8);
    byId('recurrence-table').innerHTML=recurrent.length?'<table><caption class="sr-only">Recurrencia descriptiva por municipio</caption><thead><tr><th>Municipio</th><th>Fechas / meses</th><th>Sobre umbral</th></tr></thead><tbody>'+recurrent.map(r=>`<tr><th scope="row">${escape(r.nombre)}</th><td>${integer(r.n_fechas)} / ${integer(r.n_meses)}</td><td><span class="mini-bar" style="--share:${Math.min(100,Math.max(0,r.fraccion_supera_umbral*100))}%"></span>${number(r.fraccion_supera_umbral*100,1)} %</td></tr>`).join('')+'</tbody></table>':'<p class="empty-state">No hay municipios con muestra suficiente en este grupo.</p>';
  }

  function render() {
    const c=overview.cobertura;
    byId('general-period').textContent=`${dateLabel(c.inicio)} — ${dateLabel(c.fin)}`;
    byId('general-kpis').innerHTML=[['Registros documentados',c.registros_documentados],['Fechas documentadas',c.fechas_documentadas],['Fechas placebo',c.fechas_placebo],['Municipios observados',c.municipios]].map(([label,value])=>`<div class="general-kpi"><strong>${integer(value)}</strong><span>${label}</span></div>`).join('');
    byId('research-questions').innerHTML=overview.conclusiones.map((q,i)=>`<article class="research-card"><span class="question-number">0${i+1}</span><p class="question-text">${escape(q.pregunta)}</p><h2>${escape(q.titulo)}</h2><p>${escape(q.texto)}</p></article>`).join('');
    byId('influence-dates').innerHTML=overview.fechas_extremas.slice(0,5).map((r,i)=>{
      const date=r.fecha.slice(0,10),known=overview.casos.some(c=>c.fecha===date);
      return `<div class="date-item"><span class="date-number">${String(i+1).padStart(2,'0')}</span><div><strong>${dateLabel(date)}</strong><small>${number(r.puntuacion)} pp de exceso de magnitud</small></div>${known?`<button data-case-date="${date}" type="button">Ver caso ↗</button>`:''}</div>`;
    }).join('');
    byId('case-links').innerHTML=overview.casos.map(c=>`<button class="case-link" type="button" data-case-date="${escape(c.fecha)}"><span>${dateLabel(c.fecha)} · #${escape(c.id)}</span><strong>${escape(c.ambito)}</strong><small>${integer(c.n_municipios)} municipios · ${integer(c.n_relaciones)} relaciones verificadas <b aria-hidden="true">↗</b></small></button>`).join('');
    byId('general-method').innerHTML=Object.entries(overview.metodo).map(([key,value])=>`<p><strong>${escape({referencia:'Referencia',placebos:'Placebos',agregacion:'Agregación',intervalos:'Intervalos',extremos:'Fechas extremas'}[key]||key)}:</strong> ${escape(value)}</p>`).join('')+`<p>${integer(c.comparaciones_calibradas)} comparaciones calibradas válidas. Cada comparación corresponde a un municipio, una fecha y un sentido; no son observaciones independientes.</p><ul>`+overview.limitaciones.map(t=>`<li>${escape(t)}</li>`).join('')+'</ul>';
    renderTables();
    byId('general-content').hidden=false;
    byId('general-status').textContent='';
  }

  async function loadOverview() {
    const id=++sequence;
    try{
      const response=await fetch(GENERAL_DATA);
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const json=await response.json();
      if(id!==sequence)return;
      if(json.version_esquema!==1||!json.cobertura||!Array.isArray(json.conclusiones)||json.conclusiones.length!==4||!Array.isArray(json.casos))throw Error('Esquema general incompatible');
      for(const c of json.casos)if(!Object.hasOwn(CASES,c.fecha))throw Error('Caso no disponible en esta versión');
      overview=json;render();
    }catch(error){if(id===sequence){byId('general-content').hidden=true;byId('general-status').textContent=`No se pudo cargar el análisis general (${error.message}). Sirve el proyecto mediante HTTP y comprueba los resultados del motor.`;}}
  }
  byId('nav-general').onclick=()=>showView('general');
  byId('nav-cases').onclick=()=>showView('cases');
  byId('general-direction').onchange=renderTables;
  byId('recurrence-exposure').onchange=renderTables;
  const openFromList=event=>{const button=event.target.closest('[data-case-date]');if(button)showView('cases',button.dataset.caseDate);};
  byId('case-links').onclick=openFromList;
  byId('influence-dates').onclick=openFromList;
  window.RMoveOverview={showView,loadOverview};
  if(window.location?.search){
    const query=new URLSearchParams(window.location.search);
    if(query.get('view')==='cases')showView('cases',query.get('date'));
  }
  void loadOverview();
})();
