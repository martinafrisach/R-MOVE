'use strict';
// Páginas «Resultados» y ficha de incidencia: presentan resultados ya calculados en el notebook 04 (M2) y M3.
// No estiman nada en el navegador. El fichero lo genera exportar_resultados() al final del notebook.
const CONCLUSIONS_DATA='../../data/processed/rmove/resultados/dashboard_resultados.json';
(function () {
  const byId=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(v,d=1)=>{if(!Number.isFinite(v))return 'Sin datos';const [i,f]=Math.abs(v).toFixed(d).split('.');return (v<0&&Number(Math.abs(v).toFixed(d))!==0?'-':'')+i.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(f?','+f:'');};
  const signed=(v,d=1)=>Number.isFinite(v)?`${v>0?'+':v<0?'−':''}${number(Math.abs(v),d)}`:'Sin datos';
  const thousands=v=>number(Math.round(v),0);
  const pText=p=>!Number.isFinite(p)?'p no disponible':p<0.001?'p < 0,001':`p = ${number(p,p<0.01?3:2)}`;
  const dateLabel=value=>new Date(value+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const shortDate=value=>new Date(value+'T12:00:00Z').toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit',timeZone:'UTC'});
  const GROUPS={dependientes:'Dependientes de Rodalies',cercanos:'Cercanos sin metro/FGC',metro_fgc:'Con metro/FGC',sin_rodalies:'Sin Rodalies (control)'};
  const GROUP_NOTES={dependientes:'≥ 20 km y sin metro ni FGC',cercanos:'< 20 km, con bus metropolitano',metro_fgc:'Tienen otra opción de tren'};
  const LINE_COLORS={R1:'#78b3e0',R2:'#009949','R2 Nord':'#92c33e','R2 Sud':'#00a35a',R3:'#db3c37',R4:'#ee9a43',R7:'#ab74a4',R8:'#880063'};
  const LINE_NAMES={R1:'R1 · Maresme',R2N:'R2 Nord · Vallès Oriental','R2N+R3':'R2N+R3 · Granollers',R2S:'R2 Sud · Garraf',R3:'R3 · Osona',R4:'R4 · Penedès–Bages',R7:'R7 · Cerdanyola'};
  const COLOR={down:'#80baff',up:'#ffb16e',weak:'#7d8e9c',ref:'#4dbec4',grid:'#364b5d',text:'#d7e6f1',muted:'#a8b9c7',normal:'#4a6075',band:'#2b4051'};
  let data=null,map=null,markers=null,incident=null,selected=null,fitted=false,sequence=0,who='grupos';
  let readyPromise=Promise.reject(Error('resultados no cargados'));readyPromise.catch(()=>{});

  const clear=p=>Number.isFinite(p)&&p<0.05;
  const tone=(v,p)=>!clear(p)?COLOR.weak:v<0?COLOR.down:COLOR.up;
  const svgOpen=(w,h,label)=>`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title>`;
  function scale(lo,hi,a,b){return v=>a+(v-lo)/((hi-lo)||1)*(b-a);}
  function niceTicks(lo,hi,n=5){const step=Math.pow(10,Math.floor(Math.log10((hi-lo)/n||1)));const k=[1,2,2.5,5,10].find(m=>(hi-lo)/(step*m)<=n)||10;const s=step*k;const out=[];for(let v=Math.ceil(lo/s)*s;v<=hi+1e-9;v+=s)out.push(+v.toFixed(6));return out;}

  // Escala divergente del mapa y de la matriz: azul = menos viajes, naranja = más viajes.
  function color(value,limit=30){
    const t=Math.max(-1,Math.min(1,value/limit)),neutral=[107,127,144];
    const end=t<0?[128,186,255]:[255,177,110],k=Math.abs(t);
    return `rgb(${neutral.map((n,i)=>Math.round(n+(end[i]-n)*k)).join(',')})`;
  }
  function heatColor(value){const t=Math.max(-1,Math.min(1,value/20)),k=Math.abs(t);const base=[36,56,72],end=t<0?[62,128,214]:[214,130,62];return `rgb(${base.map((n,i)=>Math.round(n+(end[i]-n)*k)).join(',')})`;}

  // ── Validación (mismas comprobaciones que build-pages.py) ──────────────────
  function valid(json){
    const fin=v=>Number.isFinite(v);
    if(json?.version_esquema!==2||!Array.isArray(json.kpis)||!Array.isArray(json.conclusiones)||json.conclusiones.length!==4)return false;
    if(!Array.isArray(json.incidencias)||!json.incidencias.length||!Array.isArray(json.grupos)||!Array.isArray(json.distancia)||!Array.isArray(json.evento)||!Array.isArray(json.barrios)||!json.placebo)return false;
    for(const c of json.incidencias){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)||!Array.isArray(c.municipios)||!c.municipios.length||!Array.isArray(c.grupos)||!Array.isArray(c.serie)||!Array.isArray(c.tramos)||!Array.isArray(c.evento))return false;
      for(const m of c.municipios)if(![m.lat,m.lon,m.efecto_pct,m.viajes_referencia].every(fin)||!Object.hasOwn(GROUPS,m.grupo))return false;
      if(![c.perdidos?.viajes_perdidos,c.perdidos?.viajes_dia_normal].every(fin))return false;
    }
    return [...json.grupos,...json.distancia].every(g=>[g.efecto_pct,g.ic_inf,g.ic_sup].every(fin))
      &&json.evento.every(e=>[e.dia,e.efecto_pct,e.ic_inf,e.ic_sup].every(fin))
      &&json.barrios.every(b=>[b.con_estacion,b.sin_estacion].every(fin))
      &&Array.isArray(json.placebo.valores_pct)&&fin(json.placebo.real_pct);
  }

  // ── Animaciones (se desactivan con «reducir movimiento» o sin soporte del navegador) ──
  const reducedMotion=()=>Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  // Cuenta desde 0 hasta la cifra final; el texto final ya está escrito, la animación solo lo recorre.
  function countUp(container){
    if(reducedMotion()||typeof requestAnimationFrame!=='function'||!container.querySelectorAll)return;
    for(const el of container.querySelectorAll('[data-count]')){
      const target=Number(el.dataset.count),dec=Number(el.dataset.dec||0),unit=el.dataset.unit||'',plus=el.dataset.plus==='1',final=el.textContent;
      if(!Number.isFinite(target))continue;
      const t0=performance.now(),dur=900;
      const step=now=>{const k=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-k,3),v=target*e;
        el.textContent=k<1?`${plus?signed(v,dec):number(v,dec)}${unit}`:final;if(k<1)requestAnimationFrame(step);};
      requestAnimationFrame(step);
    }
  }
  // Las tarjetas aparecen al entrar en pantalla; las que ya quedaron por encima (scroll rápido, saltos) también.
  let revealObserver=null,revealPending=new Set();
  function flushReveal(){
    for(const el of revealPending){const r=el.getBoundingClientRect();if(r.top<innerHeight*.92){el.classList.add('in');revealPending.delete(el);revealObserver.unobserve(el);}}
  }
  function reveal(root){
    if(reducedMotion()||typeof IntersectionObserver!=='function'||!root?.querySelectorAll)return;
    if(!revealObserver){
      revealObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))flushReveal();},{rootMargin:'0px 0px -8% 0px'});
      let ticking=false;window.addEventListener?.('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(()=>{ticking=false;flushReveal();});}},{passive:true});
    }
    for(const el of root.querySelectorAll('.overview-card,.research-card,.general-kpi,.map-card,.detail-card,.top-card,.res-answer,.inc-reading')){
      if(el.classList.contains('in')||revealPending.has(el))continue;el.classList.add('reveal');revealPending.add(el);revealObserver.observe(el);
    }
    requestAnimationFrame(flushReveal);
  }
  function watchIndex(){
    const nav=byId('res-index');if(!nav.querySelectorAll||!window.addEventListener)return;
    const links=[...nav.querySelectorAll('[data-sec]')];
    // Sección activa: la última cuyo inicio ya pasó el 35 % de la pantalla; en empate (tarjetas en la misma fila), la primera.
    const update=()=>{
      if(byId('conclusions-view').hidden)return;
      let best=null,bestTop=-Infinity;
      for(const a of links){const top=byId(a.dataset.sec)?.getBoundingClientRect().top;if(top!==undefined&&top<=innerHeight*.35&&top>bestTop+1){best=a;bestTop=top;}}
      links.forEach(a=>a.classList.toggle('active',a===(best||links[0])));
    };
    let pending=false;window.addEventListener('scroll',()=>{if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;update();});}},{passive:true});
    nav.onclick=e=>{const a=e.target.closest('[data-sec]');if(!a)return;e.preventDefault();byId(a.dataset.sec).scrollIntoView?.({behavior:reducedMotion()?'auto':'smooth',block:'start'});};
  }
  const countAttrs=(v,dec,unit,plus)=>`data-count="${v}" data-dec="${dec}" data-unit="${escape(unit)}" data-plus="${plus?1:0}"`;

  // ── Gráficos ───────────────────────────────────────────────────────────────
  // Punto + intervalo de confianza por grupo. Azul = significativo; gris = no significativo.
  function forestChart(rows){
    const ends=rows.flatMap(r=>[r.ic_inf,r.ic_sup,0]);
    const lo=Math.floor(Math.min(...ends))-1,hi=Math.ceil(Math.max(...ends))+1,x=scale(lo,hi,230,470),h=36+rows.length*62;
    let svg=svgOpen(650,h,'Efecto por grupo de municipios con su margen de error');
    for(const t of niceTicks(lo,hi,5))svg+=`<line x1="${x(t)}" y1="14" x2="${x(t)}" y2="${h-22}" stroke="${COLOR.grid}"/><text x="${x(t)}" y="${h-6}" text-anchor="middle" class="axis-label">${signed(t,0)} %</text>`;
    svg+=`<line x1="${x(0)}" y1="10" x2="${x(0)}" y2="${h-22}" stroke="#8b98a3" stroke-dasharray="4 4"/>`;
    rows.forEach((r,i)=>{
      const y=40+i*62,c=tone(r.efecto_pct,r.p_valor),strong=clear(r.p_valor);
      svg+=`<text x="10" y="${y-4}" class="chart-label" font-weight="650">${escape(r.label)}</text><text x="10" y="${y+13}" class="axis-label">${escape(r.sub||'')}</text>`;
      svg+=`<line class="an an-gx" style="--d:${i*120}ms" x1="${x(r.ic_inf)}" y1="${y}" x2="${x(r.ic_sup)}" y2="${y}" stroke="${c}" stroke-opacity=".38" stroke-width="10" stroke-linecap="round"/>`;
      svg+=`<circle class="an an-pop" style="--d:${i*120+250}ms" cx="${x(r.efecto_pct)}" cy="${y}" r="8" fill="${c}" stroke="#1d2d3c" stroke-width="2"><title>${escape(r.label)}: ${signed(r.efecto_pct)} % (margen ${signed(r.ic_inf)} a ${signed(r.ic_sup)} %) · ${escape(pText(r.p_valor))}</title></circle>`;
      svg+=`<g class="an an-fade" style="--d:${i*120+400}ms"><text x="488" y="${y-2}" class="chart-value" style="fill:${c}">${signed(r.efecto_pct)} %</text><text x="488" y="${y+14}" class="axis-label">${strong?(r.p_valor<0.001?'p < 0,001':'p = '+number(r.p_valor,3)):'n.s. (p = '+number(r.p_valor,2)+')'}</text></g>`;
    });
    return svg+'</svg>';
  }

  // Día normal frente a día de caos, en número de viajes.
  function lossChart(rows){
    const max=Math.max(...rows.map(r=>r.perdidos.viajes_dia_normal))*1.12,y=scale(0,max,226,30),w=560/rows.length;
    let svg=svgOpen(650,290,'Viajes a Barcelona de los municipios dependientes en un día normal y en el día de caos');
    for(const t of niceTicks(0,max,4))svg+=`<line x1="70" y1="${y(t)}" x2="640" y2="${y(t)}" stroke="${COLOR.grid}"/><text x="62" y="${y(t)+4}" text-anchor="end" class="axis-label">${thousands(t)}</text>`;
    rows.forEach((r,i)=>{
      const p=r.perdidos,x0=80+i*w,bw=Math.min(46,w/3),caos=p.viajes_dia_normal-p.viajes_perdidos,c=tone(p.efecto_pct,p.p_valor);
      svg+=`<g class="res-click" data-date="${escape(r.fecha)}" tabindex="0" role="button" aria-label="Abrir la incidencia del ${escape(dateLabel(r.fecha))}">`;
      svg+=`<rect x="${x0}" y="20" width="${w-14}" height="250" fill="transparent"/>`;
      svg+=`<rect class="an an-gy" style="--d:${i*110}ms" x="${x0+w/2-bw-3}" y="${y(p.viajes_dia_normal)}" width="${bw}" height="${226-y(p.viajes_dia_normal)}" rx="3" fill="${COLOR.normal}"><title>Día normal: ${thousands(p.viajes_dia_normal)} viajes</title></rect>`;
      svg+=`<rect class="an an-gy" style="--d:${i*110+120}ms" x="${x0+w/2+3}" y="${y(caos)}" width="${bw}" height="${226-y(caos)}" rx="3" fill="${c}"><title>Día de caos: ${thousands(caos)} viajes</title></rect>`;
      svg+=`<g class="an an-fade" style="--d:${i*110+450}ms"><text x="${x0+w/2}" y="${y(p.viajes_dia_normal)-24}" text-anchor="middle" class="chart-value" style="fill:${c}">${p.viajes_perdidos>=0?'−':'+'}${thousands(Math.abs(p.viajes_perdidos))}</text>`;
      svg+=`<text x="${x0+w/2}" y="${y(p.viajes_dia_normal)-9}" text-anchor="middle" class="axis-label">viajes (${signed(p.efecto_pct)} %)</text></g>`;
      svg+=`<text x="${x0+w/2}" y="246" text-anchor="middle" class="chart-label" font-weight="650">${escape(shortDate(r.fecha))}</text><text x="${x0+w/2}" y="262" text-anchor="middle" class="axis-label">${escape(r.tipo||'')}</text></g>`;
    });
    svg+=`<rect x="80" y="276" width="11" height="11" rx="2" fill="${COLOR.normal}"/><text x="96" y="285" class="axis-label">Día normal</text><rect x="180" y="276" width="11" height="11" rx="2" fill="${COLOR.down}"/><text x="196" y="285" class="axis-label">Día de caos</text>`;
    return svg+'</svg>';
  }

  // Matriz línea × día (municipios dependientes de cada línea).
  function lineMatrix(rows){
    const order=['R1','R2N','R2N+R3','R2S','R3','R4','R7'];
    const lines=order.filter(l=>rows.some(r=>r.lineas_dependientes.some(x=>x.linea===l)));
    const left=170,cw=(640-left)/lines.length,rh=54,h=58+rows.length*rh;
    let svg=svgOpen(650,h,'Efecto por línea y día de caos en los municipios dependientes');
    lines.forEach((l,j)=>{const [code,...rest]=(LINE_NAMES[l]||l).split(' · ');svg+=`<text x="${left+j*cw+cw/2}" y="20" text-anchor="middle" class="chart-label" font-weight="700">${escape(code)}</text><text x="${left+j*cw+cw/2}" y="36" text-anchor="middle" class="axis-label">${escape(rest.join(' · '))}</text>`;});
    rows.forEach((r,i)=>{
      const y=46+i*rh;
      svg+=`<g class="res-click" data-date="${escape(r.fecha)}" tabindex="0" role="button" aria-label="Abrir la incidencia del ${escape(dateLabel(r.fecha))}">`;
      svg+=`<rect x="0" y="${y}" width="650" height="${rh-4}" fill="transparent"/>`;
      svg+=`<text x="8" y="${y+22}" class="chart-label" font-weight="650">${escape(shortDate(r.fecha))}</text><text x="8" y="${y+38}" class="axis-label">${escape(r.titulo)}</text>`;
      lines.forEach((l,j)=>{
        const c=r.lineas_dependientes.find(x=>x.linea===l),x=left+j*cw;
        if(!c){svg+=`<rect x="${x+3}" y="${y}" width="${cw-6}" height="${rh-8}" rx="6" fill="#1a2733"/><text x="${x+cw/2}" y="${y+rh/2}" text-anchor="middle" class="axis-label">—</text>`;return;}
        const strong=clear(c.p_valor);
        svg+=`<rect class="an an-pop" style="--d:${(i+j)*55}ms" x="${x+3}" y="${y}" width="${cw-6}" height="${rh-8}" rx="6" fill="${heatColor(c.efecto_pct)}" ${strong?'stroke="#ffffff" stroke-opacity=".7" stroke-width="1.5"':''}><title>${escape(LINE_NAMES[l]||l)}, ${escape(dateLabel(r.fecha))}: ${signed(c.efecto_pct)} % (${escape(pText(c.p_valor))}), ${c.municipios} municipios dependientes, ≈ ${thousands(Math.abs(c.viajes_perdidos))} viajes ${c.viajes_perdidos>=0?'menos':'más'}</title></rect>`;
        svg+=`<text class="an an-fade" style="--d:${(i+j)*55+200}ms;fill:${strong?'#ffffff':'#a8b9c7'};font:${strong?'750 15px':'500 12px'} system-ui" x="${x+cw/2}" y="${y+rh/2+1}" text-anchor="middle">${signed(c.efecto_pct,0)} %</text>`;
      });
      svg+='</g>';
    });
    return svg+'</svg>';
  }

  // Histograma de los días falsos con el efecto real.
  function placeboChart(p){
    const vals=p.valores_pct,lo=Math.floor(Math.min(...vals,p.real_pct))-1,hi=Math.ceil(Math.max(...vals,0))+1,bins=30,step=(hi-lo)/bins;
    const counts=Array(bins).fill(0);vals.forEach(v=>counts[Math.min(bins-1,Math.floor((v-lo)/step))]++);
    const x=scale(lo,hi,40,630),y=scale(0,Math.max(...counts)*1.25,210,20);
    let svg=svgOpen(650,250,'Distribución del efecto en días normales elegidos al azar y efecto real');
    for(const t of niceTicks(lo,hi,6))svg+=`<text x="${x(t)}" y="232" text-anchor="middle" class="axis-label">${signed(t,0)} %</text>`;
    counts.forEach((c,i)=>{if(c)svg+=`<rect class="an an-gy" style="--d:${i*25}ms" x="${x(lo+i*step)+1}" y="${y(c)}" width="${Math.max(1,x(lo+step)-x(lo)-2)}" height="${210-y(c)}" rx="2" fill="${COLOR.normal}"><title>${c} pruebas entre ${signed(lo+i*step)} y ${signed(lo+(i+1)*step)} %</title></rect>`;});
    svg+=`<line x1="40" y1="210" x2="630" y2="210" stroke="${COLOR.grid}"/>`;
    svg+=`<line class="an an-draw" style="--d:900ms" pathLength="1" x1="${x(p.real_pct)}" y1="210" x2="${x(p.real_pct)}" y2="30" stroke="${COLOR.down}" stroke-width="3"/>`;
    svg+=`<g class="an an-fade" style="--d:1300ms"><text x="${x(p.real_pct)+8}" y="44" class="chart-value" style="fill:${COLOR.down}">Efecto observado</text><text x="${x(p.real_pct)+8}" y="62" class="chart-value" style="fill:${COLOR.down}">${signed(p.real_pct)} %</text></g>`;
    svg+=`<text x="${x(0)}" y="${y(Math.max(...counts))-10}" text-anchor="middle" class="axis-label">Placebos (n = ${vals.length})</text>`;
    return svg+'</svg>';
  }

  function eventChart(rows,label='Día 0'){
    const values=rows.flatMap(r=>[r.ic_inf,r.ic_sup,0]);
    const lower=Math.floor(Math.min(...values)/2)*2-1,upper=Math.ceil(Math.max(...values)/2)*2+1;
    const x=d=>70+(d-rows[0].dia)/(rows.at(-1).dia-rows[0].dia||1)*540,y=v=>20+(upper-v)/(upper-lower)*190;
    let svg=svgOpen(650,250,'Efecto por día relativo al caos con su margen de error');
    for(const t of niceTicks(lower,upper,5))svg+=`<line x1="60" y1="${y(t)}" x2="620" y2="${y(t)}" stroke="${COLOR.grid}"/><text x="52" y="${y(t)+4}" text-anchor="end" class="axis-label">${signed(t,0)} %</text>`;
    svg+=`<rect x="${x(-5)-14}" y="16" width="${x(-1)-x(-5)+28}" height="196" rx="6" fill="#ffffff" fill-opacity=".03"/><rect x="${x(1)-14}" y="16" width="${x(rows.at(-1).dia)-x(1)+28}" height="196" rx="6" fill="#ffffff" fill-opacity=".03"/>`;
    svg+=`<line x1="60" y1="${y(0)}" x2="620" y2="${y(0)}" stroke="#8b98a3" stroke-dasharray="4 4"/>`;
    for(const r of rows){
      const day=r.dia===0,fill=day?'#ffac55':'#9dbedb',k=r.dia-rows[0].dia;
      svg+=`<line class="an an-gy-c" style="--d:${k*70}ms" x1="${x(r.dia)}" y1="${y(r.ic_inf)}" x2="${x(r.dia)}" y2="${y(r.ic_sup)}" stroke="${fill}" stroke-opacity="${day?1:.55}" stroke-width="5" stroke-linecap="round"/>`;
      svg+=`<circle class="an an-pop" style="--d:${k*70+200}ms" cx="${x(r.dia)}" cy="${y(r.efecto_pct)}" r="${day?8:5.5}" fill="${fill}" stroke="#1d2d3c" stroke-width="2"><title>Día ${signed(r.dia,0)}: ${signed(r.efecto_pct)} % (margen ${signed(r.ic_inf)} a ${signed(r.ic_sup)} %)</title></circle>`;
      svg+=`<text x="${x(r.dia)}" y="236" text-anchor="middle" class="${day?'chart-value':'axis-label'}">${day?label:signed(r.dia,0)}</text>`;
      if(day)svg+=`<g class="an an-fade" style="--d:900ms"><text x="${x(r.dia)+13}" y="${y(r.efecto_pct)+5}" class="chart-value" style="fill:#ffac55">${signed(r.efecto_pct)} %</text></g>`;
    }
    return svg+'</svg>';
  }

  function neighbourhoodChart(rows){
    if(!rows.length)return '<p class="empty-state">No hay resultados para este sentido.</p>';
    const values=rows.flatMap(r=>[r.con_estacion,r.sin_estacion,0]);
    const lower=Math.min(...values)-4,upper=Math.max(...values)+4,x=v=>220+(v-lower)/(upper-lower)*380;
    let svg=svgOpen(650,44+rows.length*72,'Variación de viajes hacia barrios con y sin estación');
    svg+=`<line x1="${x(0)}" y1="10" x2="${x(0)}" y2="${18+rows.length*72}" stroke="#8b98a3" stroke-dasharray="4 4"/>`;
    rows.forEach((r,i)=>{
      const top=20+i*72;
      svg+=`<text x="10" y="${top+14}" class="chart-label">${escape(r.caso)}</text><text x="10" y="${top+32}" class="axis-label">Diferencia: ${escape(pText(r.p_diferencia))}</text>`;
      [['con_estacion','Con estación','#ffac55',0],['sin_estacion','Sin estación','#8eacc8',24]].forEach(([key,label,fill,offset])=>{
        const v=r[key],a=Math.min(x(0),x(v)),w=Math.max(2,Math.abs(x(v)-x(0)));
        svg+=`<rect class="an ${v<0?'an-gx-r':'an-gx-l'}" style="--d:${i*150+offset*6}ms" x="${a}" y="${top+offset}" width="${w}" height="18" rx="3" fill="${fill}"><title>${label}: ${signed(v)} %</title></rect>`;
        svg+=`<g class="an an-fade" style="--d:${i*150+offset*6+450}ms"><text x="${v<0?a-6:a+w+6}" y="${top+offset+13}" text-anchor="${v<0?'end':'start'}" class="chart-value">${signed(v)} %</text></g>`;
      });
    });
    const legendY=26+rows.length*72;
    svg+=`<rect x="220" y="${legendY}" width="12" height="12" rx="2" fill="#ffac55"/><text x="238" y="${legendY+10}" class="axis-label">Barrios con estación de Rodalies</text><rect x="420" y="${legendY}" width="12" height="12" rx="2" fill="#8eacc8"/><text x="438" y="${legendY+10}" class="axis-label">Barrios sin estación</text>`;
    return svg+'</svg>';
  }

  // Serie: dependientes vs control alrededor del día (100 = día normal).
  function seriesChart(c){
    const s=c.serie,vals=s.flatMap(p=>[p.dependientes,p.control]).concat([c.banda_normal.inf,c.banda_normal.sup,100]);
    const lo=Math.floor(Math.min(...vals))-2,hi=Math.ceil(Math.max(...vals))+2,x=scale(0,s.length-1,58,630),y=scale(lo,hi,214,26);
    const weekdays=['dom','lun','mar','mié','jue','vie','sáb'];
    let svg=svgOpen(650,262,'Viajes de los municipios dependientes y del control alrededor del día de caos');
    for(const t of niceTicks(lo,hi,5))svg+=`<line x1="50" y1="${y(t)}" x2="640" y2="${y(t)}" stroke="${COLOR.grid}"/><text x="44" y="${y(t)+4}" text-anchor="end" class="axis-label">${number(t,0)}</text>`;
    svg+=`<rect x="50" y="${y(c.banda_normal.sup)}" width="590" height="${y(c.banda_normal.inf)-y(c.banda_normal.sup)}" fill="#ffffff" fill-opacity=".06"/>`;
    svg+=`<line x1="50" y1="${y(100)}" x2="640" y2="${y(100)}" stroke="#8b98a3" stroke-width="1"/>`;
    s.forEach((p,i)=>{if(p.caos)svg+=`<line x1="${x(i)}" y1="22" x2="${x(i)}" y2="214" stroke="${p.fecha===c.fecha?'#ffac55':'#ffac55'}" stroke-opacity="${p.fecha===c.fecha?.9:.35}" stroke-dasharray="4 4"/>`;});
    const path=k=>s.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    svg+=`<path class="an an-draw" style="--d:0ms" pathLength="1" d="${path('control')}" fill="none" stroke="${COLOR.muted}" stroke-width="1.8"/><path class="an an-draw" style="--d:250ms" pathLength="1" d="${path('dependientes')}" fill="none" stroke="${COLOR.down}" stroke-width="2.6"/>`;
    s.forEach((p,i)=>{
      for(const [k,col] of [['control',COLOR.muted],['dependientes',COLOR.down]])svg+=`<circle class="an an-pop" style="--d:${300+i*45}ms" cx="${x(i)}" cy="${y(p[k])}" r="${k==='dependientes'?4:3}" fill="${p.limpio?col:'#1d2d3c'}" stroke="${col}" stroke-width="1.5"><title>${escape(dateLabel(p.fecha))} · ${k==='control'?'Sin Rodalies':'Dependientes'}: ${number(p[k],1)}</title></circle>`;
      const d=new Date(p.fecha+'T12:00:00Z');
      if(i%2===0||p.fecha===c.fecha)svg+=`<text x="${x(i)}" y="232" text-anchor="middle" class="${p.fecha===c.fecha?'chart-value':'axis-label'}">${p.fecha===c.fecha?'Día de caos':weekdays[d.getUTCDay()]+' '+d.getUTCDate()}</text>`;
    });
    const day=s.findIndex(p=>p.fecha===c.fecha);
    if(day>=0){const p=s[day],right=day<s.length*0.7;
      svg+=`<g class="an an-fade" style="--d:1300ms"><text x="${x(day)+(right?12:-12)}" y="${y(p.dependientes)+4}" text-anchor="${right?'start':'end'}" class="chart-value" style="fill:${COLOR.down}">Dependientes ${signed(p.dependientes-100,0)} %</text></g>`;
      svg+=`<g class="an an-fade" style="--d:1400ms"><text x="${x(day)+(right?12:-12)}" y="${y(p.dependientes)+22}" text-anchor="${right?'start':'end'}" class="axis-label">Control ${signed(p.control-100,0)} %</text></g>`;}
    svg+=`<line x1="60" y1="252" x2="80" y2="252" stroke="${COLOR.down}" stroke-width="2.6"/><text x="86" y="256" class="axis-label">Dependientes de Rodalies</text><line x1="240" y1="252" x2="260" y2="252" stroke="${COLOR.muted}" stroke-width="1.8"/><text x="266" y="256" class="axis-label">Sin Rodalies (control)</text><rect x="420" y="246" width="20" height="11" fill="#ffffff" fill-opacity=".1"/><text x="446" y="256" class="axis-label">Variación normal</text>`;
    return svg+'</svg>';
  }

  // Volumen total por tramo: barra = cambio; franja = variación normal.
  function tramosChart(rows){
    if(!rows.length)return '<p class="empty-state">No hay tramos definidos para esta incidencia.</p>';
    const ends=rows.flatMap(r=>[r.cambio_pct,r.normal_inf,r.normal_sup,0]);
    const lo=Math.floor(Math.min(...ends))-1,hi=Math.ceil(Math.max(...ends))+1,x=scale(lo,hi,250,450),rh=46,h=30+rows.length*rh;
    let svg=svgOpen(650,h,'Cambio del volumen total de viajes a Barcelona por tramo de línea');
    for(const t of niceTicks(lo,hi,4))svg+=`<line x1="${x(t)}" y1="8" x2="${x(t)}" y2="${h-20}" stroke="${COLOR.grid}"/><text x="${x(t)}" y="${h-5}" text-anchor="middle" class="axis-label">${signed(t,0)} %</text>`;
    rows.forEach((r,i)=>{
      const y=14+i*rh,ref=!r.afectada,strong=clear(r.p_valor),c=ref?COLOR.ref:tone(r.cambio_pct,r.p_valor);
      const [name,...rest]=r.tramo.split(' · ');
      svg+=`<rect x="0" y="${y-4}" width="16" height="${rh-12}" rx="3" fill="${LINE_COLORS[r.linea]||LINE_COLORS[r.linea.split(' ')[0]]||'#657b8d'}"/>`;
      svg+=`<text x="24" y="${y+10}" class="chart-label" font-weight="650">${escape(name)}</text><text x="24" y="${y+26}" class="axis-label">${escape(rest.join(', '))}${rest.length?', ':''}${r.municipios} municipios</text>`;
      svg+=`<rect class="an an-fade" style="--d:${i*80}ms" x="${x(r.normal_inf)}" y="${y}" width="${x(r.normal_sup)-x(r.normal_inf)}" height="24" rx="4" fill="#ffffff" fill-opacity=".07"/>`;
      const a=Math.min(x(0),x(r.cambio_pct)),w=Math.max(2,Math.abs(x(r.cambio_pct)-x(0)));
      svg+=`<rect class="an ${r.cambio_pct<0?'an-gx-r':'an-gx-l'}" style="--d:${i*80+150}ms" x="${a}" y="${y+4}" width="${w}" height="16" rx="3" fill="${ref?'none':c}" stroke="${c}" stroke-width="${ref?2:0}" ${ref?'stroke-dasharray="4 3"':''}><title>${escape(r.tramo)}: ${signed(r.cambio_pct)} % · ${escape(pText(r.p_valor))}&#10;${escape(r.lista)}</title></rect>`;
      svg+=`<line x1="${x(0)}" y1="${y-2}" x2="${x(0)}" y2="${y+26}" stroke="#8b98a3"/>`;
      const lost=r.viajes_perdidos;
      svg+=`<g class="an an-fade" style="--d:${i*80+450}ms"><text x="468" y="${y+10}" class="chart-value" style="fill:${c}">${signed(r.cambio_pct)} %${ref?' (referencia)':strong?'':' (n.s.)'}</text><text x="468" y="${y+26}" class="axis-label">${lost>=0?'−':'+'}${thousands(Math.abs(lost))} de ${thousands(r.viajes_esperados)} viajes</text></g>`;
    });
    return svg+'</svg>';
  }

  // ── Página «Resultados» ───────────────────────────────────────────────────
  function renderWho(){
    if(!data)return;
    const rows=who==='grupos'
      ?data.grupos.map(g=>({...g,label:GROUPS[g.grupo]||g.etiqueta,sub:`${GROUP_NOTES[g.grupo]||''}, ${g.municipios} municipios`}))
      :data.distancia.map(g=>({...g,label:`A ${g.banda.replace('< ','menos de ').replace('> ','más de ')} de Barcelona`,sub:`Con Rodalies, sin metro/FGC, ${g.municipios} municipios`}));
    byId('res-who').innerHTML=forestChart(rows);
    byId('res-who-title').textContent=who==='grupos'?'Solo los municipios sin alternativa':'Cuanto más lejos, más impacto';
    byId('res-who-caption').textContent=who==='grupos'
      ?'Efecto medio de los cuatro días de caos sobre los viajes a Barcelona, por grupo de municipios (regresión DiD frente a los municipios sin Rodalies).'
      :'Municipios con Rodalies y sin metro/FGC, agrupados por distancia a Plaça Catalunya.';
    for(const b of document.querySelectorAll?.('[data-who]')||[])b.setAttribute('aria-pressed',String(b.dataset.who===who));
  }
  function renderEvent(){
    if(!data)return;const v=byId('res-event-case').value;
    const c=data.incidencias.find(i=>i.fecha===v);
    byId('concl-event').innerHTML=eventChart(c?c.evento:[...data.evento].sort((a,b)=>a.dia-b.dia),c?'Día 0':'Día 0');
  }
  function renderNeighbourhoods(){if(data)byId('concl-barrios').innerHTML=neighbourhoodChart(data.barrios.filter(r=>r.sentido===byId('concl-direction').value));}

  function render(){
    byId('conclusions-period').textContent=`${dateLabel(data.periodo.inicio)} — ${dateLabel(data.periodo.fin)}`;
    byId('res-answer').innerHTML=`<div><strong>${escape(data.respuesta?.titulo||'')}</strong><p>${escape(data.respuesta?.texto||'')}</p></div>`;
    byId('conclusions-kpis').innerHTML=data.kpis.map(k=>`<div class="general-kpi"><strong ${countAttrs(k.valor,k.decimales,k.unidad,k.valor<0)}>${k.valor<0?signed(k.valor,k.decimales):number(k.valor,k.decimales)}${escape(k.unidad)}</strong><span>${escape(k.etiqueta)}</span></div>`).join('');
    byId('conclusions-cards').innerHTML=data.conclusiones.map((q,i)=>`<article class="research-card"><span class="question-number">0${i+1}</span><p class="question-text">${escape(q.pregunta)}</p><h2>${escape(q.titulo)}</h2><p>${escape(q.texto)}</p></article>`).join('');
    renderWho();
    byId('res-loss').innerHTML=lossChart(data.incidencias);
    byId('res-lines').innerHTML=lineMatrix(data.incidencias);
    const real=data.placebo.real_pct,n=data.placebo.valores_pct.length,beyond=data.placebo.valores_pct.filter(v=>v<=real).length;
    byId('res-placebo-caption').textContent=`Repetimos la estimación con ${n} conjuntos de días normales elegidos al azar. ${beyond?`Solo ${beyond}`:'Ninguno'} alcanza el efecto observado (${signed(real)} %; p = ${number(data.placebo.p_valor,3)}).`;
    byId('res-placebo').innerHTML=placeboChart(data.placebo);
    byId('res-event-case').innerHTML='<option value="">Media de los 4 días</option>'+data.incidencias.map(c=>`<option value="${escape(c.fecha)}">${escape(shortDate(c.fecha))} · ${escape(c.titulo)}</option>`).join('');
    renderEvent();renderNeighbourhoods();
    const labels={comparacion:'Comparación',efecto:'Efecto',tramos:'Tramos',perdidos:'Viajes perdidos',placebo:'Prueba del día falso',barrios:'Barrios'};
    byId('concl-method').innerHTML=Object.entries(data.metodo||{}).map(([key,value])=>`<p><strong>${escape(labels[key]||key)}:</strong> ${escape(value)}</p>`).join('')+`<p><strong>Fuente:</strong> ${escape(data.fuente)}</p><ul>`+(data.limitaciones||[]).map(t=>`<li>${escape(t)}</li>`).join('')+'</ul>';
    byId('conclusions-content').hidden=false;byId('conclusions-status').textContent='';
    if(!byId('conclusions-view').hidden)animateResults();
  }
  let resultsAnimated=false;
  function animateResults(){if(resultsAnimated||!data)return;resultsAnimated=true;countUp(byId('conclusions-kpis'));reveal(byId('conclusions-content'));}

  // ── Ficha de incidencia ─────────────────────────────────────────────────
  const showAll=()=>Boolean(byId('inc-show-all').checked);
  let popMarkers=false;
  function visibleMunicipalities(){const group=byId('concl-group').value;return incident.municipios.filter(m=>(!group||m.grupo===group)&&(showAll()||clear(m.p_valor)));}
  function defaultMunicipality(){const rows=visibleMunicipalities();return [...rows].sort((a,b)=>(b.grupo==='dependientes')-(a.grupo==='dependientes')||a.efecto_pct-b.efecto_pct)[0]?.codigo??null;}
  function renderDetail(){
    const c=incident,m=c.municipios.find(x=>x.codigo===selected);
    const groups=c.grupos.map(g=>`<div><small>${escape(GROUPS[g.grupo]||g.grupo)}</small><strong class="${clear(g.p_valor)?(g.efecto_pct<0?'down':'up'):'neutral'}">${signed(g.efecto_pct)} %</strong><small>${escape(pText(g.p_valor))}${clear(g.p_valor)?'':' (n.s.)'}</small></div>`).join('');
    const head=m?`<div class="detail-title"><small>${escape(GROUPS[m.grupo])}, ${escape(m.lineas)}, ${number(m.dist_km,0)} km</small><h2>${escape(m.nombre)} → Barcelona</h2></div>
      <div class="main-value ${m.efecto_pct<0?'down':m.efecto_pct>0?'up':''}">${signed(m.efecto_pct)} %</div>
      <p class="delta-caption">Variación de los viajes a Barcelona respecto a lo esperado (${escape(pText(m.p_valor))}${clear(m.p_valor)?'':', no significativa'}).</p>
      <p class="absolute">${thousands(m.viajes_referencia)} viajes en un día habitual</p>`
      :'<div class="detail-title"><small>MUNICIPIO</small><h2>Selecciona un municipio en el mapa o en la lista</h2></div>';
    byId('concl-detail').innerHTML=head+`<div class="numbers concl-groups"><p class="delta-caption">Efecto por grupo frente al control</p>${groups}</div>`;
  }
  function renderRanking(){
    const rows=[...visibleMunicipalities()].sort((a,b)=>a.efecto_pct-b.efecto_pct).slice(0,15);
    const n=visibleMunicipalities().length,claros=incident.municipios.filter(m=>clear(m.p_valor)).length;
    byId('inc-map-count').textContent=showAll()?`${n} municipios con Rodalies; ${claros} con variación significativa (borde blanco).`:`${claros} de ${incident.municipios.length} municipios con Rodalies varían de forma significativa.`;
    byId('inc-rank-sub').textContent=showAll()?'Todos los municipios del grupo':'Significativas';
    byId('concl-ranking').innerHTML=rows.length?rows.map(m=>`<button type="button" class="top-item ${m.codigo===selected?'active':''}" data-code="${escape(m.codigo)}"><span>${escape(m.nombre)}<small class="rank-sub">${escape(m.lineas)} · ${number(m.dist_km,0)} km</small></span><b class="${m.efecto_pct<0?'down':m.efecto_pct>0?'up':'neutral'}">${signed(m.efecto_pct)} %${clear(m.p_valor)?'<small>p &lt; 0,05</small>':''}</b></button>`).join(''):(showAll()?'<p class="empty-state">No hay municipios en este grupo.</p>':'<p class="empty-state">Ningún municipio de este grupo es significativo este día.</p>');
  }
  function drawMap(){
    if(!map||!incident)return;
    markers.clearLayers();
    const rows=visibleMunicipalities(),maxTrips=Math.max(...incident.municipios.map(m=>m.viajes_referencia),1);
    // Etiquetas fijas sin solapes: por orden de importancia, cada una prueba varias posiciones y solo
    // se coloca donde no pisa a otra (al hacer zoom se recalcula). El resto se ve al pasar el ratón.
    const labels=new Map(),boxes=[];
    if(fitted){
      const cand=[...rows].filter(m=>clear(m.p_valor)||m.codigo===selected).sort((a,b)=>(b.codigo===selected)-(a.codigo===selected)||Math.abs(b.efecto_pct)-Math.abs(a.efecto_pct)).slice(0,14);
      const size=map.getSize(),bcn=map.latLngToContainerPoint(BCN);
      boxes.push([bcn.x-40,bcn.y-8,bcn.x+40,bcn.y+30]);
      for(const m of cand){
        const p=map.latLngToContainerPoint([m.lat,m.lon]),w=m.nombre.length*6.3+46,h=19;
        for(const [side,dy] of [['right',0],['left',0],['right',-15],['left',-15],['right',15],['left',15]]){
          const x0=side==='right'?p.x+9:p.x-9-w,y0=p.y+dy-h/2,box=[x0,y0,x0+w,y0+h];
          if(box[0]<4||box[2]>size.x-4||box[1]<4||box[3]>size.y-20)continue;
          if(boxes.some(o=>box[0]<o[2]&&box[2]>o[0]&&box[1]<o[3]&&box[3]>o[1]))continue;
          boxes.push(box);labels.set(m.codigo,{side,dy});break;
        }
      }
    }
    for(const m of [...rows].sort((a,b)=>b.viajes_referencia-a.viajes_referencia)){
      const significant=clear(m.p_valor),active=m.codigo===selected;
      const marker=L.circleMarker([m.lat,m.lon],{radius:(significant?4:2.5)+(significant?11:6)*Math.sqrt(m.viajes_referencia/maxTrips),fillColor:color(m.efecto_pct),fillOpacity:significant?.92:.35,
        color:active?'#ffc477':significant?'#ffffff':'#14212c',weight:active?3.5:significant?1.6:.6,pane:'concl-points',className:`${significant?'sig-marker':''}${popMarkers?' mk-pop':''}`})
        .on('click',()=>choose(m.codigo,true)).addTo(markers);
      const label=labels.get(m.codigo);
      if(label)marker.bindTooltip(`${escape(m.nombre)} <b class="${m.efecto_pct<0?'down':'up'}">${signed(m.efecto_pct,0)} %</b>`,{permanent:true,direction:label.side,offset:[label.side==='right'?8:-8,label.dy],className:`sig-label${active?' active':''}`});
      else marker.bindTooltip(`<strong>${escape(m.nombre)}</strong><br>${signed(m.efecto_pct)} % (${escape(pText(m.p_valor))})`,{direction:'top'});
      if(active)L.circleMarker([m.lat,m.lon],{radius:22,fill:false,color:'#ffc477',weight:2,pane:'concl-points',className:'pulse-ring',interactive:false}).addTo(markers);
    }
    popMarkers=false;
    if(!fitted&&rows.length){popMarkers=true;map.fitBounds([...rows.map(m=>[m.lat,m.lon]),BCN],{paddingTopLeft:[110,50],paddingBottomRight:[120,40],maxZoom:11,animate:false});fitted=true;drawMap();}
  }
  function updateMunicipalities(){if(!incident)return;renderDetail();renderRanking();drawMap();}
  function choose(code,fromMap=false){
    selected=code;updateMunicipalities();
    const m=incident?.municipios.find(x=>x.codigo===code);
    if(m&&map&&!fromMap&&!map.getBounds().pad(-0.1).contains([m.lat,m.lon]))map.panTo([m.lat,m.lon],{animate:!reducedMotion()});
  }

  // Líneas con incidencia ese día en color; las que funcionaban, en gris (siguen visibles como referencia).
  const BCN=[41.3874,2.1686],RING_KM=20;
  let railFeatures=[],railLayer=null,contextLayer=null;
  function affectedIds(){
    const ids=new Set();
    for(const name of incident?.lineas||[]){
      const n=String(name).replace(/\s+/g,' ').trim();
      if(n==='R2 Nord'){ids.add('R2N');ids.add('R2');}else if(n==='R2 Sud'){ids.add('R2S');ids.add('R2');}
      else if(n==='R2'){ids.add('R2');ids.add('R2N');ids.add('R2S');}else ids.add(n);
    }
    return ids;
  }
  function styleRail(){
    if(!map||!railLayer)return;
    railLayer.clearLayers();
    const hit=affectedIds(),off=railFeatures.filter(f=>!hit.has(f.properties.id)),on=railFeatures.filter(f=>hit.has(f.properties.id));
    if(off.length)L.geoJSON({type:'FeatureCollection',features:off},{pane:'concl-rail',interactive:false,style:{color:'#6f8396',weight:2,opacity:.35,dashArray:'4 5'}}).addTo(railLayer);
    if(on.length)L.geoJSON({type:'FeatureCollection',features:on},{pane:'concl-rail',interactive:false,style:f=>({color:f.properties.color,weight:3.5,opacity:.85})}).addTo(railLayer);
    const names=[...new Set(on.map(f=>f.properties.name))],free=[...new Set(off.map(f=>f.properties.name))].filter(n=>!names.includes(n));
    byId('inc-lines-note').textContent=names.length?`En color, líneas con incidencia (${names.join(', ')})${free.length?`; en gris discontinuo, las que funcionaban (${free.join(', ')})`:''}.`:'';
  }
  async function addRailway(){
    try{
      const response=await fetch('railway-network.geojson');if(!response.ok)throw Error(`HTTP ${response.status}`);
      const network=await response.json();
      railFeatures=network.features.filter(f=>f.properties?.kind==='line');styleRail();
    }catch(error){/* La red es contexto visual: sin ella el mapa sigue siendo válido. */}
  }
  function addContext(){
    contextLayer=L.layerGroup().addTo(map);
    L.circle(BCN,{radius:RING_KM*1000,pane:'concl-rail',interactive:false,fill:true,fillColor:'#ffffff',fillOpacity:.03,color:'#c9d6e1',weight:1.3,opacity:.6,dashArray:'6 6'}).addTo(contextLayer);
    // Rótulo corto en el borde inferior del anillo (zona de mar en casi todos los encuadres).
    L.circleMarker([BCN[0]-RING_KM/111,BCN[1]],{radius:0,opacity:0,fillOpacity:0,interactive:false,pane:'concl-rail'})
      .bindTooltip(`${RING_KM} km`,{permanent:true,direction:'bottom',className:'ring-label'}).addTo(contextLayer);
    L.circleMarker(BCN,{radius:6,color:'#13212c',weight:2,fillColor:'#ffffff',fillOpacity:1,pane:'concl-points',interactive:false})
      .bindTooltip('Barcelona',{permanent:true,direction:'bottom',offset:[0,4],className:'bcn-label'}).addTo(contextLayer);
  }
  function initMap(){
    if(map)return true;
    if(!window.L){byId('concl-map').innerHTML='<p class="empty-state">Mapa no disponible: Leaflet no se ha cargado. Comprueba la conexión a Internet.</p>';return false;}
    map=L.map('concl-map',{scrollWheelZoom:false,zoomSnap:.25});
    map.createPane('concl-rail').style.zIndex=350;map.createPane('concl-points').style.zIndex=450;
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'});
    tiles.on('tileerror',()=>{if(map.hasLayer(tiles))map.removeLayer(tiles);});tiles.addTo(map);
    railLayer=L.layerGroup().addTo(map);addContext();
    markers=L.layerGroup().addTo(map);void addRailway();
    map.on('zoomend',()=>{if(fitted)drawMap();});
    return true;
  }

  function renderIncident(date){
    const list=[...data.incidencias].sort((a,b)=>a.fecha.localeCompare(b.fecha));
    const c=list.find(i=>i.fecha===date)||list.at(-1);incident=c;
    const d=new Date(c.fecha+'T12:00:00Z');
    byId('inc-date').innerHTML=`<strong>${escape(d.toLocaleDateString('es-ES',{day:'2-digit',timeZone:'UTC'}))}</strong><span>${escape(d.toLocaleDateString('es-ES',{month:'short',timeZone:'UTC'}).replace('.',''))}</span><small>${d.getUTCFullYear()}</small>`;
    byId('inc-type').textContent=(c.tipo||'Incidencia').toUpperCase();
    byId('inc-title').textContent=c.titulo;byId('inc-description').textContent=c.descripcion||'';
    byId('inc-lines').innerHTML=(c.lineas||[]).map(l=>`<span class="board-line" style="--line-color:${LINE_COLORS[l]||'#657b8d'}">${escape(l)}</span>`).join('');
    byId('inc-tramo').textContent=c.tramo?`Tramo: ${c.tramo}`:'';
    byId('inc-reading').textContent=c.lectura||'';
    const g=Object.fromEntries(c.grupos.map(x=>[x.grupo,x])),p=c.perdidos;
    const kpi=(v,label,sub,cls,attrs='')=>`<div class="general-kpi inc-kpi"><strong class="${cls}" ${attrs}>${v}</strong><span>${escape(label)}<small>${escape(sub)}</small></span></div>`;
    const cls=x=>!x?'':clear(x.p_valor)?(x.efecto_pct<0?'down':'up'):'neutral';
    const sub=x=>x?`${pText(x.p_valor)}${clear(x.p_valor)?'':' (n.s.)'}`:'';
    byId('inc-kpis').innerHTML=[
      kpi(`${signed(g.dependientes?.efecto_pct)} %`,'Dependientes de Rodalies',sub(g.dependientes),cls(g.dependientes),countAttrs(g.dependientes?.efecto_pct,1,' %',true)),
      kpi(`${p.viajes_perdidos>=0?'−':'+'}${thousands(Math.abs(p.viajes_perdidos))}`,'Viajes perdidos',`de ${thousands(p.viajes_dia_normal)} en un día normal`,cls(g.dependientes),countAttrs(-p.viajes_perdidos,0,'',true)),
      kpi(`${signed(g.cercanos?.efecto_pct)} %`,'Cercanos sin metro/FGC',sub(g.cercanos),cls(g.cercanos),countAttrs(g.cercanos?.efecto_pct,1,' %',true)),
      kpi(`${signed(g.metro_fgc?.efecto_pct)} %`,'Con metro/FGC',sub(g.metro_fgc),cls(g.metro_fgc),countAttrs(g.metro_fgc?.efecto_pct,1,' %',true)),
    ].join('');
    byId('inc-series').innerHTML=seriesChart(c);
    byId('inc-event').innerHTML=eventChart(c.evento);
    byId('inc-tramos').innerHTML=tramosChart(c.tramos);
    byId('inc-tramos-legend').innerHTML=`<span><i style="background:${COLOR.down}"></i>Caída significativa</span><span><i style="background:${COLOR.weak}"></i>No significativa</span><span><i class="ref"></i>Línea sin incidencia (referencia)</span><span><i class="band"></i>Variación habitual</span>`;
    const i=list.indexOf(c);byId('inc-prev').disabled=i===0;byId('inc-next').disabled=i===list.length-1;
    byId('inc-prev').dataset.date=list[i-1]?.fecha||'';byId('inc-next').dataset.date=list[i+1]?.fecha||'';
    byId('concl-open-case').hidden=!(c.caso_od&&typeof CASES!=='undefined'&&Object.hasOwn(CASES,c.fecha));
    byId('concl-group').value='';fitted=false;styleRail();
    selected=defaultMunicipality();
    byId('inc-content').hidden=false;byId('inc-status').textContent='';
    if(!byId('incident-view').hidden&&initMap())map.invalidateSize();
    updateMunicipalities();
    countUp(byId('inc-kpis'));reveal(byId('inc-content'));
    const content=byId('inc-content');if(content.classList&&!reducedMotion()){content.classList.remove('swap');void content.offsetWidth;content.classList.add('swap');}
    return c.fecha;
  }
  async function showIncident(date){
    byId('inc-status').textContent='Cargando la incidencia…';
    try{await readyPromise;}catch(e){byId('inc-content').hidden=true;byId('inc-status').textContent=`No se pudo cargar la incidencia (${e.message}).`;return null;}
    return renderIncident(date);
  }

  // Leaflet necesita el contenedor visible para medirlo.
  function show(){animateResults();}

  // Carga (o recarga) el JSON; `ready` da siempre la promesa de la última carga.
  function loadConclusions(){
    const id=++sequence;
    readyPromise=(async()=>{
      const response=await fetch(CONCLUSIONS_DATA);if(!response.ok)throw Error(`HTTP ${response.status}`);
      const json=await response.json();
      if(!valid(json))throw Error('Esquema de resultados incompatible');
      if(id===sequence){data=json;render();}
      return json;
    })();
    return readyPromise.catch(error=>{if(id===sequence){byId('conclusions-content').hidden=true;byId('conclusions-status').textContent=`No se pudieron cargar los resultados (${error.message}). Ejecuta la celda de exportación del notebook 04 y sirve el proyecto mediante HTTP.`;}});
  }

  const openDate=e=>{const g=e.target.closest?.('[data-date]');if(g&&g.dataset.date)window.RMoveOverview?.showView('incident',g.dataset.date);};
  const keyOpen=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDate(e);}};
  byId('res-loss').onclick=openDate;byId('res-lines').onclick=openDate;byId('res-loss').onkeydown=keyOpen;byId('res-lines').onkeydown=keyOpen;
  byId('inc-prev').onclick=openDate;byId('inc-next').onclick=openDate;
  byId('inc-back').onclick=()=>window.RMoveOverview?.showView('board');
  const whoGroup=byId('res-who').parentElement?.querySelector?.('.res-toggle');
  if(whoGroup)whoGroup.onclick=e=>{const b=e.target.closest('[data-who]');if(b){who=b.dataset.who;renderWho();}};
  byId('res-event-case').onchange=renderEvent;
  document.addEventListener?.('keydown',e=>{
    if(byId('incident-view').hidden||!incident||e.altKey||e.ctrlKey||e.metaKey||/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName||''))return;
    if(e.key==='ArrowLeft'&&!byId('inc-prev').disabled){e.preventDefault();window.RMoveOverview?.showView('incident',byId('inc-prev').dataset.date);}
    else if(e.key==='ArrowRight'&&!byId('inc-next').disabled){e.preventDefault();window.RMoveOverview?.showView('incident',byId('inc-next').dataset.date);}
    else if(e.key==='Escape'){window.RMoveOverview?.showView('board');}
  });
  watchIndex();
  const refilter=()=>{if(!incident)return;if(!visibleMunicipalities().some(m=>m.codigo===selected))selected=defaultMunicipality();fitted=false;updateMunicipalities();};
  byId('concl-group').onchange=refilter;byId('inc-show-all').onchange=refilter;
  byId('concl-ranking').onclick=e=>{const button=e.target.closest('[data-code]');if(button)choose(button.dataset.code);};
  byId('concl-direction').onchange=renderNeighbourhoods;
  byId('concl-open-case').onclick=()=>{if(incident)window.RMoveOverview?.showView('cases',incident.fecha);};
  window.RMoveConclusions={show,loadConclusions,showIncident,get ready(){return readyPromise;},get data(){return data;}};
  void loadConclusions();
})();
