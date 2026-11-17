/* Observatorio R-MOVE · dashboard v2
 * Cuatro modos: relato (scrollytelling), simulador «¿Y si…?», Mi municipio y laboratorio.
 * Solo lee data/processed/rmove/observatorio/observatorio.json (generado por build_observatorio.py)
 * y la cartografía del dashboard clásico. No recalcula modelos: consulta coeficientes ya estimados.
 */
(function () {
  'use strict';

  const DATA_URL = '../../data/processed/rmove/observatorio/observatorio.json';
  const RAIL_URL = '../dashboard/railway-network.geojson';
  const BCN = [41.3870, 2.1700];
  const BOUNDS = [[41.17, 1.62], [42.05, 2.82]];
  const FECHAS = { averia: '2024-05-13', huelga: '2025-03-17', anunciadas: ['2025-03-26', '2025-04-01'] };
  const GRUPO = { dependientes: 'Dependiente', cercanos: 'Cercano sin metro/FGC', metro_fgc: 'Con metro/FGC' };
  const ALT_NOMBRE = { bus_interurbano: 'bus interurbano', fgc: 'FGC', amb: 'bus AMB' };
  const LINEAS_SIM = ['R1', 'R2N', 'R2S', 'R3', 'R4', 'R7'];

  let D = null, RAIL = null;
  const maps = {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ formato
  const nf = (x, d = 0) => x == null || isNaN(x) ? '—' : Number(x).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' }).replace('-', '−');
  const pct = (x, d = 1) => { if (x == null) return '—'; const r = Number(x.toFixed(d)); return r === 0 ? '≈ 0 %' : (r > 0 ? '+' : '') + nf(r, d) + ' %'; };
  const pval = (p) => p == null ? '' : p < 0.001 ? 'p < 0,001' : 'p = ' + nf(p, 3);
  const fecha = (f) => { const [y, m, d] = f.split('-'); return `${d}/${m}/${y}`; };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ------------------------------------------------------------------ tooltip (delegado: cualquier elemento con data-tip)
  const tip = $('tooltip');
  document.addEventListener('mousemove', (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = t.getAttribute('data-tip');
    tip.hidden = false;
    const w = tip.offsetWidth, x = ev.clientX + 14;
    tip.style.left = (x + w > innerWidth ? ev.clientX - w - 14 : x) + 'px';
    tip.style.top = (ev.clientY + 14) + 'px';
  });

  // ------------------------------------------------------------------ gráficos SVG
  /* Barras horizontales desde 0 con intervalo opcional. rows: {label, efecto, ic_inf, ic_sup, p, tip, color} */
  function forest(el, rows, o = {}) {
    const W = ancho(el), L = o.labelW ?? 170, R = 64, rowH = 30, top = 8, H = top + rows.length * rowH + 24;
    const vals = rows.flatMap((r) => [r.efecto, r.ic_inf, r.ic_sup]).filter((v) => v != null);
    const lo = Math.min(o.min ?? -10, ...vals), hi = Math.max(o.max ?? 5, ...vals);
    const x = (v) => L + (v - lo) / (hi - lo) * (W - L - R);
    const ticks = niceTicks(lo, hi, 5);
    let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Efectos')}">`;
    ticks.forEach((t) => { s += `<line class="${t === 0 ? 'zero' : 'grid'}" x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - 20}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${nf(t)} %</text>`; });
    rows.forEach((r, i) => {
      const y = top + i * rowH + rowH / 2, e = r.efecto ?? 0, sig = r.p == null || r.p < 0.05;
      const col = r.color || colClase(claseDe(e) === 3 ? (e < 0 ? 2 : 4) : claseDe(e));
      const x0 = Math.min(x(0), x(e)), w = Math.max(Math.abs(x(e) - x(0)), 1.5);
      s += `<text class="lbl" x="${L - 10}" y="${y + 4}" text-anchor="end">${esc(r.label)}</text>`;
      s += `<rect x="${x0}" y="${y - 7}" width="${w}" height="14" rx="4" fill="${col}" opacity="${sig ? 1 : 0.45}"/>`;
      if (r.ic_inf != null) s += `<line class="ci" x1="${x(r.ic_inf)}" x2="${x(r.ic_sup)}" y1="${y}" y2="${y}"/><line class="ci" x1="${x(r.ic_inf)}" x2="${x(r.ic_inf)}" y1="${y - 5}" y2="${y + 5}"/><line class="ci" x1="${x(r.ic_sup)}" x2="${x(r.ic_sup)}" y1="${y - 5}" y2="${y + 5}"/>`;
      const vx = Math.max(x(e), r.ic_sup != null ? x(r.ic_sup) : 0, x(0)) + 6;
      s += `<text class="val" x="${vx}" y="${y + 4}">${pct(e)}${sig ? '' : ' ·ns'}</text>`;
      const t = r.tip || `<b>${esc(r.label)}</b><br>${pct(e)}${r.ic_inf != null ? ` [${pct(r.ic_inf)}, ${pct(r.ic_sup)}]` : ''}${r.p != null ? '<br>' + pval(r.p) : ''}`;
      s += `<rect class="hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" data-tip="${esc(t)}"/>`;
    });
    el.innerHTML = s + '</svg>' + (o.nota ? `<p class="muted" style="font-size:12px;margin:4px 0 0">${o.nota}</p>` : '');
  }

  /* Líneas sobre eje x categórico. series: [{name, color, values:[y|null], dash}], band: {lo:[..], hi:[..]} */
  function lines(el, xs, series, o = {}) {
    const W = ancho(el), H = o.height || 220, L = 46, R = 14, T = 12, B = 30;
    const all = series.flatMap((s) => s.values).concat(o.band ? [...o.band.lo, ...o.band.hi] : []).filter((v) => v != null);
    let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    const x = (i) => L + (xs.length === 1 ? 0.5 : i / (xs.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Serie')}">`;
    niceTicks(lo, hi, 4).forEach((t) => { s += `<line class="${o.zero === t ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${nf(t)}${o.unit || ''}</text>`; });
    if (o.band) {
      const up = o.band.hi.map((v, i) => `${x(i)},${y(v)}`), dn = o.band.lo.map((v, i) => `${x(i)},${y(v)}`).reverse();
      s += `<polygon points="${up.concat(dn).join(' ')}" fill="${css('--neutral')}" opacity=".35"/>`;
    }
    (o.marks || []).forEach((i) => { s += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="${css('--brand')}" stroke-dasharray="3 3"/>`; });
    series.forEach((se) => {
      let d = '', pen = false;
      se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i) + ',' + y(v); pen = true; });
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" ${se.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
      se.values.forEach((v, i) => { if (v != null && (o.dots || (o.marks || []).includes(i))) s += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${se.color}" stroke="${css('--surface')}" stroke-width="2"/>`; });
    });
    const step = Math.ceil(xs.length / (o.maxLabels || 8));
    const mk = o.marks || [];
    xs.forEach((lab, i) => { const cerca = mk.some((k) => k !== i && Math.abs(k - i) < step); if ((i % step === 0 && !cerca) || mk.includes(i)) s += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(lab)}</text>`; });
    xs.forEach((lab, i) => {
      const t = `<b>${esc(lab)}</b>` + series.map((se) => se.values[i] == null ? '' : `<br><span class="dot" style="background:${se.color}"></span>${esc(se.name)}: ${nf(se.values[i], 1)}${o.unit || ''}`).join('') +
        (o.band ? `<br>Rango normal: ${nf(o.band.lo[i], 1)} – ${nf(o.band.hi[i], 1)}${o.unit || ''}` : '');
      const w = (W - L - R) / Math.max(xs.length - 1, 1);
      s += `<rect class="hit" x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - T - B}" data-tip="${esc(t)}"/>`;
    });
    if (series.length > 1) s += series.map((se, k) => `<g transform="translate(${L + 4 + k * 150},${T + 2})"><line x1="0" x2="16" y1="0" y2="0" stroke="${se.color}" stroke-width="2" ${se.dash ? 'stroke-dasharray="5 4"' : ''}/><text class="lbl" x="22" y="4">${esc(se.name)}</text></g>`).join('');
    el.innerHTML = s + '</svg>';
  }

  /* Event study: puntos con intervalo */
  function eventStudy(el, evento) {
    const W = ancho(el), H = 210, L = 46, R = 14, T = 10, B = 30;
    const lo = Math.min(...evento.map((e) => e.ic_inf ?? e.efecto_pct), -2) - 1, hi = Math.max(...evento.map((e) => e.ic_sup ?? e.efecto_pct), 2) + 1;
    const x = (i) => L + (i + 0.5) / evento.length * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Event study">`;
    niceTicks(lo, hi, 4).forEach((t) => { s += `<line class="${t === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${nf(t)} %</text>`; });
    evento.forEach((e, i) => {
      const c = e.dia === 0 ? css('--down') : css('--ink-2');
      if (e.ic_inf != null) s += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(e.ic_inf)}" y2="${y(e.ic_sup)}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;
      s += `<circle cx="${x(i)}" cy="${y(e.efecto_pct)}" r="${e.dia === 0 ? 6 : 4.5}" fill="${c}" stroke="${css('--surface')}" stroke-width="2"/>`;
      s += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" ${e.dia === 0 ? 'class="lbl"' : ''}>${e.dia === 0 ? 'Día 0' : (e.dia > 0 ? '+' : '') + e.dia}</text>`;
      s += `<rect class="hit" x="${x(i) - 20}" y="${T}" width="40" height="${H - T - B}" data-tip="${esc(`<b>Día ${e.dia}</b><br>${pct(e.efecto_pct)}${e.ic_inf != null ? ` [${pct(e.ic_inf)}, ${pct(e.ic_sup)}]` : ''}`)}"/>`;
    });
    el.innerHTML = s + '</svg>';
  }

  function histogram(el, valores, real) {
    const W = ancho(el), H = 200, L = 36, R = 14, T = 10, B = 30, nb = 24;
    const lo = Math.min(...valores, real) - 0.5, hi = Math.max(...valores, real) + 0.5, bw = (hi - lo) / nb;
    const bins = Array(nb).fill(0); valores.forEach((v) => bins[Math.min(nb - 1, Math.floor((v - lo) / bw))]++);
    const mx = Math.max(...bins), x = (v) => L + (v - lo) / (hi - lo) * (W - L - R), y = (c) => T + (1 - c / mx) * (H - T - B);
    let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Placebo">`;
    niceTicks(lo, hi, 6).forEach((t) => { s += `<text x="${x(t)}" y="${H - 10}" text-anchor="middle">${nf(t)} %</text>`; });
    bins.forEach((c, i) => { if (!c) return; const a = lo + i * bw; s += `<rect x="${x(a) + 1}" y="${y(c)}" width="${x(a + bw) - x(a) - 2}" height="${H - B - y(c)}" rx="2" fill="${css('--neutral')}" data-tip="${esc(`${nf(a, 1)} a ${nf(a + bw, 1)} %: ${c} placebos`)}"/>`; });
    s += `<line x1="${x(real)}" x2="${x(real)}" y1="${T}" y2="${H - B}" stroke="${css('--down')}" stroke-width="2.5"/><text class="lbl" x="${x(real) + 6}" y="${T + 12}">Días de caos reales: ${pct(real)}</text>`;
    el.innerHTML = s + '</svg>';
  }

  function ancho(el) { return Math.max(el.clientWidth || 560, 300); }

  function niceTicks(lo, hi, n) {
    const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag, out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }

  // ------------------------------------------------------------------ modelo del simulador
  function coefMunicipio(tipo, linea, m) {
    const C = tipo.coeficientes;
    if (tipo.id === 'averia') {
      if (!m.lineas.includes(linea)) return null;
      if (m.grupo === 'dependientes') {
        if (m.lineas.length === 1) return { ...C.dependiente_linea_cortada, observado: C.lineas_observadas.includes(linea), motivo: 'Dependiente de la línea cortada' };
        return { ...C.dependiente_otra_linea, motivo: 'Dependiente, pero con otra línea de Rodalies' };
      }
      return { ...C[m.grupo], motivo: GRUPO[m.grupo] };
    }
    if (linea !== 'todas' && !m.lineas.includes(linea)) return null;
    if (m.grupo === 'dependientes') return { ...(C.lineas[m.lineas_clave] || C.grupos.dependientes), motivo: C.lineas[m.lineas_clave] ? `Dependiente de ${m.lineas_clave}` : 'Dependiente' };
    return { ...C.grupos[m.grupo], motivo: GRUPO[m.grupo] };
  }

  function simular(tipoId, linea) {
    const tipo = D.tipos.find((t) => t.id === tipoId);
    const filas = [];
    D.municipios.forEach((m) => {
      const c = coefMunicipio(tipo, linea, m);
      if (!c) return;
      const v = m.viajes_referencia;
      filas.push({ m, c, perdidos: v * c.efecto / 100, lo: v * c.ic_inf / 100, hi: v * c.ic_sup / 100 });
    });
    filas.sort((a, b) => a.perdidos - b.perdidos);
    // Totales sobre los dependientes (donde el efecto está establecido), como en el análisis de M2.
    const dep = filas.filter((f) => f.m.grupo === 'dependientes');
    const sum = (k) => dep.reduce((s, f) => s + f[k], 0);
    return { tipo, filas, dep, perdidos: sum('perdidos'), lo: sum('lo'), hi: sum('hi'), expuestos: dep.reduce((s, f) => s + f.m.viajes_referencia, 0),
      expuestosOtros: filas.filter((f) => f.m.grupo !== 'dependientes').reduce((s, f) => s + f.m.viajes_referencia, 0) };
  }

  function recomendacion(m, efecto) {
    const a = m.alternativa || {};
    if (m.grupo === 'metro_fgc') return '<b>Impacto bajo.</b> Hay metro o FGC hasta Barcelona.';
    if (a.clase === 'fuerte') return `<b>Usa ${ALT_NOMBRE[a.mejor] || 'la alternativa'}</b>: ${nf(a.t_alt)} min${a.salidas_h_alt ? `, ${nf(a.salidas_h_alt, 1)} salidas/h` : ''}.`;
    if (a.clase === 'débil') return `<b>${cap(ALT_NOMBRE[a.mejor] || 'Alternativa')}</b>, pero ${a.penalizacion > 0 ? `+${nf(a.penalizacion)} min respecto al tren` : 'con poca frecuencia'}: sal antes o teletrabaja.`;
    if (a.clase === 'sin alternativa') return '<b>Sin transporte público alternativo directo.</b> Teletrabajo, coche compartido o lanzadera.';
    return efecto != null && efecto > -3 ? 'Impacto bajo.' : '—';
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ------------------------------------------------------------------ 1 · RELATO
  /* Mapa coroplético a pantalla completa (límites municipales del ICGC, sin teselas) con tarjetas
   * que pasan por encima. Cada paso recolorea los municipios con una transición suave, cambia el
   * estado de las líneas, coloca anotaciones sobre el mapa y actualiza la leyenda. */
  const BASE_URL = '../../data/processed/rmove/observatorio/municipios_mapa.geojson';
  const BCN_COD = '08019';
  const BOUNDS_STORY = [[41.17, 1.62], [42.08, 2.82]];
  const CLASES = [
    { max: -20, label: 'Caen más del 20 %' },
    { max: -10, label: 'Caen entre un 10 y un 20 %' },
    { max: -3, label: 'Caen entre un 3 y un 10 %' },
    { max: 3, label: 'Sin cambio claro' },
    { max: Infinity, label: 'Suben más del 3 %' },
  ];
  const claseDe = (e) => CLASES.findIndex((c) => e <= c.max);
  const colClase = (i) => css('--c' + i);
  const ALT_COL = { 'sin alternativa': '--alt0', 'débil': '--alt1', 'fuerte': '--alt2' };
  let story = null;

  function initRelato() {
    if (story) { story.map && story.map.invalidateSize(); return; }
    story = { paso: null };
    document.querySelectorAll('.step').forEach((st) => { const w = document.createElement('div'); w.className = 'step-inner'; while (st.firstChild) w.appendChild(st.firstChild); st.appendChild(w); });

    // textos con datos
    const av = D.incidencias.find((i) => i.fecha === FECHAS.averia), hu = D.incidencias.find((i) => i.fecha === FECHAS.huelga);
    $('r-viajes').textContent = nf(D.perdidos_media.viajes_dia_normal);
    $('r-r1').textContent = pct(av.lineas_dependientes.find((l) => l.linea === 'R1').efecto_pct);
    const norte = av.tramos.find((t) => /norte de Arenys/.test(t.tramo));
    $('r-norte').textContent = norte ? pct(norte.cambio_pct, 0) : '−20 %';
    $('r-huelga').textContent = pct(hu.grupos.find((g) => g.grupo === 'dependientes').efecto_pct);
    const anun = D.barrios.filter((b) => /Huelga (26|01)/.test(b.caso) && b.sentido === 'ida');
    const avg = (k) => anun.reduce((s, b) => s + b[k], 0) / anun.length;
    $('r-puertas').innerHTML = `<div><small>Barrios con estación</small><strong class="down">${pct(avg('con_estacion'))}</strong><span>Sants, Passeig de Gràcia, Clot…</span></div>` +
      `<div><small>Barrios sin estación</small><strong class="up">${pct(avg('sin_estacion'))}</strong><span>se llega en coche o en bus</span></div>`;
    eventStudy($('r-evento'), D.evento);
    const br = D.alternativa.filter((a) => a.dia === 'Todos los días de caos');
    const nom = { 'Sin alternativa directa': 'sin alternativa', 'Alternativa débil': 'débil', 'Alternativa fuerte': 'fuerte' };
    const mx = Math.max(...br.map((a) => Math.abs(a.efecto)));
    $('r-brecha').innerHTML = br.map((a) => `<div class="bar-row" data-tip="${esc(`<b>${a.grupo}</b> (${a.municipios} municipios)<br>${pct(a.efecto)} [${pct(a.ic_inf)}, ${pct(a.ic_sup)}]`)}"><span>${cap(nom[a.grupo])}</span><span class="track"><i style="width:${Math.abs(a.efecto) / mx * 100}%;background:${css(ALT_COL[nom[a.grupo]])}"></i></span><b>${pct(a.efecto)}</b></div>`).join('');
    if (D.hay_vulnerabilidad) $('r-pendiente').textContent = 'Los datos de motorización y renta ya están cargados: consúltalos en el simulador y en Mi municipio.';

    // barra de progreso
    const steps = [...document.querySelectorAll('.step')];
    $('story-progress').innerHTML = steps.map((st, i) => `<li><button type="button" data-i="${i}"><span>${esc(st.dataset.nombre)}</span><i></i></button></li>`).join('');
    $('story-progress').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) steps[+b.dataset.i].scrollIntoView({ behavior: 'smooth', block: 'center' }); });

    cargarBase().then((base) => {
      montarMapaRelato(base);
      const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) activarPaso(e.target); }), { rootMargin: '-50% 0px -50% 0px' });
      steps.forEach((s) => io.observe(s));
      activarPaso(steps[0]);
    }).catch(() => { $('status').innerHTML = 'Falta la cartografía del relato. Ejecuta <code>python src/dashboard-v2/build_mapa_base.py</code>.'; });
  }

  function montarMapaRelato(base) {
    if (!window.L) { $('status').textContent = 'No se ha podido cargar Leaflet: el mapa necesita conexión a Internet.'; return; }
    const map = L.map('map-relato', { zoomControl: false, scrollWheelZoom: false, dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0.1, attributionControl: true });
    map.attributionControl.setPrefix('').addAttribution('Límites: ICGC · Red: GTFS Renfe · Datos: Telefónica');
    map.createPane('rail'); map.getPane('rail').style.zIndex = 450; map.getPane('rail').style.pointerEvents = 'none';
    const porCodigo = new Map(D.municipios.map((m) => [m.codigo, m]));
    story.capas = new Map();
    story.base = L.geoJSON(base, {
      style: () => ({ color: css('--land-edge'), weight: 0.6, fillColor: css('--land'), fillOpacity: 1 }),
      onEachFeature: (f, layer) => {
        story.capas.set(f.properties.codigo, layer);
        layer.bindTooltip(() => tipRelato(f.properties, porCodigo.get(f.properties.codigo)), { sticky: true, className: 'story-tip', direction: 'top', offset: [0, -8] });
        layer.on('mouseover', () => { layer.setStyle({ weight: 2, color: css('--ink') }); layer.bringToFront(); });
        layer.on('mouseout', () => layer.setStyle({ weight: f.properties.codigo === BCN_COD ? 1 : 0.6, color: css('--land-edge') }));
      },
    }).addTo(map);
    story.rail = new Map();
    (RAIL ? RAIL.features : []).filter((f) => f.geometry.type === 'LineString' && f.properties.id !== 'R2').forEach((f) => {
      const casing = L.geoJSON(f, { pane: 'rail', interactive: false, style: { color: css('--land-edge'), weight: 6, opacity: 0.9 } }).addTo(map);
      const linea = L.geoJSON(f, { pane: 'rail', interactive: false, style: { color: f.properties.color, weight: 3, opacity: 0.95 } }).addTo(map);
      story.rail.set(f.properties.id, { casing, linea, color: f.properties.color });
    });
    story.annos = L.layerGroup().addTo(map);
    story.map = map;
    story.porCodigo = porCodigo;
    map.fitBounds(BOUNDS_STORY, encuadre());
  }

  function encuadre() {
    const ancho = innerWidth;
    if (ancho <= 900) return { paddingTopLeft: [12, 12], paddingBottomRight: [12, Math.round(innerHeight * 0.5)] };
    const izq = Math.max(28, (ancho - 1480) / 2 + 28) + 420 + 30;
    return { paddingTopLeft: [izq, 30], paddingBottomRight: [70, 30] };
  }

  function tipRelato(p, m) {
    if (p.codigo === BCN_COD) return '<b>Barcelona</b><br>Destino de los viajes analizados';
    if (!m) return `<b>${esc(p.nombre)}</b><br><span class="muted">${esc(p.comarca)} · fuera del análisis</span>`;
    const paso = story.paso, linea = `<span class="muted">${esc(p.comarca)} · ${esc(m.lineas_clave)} · ${GRUPO[m.grupo]}</span>`;
    let extra = `<span class="v">${nf(m.viajes_referencia)}</span><span class="muted">viajes a Barcelona un día normal</span>`;
    const ef = (fs) => { const r = efectoEn(m, fs); return `<span class="v ${r.e < 0 ? 'down' : 'up'}">${pct(r.e)}</span><span class="muted">viajes a Barcelona · ${r.p < 0.05 ? 'efecto claro' : 'sin efecto claro'}</span>`; };
    if (paso === 'averia') extra = ef([FECHAS.averia]);
    if (paso === 'huelga') extra = ef([FECHAS.huelga]);
    if (paso === 'anunciada') extra = ef(FECHAS.anunciadas);
    if (paso === 'brecha') extra = `<span class="v">${cap(m.alternativa ? m.alternativa.clase : '—')}</span><span class="muted">${m.alternativa && m.alternativa.mejor ? `${cap(ALT_NOMBRE[m.alternativa.mejor])}: ${nf(m.alternativa.t_alt)} min (tren: ${nf(m.alternativa.t_rodalies)} min)` : 'alternativa en transporte público'}</span>`;
    return `<b>${esc(m.nombre)}</b><br>${linea}<br>${extra}`;
  }

  function efectoEn(m, fechas) {
    const v = fechas.map((f) => m.efectos[f]).filter(Boolean);
    if (!v.length) return { e: null, p: null };
    return { e: v.reduce((s, x) => s + x.efecto, 0) / v.length, p: Math.max(...v.map((x) => x.p)) };
  }

  function activarPaso(el) {
    const paso = el.dataset.step;
    document.querySelectorAll('.step').forEach((s) => s.classList.toggle('is-active', s === el));
    const steps = [...document.querySelectorAll('.step')];
    document.querySelectorAll('#story-progress button').forEach((b) => b.classList.toggle('active', +b.dataset.i === steps.indexOf(el)));
    if (!story.map || story.paso === paso) return;
    story.paso = paso;
    pintarPaso(paso);
  }

  function lineaDe(id) {
    return D.incidencias.find((i) => i.fecha === FECHAS.huelga).lineas_dependientes.find((l) => l.linea === id);
  }

  function pintarPaso(paso) {
    const S = story, municipio = (nombre) => D.municipios.find((m) => m.nombre === nombre);
    const anno = (lat, lon, html, cls = '') => L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="anno ${cls}"><span class="pin"></span><div class="pill">${html}</div></div>` }) }).addTo(S.annos);
    const efectoMun = (nombre, fs) => { const m = municipio(nombre); return m ? efectoEn(m, fs).e : null; };

    // 1) relleno de municipios
    let relleno, leyenda, rail = () => 'on', bounds = BOUNDS_STORY;
    // Caídas: color por magnitud, más transparente si no son estadísticamente claras (p ≥ 0,1).
    // Subidas: solo se colorean si son claras (en estos días suelen ser ruido en municipios con alternativa).
    const porClase = (fs) => (m) => {
      const r = efectoEn(m, fs); if (r.e == null) return css('--other');
      const k = claseDe(r.e), claro = r.p < 0.1;
      if (k === 4 && !claro) return colClase(3);
      return { color: colClase(k), op: claro || k === 3 ? 1 : 0.5 };
    };
    const leyendaClases = (titulo) => `<h4>${titulo}</h4><ul>${CLASES.map((c, i) => `<li><span class="sw" style="background:${colClase(i)}"></span>${c.label}</li>`).join('')}<li><span class="sw" style="background:${css('--land')}"></span>Fuera del análisis</li></ul><p class="note">Viajes a Barcelona frente a un día normal. Color más suave: sin efecto estadísticamente claro. Pasa el cursor por un municipio para ver el detalle.</p>`;
    const lineaLeyenda = (txt, dash) => `<li><span class="ln" style="border-top-style:${dash ? 'dotted' : 'solid'};border-color:${css('--ink-2')}"></span>${txt}</li>`;
    S.annos.clearLayers();

    switch (paso) {
      case 'averia':
        relleno = porClase([FECHAS.averia]);
        rail = (id) => id === 'R1' ? 'cut' : 'on';
        bounds = [[41.36, 2.02], [41.75, 2.80]];
        leyenda = leyendaClases('13/05/2024 · Avería R1').replace('</ul>', lineaLeyenda('R1 cortada', true) + '</ul>');
        anno(41.4836, 2.1878, '<b>⚡</b>Robo de cobre<small>Montcada Bifurcació</small>', 'alert');
        { const n = D.incidencias.find((i) => i.fecha === FECHAS.averia).tramos.find((t) => /norte de Arenys/.test(t.tramo));
          anno(41.6137, 2.6547, `<b>${pct(n ? n.cambio_pct : null, 0)}</b>Maresme norte<small>sin tren al norte de Arenys</small>`); }
        anno(41.5381, 2.4447, `<b>${pct(efectoMun('Mataró', [FECHAS.averia]), 0)}</b>Mataró<small>con bus a Barcelona</small>`);
        break;
      case 'huelga':
        relleno = porClase([FECHAS.huelga]);
        rail = () => 'cut';
        leyenda = leyendaClases('17/03/2025 · Huelga general').replace('</ul>', lineaLeyenda('Servicios mínimos en toda la red', true) + '</ul>');
        anno(41.9301, 2.2549, `<b>${pct(lineaDe('R3').efecto_pct, 0)}</b>Osona · R3`);
        anno(41.2372, 1.8059, `<b>${pct(lineaDe('R2S').efecto_pct, 0)}</b>Garraf · R2 Sud`);
        anno(41.6137, 2.6547, `<b>${pct(lineaDe('R1').efecto_pct, 0)}</b>Maresme · R1`);
        break;
      case 'anunciada': {
        relleno = porClase(FECHAS.anunciadas);
        rail = () => 'cut';
        leyenda = leyendaClases('Huelgas anunciadas · media');
        const r2s = D.tipos.find((t) => t.id === 'anunciada').coeficientes.lineas.R2S;
        anno(41.2372, 1.8059, `<b>${pct(r2s.efecto, 0)}</b>Garraf · R2 Sud<small>el único que sigue cayendo</small>`);
        anno(41.387, 2.170, 'Barcelona<small style="color:inherit;opacity:.8">los viajes llegan a otros barrios</small>', 'place');
        break;
      }
      case 'duracion':
        relleno = (m) => colClase(3);
        leyenda = `<h4>Al día siguiente</h4><ul><li><span class="sw" style="background:${colClase(3)}"></span>Sin cambio claro</li><li><span class="sw" style="background:${css('--land')}"></span>Fuera del análisis</li></ul><p class="note">Días +1 a +3 después del caos: los viajes vuelven a la normalidad (media de los cuatro días).</p>`;
        anno(41.387, 2.170, 'Día +1<small style="color:inherit;opacity:.8">todo vuelve a la normalidad</small>', 'place');
        break;
      case 'brecha':
        relleno = (m) => css(ALT_COL[m.alternativa && m.alternativa.clase] || '--other');
        leyenda = `<h4>Alternativa al tren hacia Barcelona</h4><ul>${['sin alternativa', 'débil', 'fuerte'].map((c) => `<li><span class="sw" style="background:${css(ALT_COL[c])}"></span>${cap(c)}</li>`).join('')}<li><span class="sw" style="background:${css('--land')}"></span>Fuera del análisis</li></ul><p class="note">Según el tiempo puerta a puerta y la frecuencia del bus interurbano, AMB o FGC (GTFS).</p>`;
        break;
      default: // normal y fin
        relleno = (m) => m.grupo === 'dependientes' ? css('--dep') : css('--other');
        leyenda = `<h4>Un día normal</h4><ul><li><span class="sw" style="background:${css('--dep')}"></span>Dependen del tren (35)</li><li><span class="sw" style="background:${css('--other')}"></span>Rodalies con alternativa</li><li><span class="sw" style="background:${css('--bcn')}"></span>Barcelona</li><li><span class="sw" style="background:${css('--land')}"></span>Fuera del análisis</li>${lineaLeyenda('Líneas de Rodalies')}</ul>`;
        anno(41.387, 2.170, 'Barcelona', 'place');
    }

    S.capas.forEach((layer, codigo) => {
      const m = S.porCodigo.get(codigo);
      const f = codigo === BCN_COD ? css('--bcn') : m ? relleno(m) : css('--land');
      const fill = typeof f === 'string' ? f : f.color, op = typeof f === 'string' ? 1 : f.op;
      layer.setStyle({ fillColor: fill, fillOpacity: op, weight: codigo === BCN_COD ? 1 : 0.6, color: css('--land-edge') });
    });
    S.rail.forEach((r, id) => {
      const st = rail(id);
      r.linea.setStyle(st === 'cut' ? { color: r.color, weight: 3, opacity: 0.95, dashArray: '1 7', lineCap: 'round' } : { color: r.color, weight: 3, opacity: 0.95, dashArray: null });
      r.casing.setStyle({ opacity: st === 'cut' ? 0 : 0.9 });
    });
    $('legend-relato').innerHTML = leyenda;
    S.map.flyToBounds(bounds, { ...encuadre(), duration: 1.1 });
  }

  // ------------------------------------------------------------------ piezas comunes: mapa coroplético, iconos, buscador
  let BASE_P = null;
  const cargarBase = () => BASE_P || (BASE_P = fetch(BASE_URL).then((r) => { if (!r.ok) throw new Error('municipios_mapa.geojson'); return r.json(); }));
  let PC = new Map();          // código → municipio del análisis
  let COMARCA = new Map();     // código → comarca (de la cartografía)

  const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const visible = (map) => { const z = map.getSize(); return z.x > 0 && z.y > 0; };

  const ICON = {
    tren: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.2l2-2h3.6l2 2H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-4-4-8-4zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>',
    bus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm1.5-6H6V6h12v5z"/></svg>',
    casa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>',
    rayo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    huelga: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9 8h2v8H9zm4 0h2v8h-2z"/></svg>',
    calendario: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM5 9v11h14V9zm2 3h4v4H7z"/></svg>',
    lupa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>',
    aviso: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l10 18H2zm-1 7v5h2V9zm0 7v2h2v-2z"/></svg>',
  };
  const ICON_TIPO = { averia: 'rayo', huelga: 'huelga', anunciada: 'calendario' };
  const CORTO_TIPO = { averia: 'Avería', huelga: 'Huelga', anunciada: 'Anunciada' };
  const colorLinea = (l) => { const f = RAIL && RAIL.features.find((x) => x.properties.id === l && x.geometry.type === 'LineString'); return f ? f.properties.color : css('--ink-2'); };
  const chipLinea = (l) => `<span class="chip" style="background:${colorLinea(l)}">${esc(l)}</span>`;
  const tintaSobre = (k) => (k <= 1 ? '#fff' : 'var(--ink)');

  /* Mapa coroplético reutilizable (mismo estilo que el relato). */
  async function mapaCoropletico(id, o = {}) {
    const base = await cargarBase();
    if (!window.L) { $('status').textContent = 'No se ha podido cargar Leaflet: el mapa necesita conexión a Internet.'; return null; }
    const fijo = o.fijo === true;
    const map = L.map(id, { zoomControl: !fijo, scrollWheelZoom: !fijo, dragging: !fijo, doubleClickZoom: !fijo, touchZoom: !fijo, boxZoom: false, keyboard: !fijo, zoomSnap: 0.1, attributionControl: true });
    if (!fijo) map.zoomControl.setPosition('bottomright');
    map.attributionControl.setPrefix('').addAttribution('Límites: ICGC · Red: GTFS Renfe · Datos: Telefónica');
    map.createPane('rail'); map.getPane('rail').style.zIndex = 450; map.getPane('rail').style.pointerEvents = 'none';
    map.createPane('ruta'); map.getPane('ruta').style.zIndex = 460; map.getPane('ruta').style.pointerEvents = 'none';
    const M = { map, capas: new Map(), rail: new Map(), sel: null, estilo: new Map() };
    L.geoJSON(base, {
      style: () => ({ color: css('--land-edge'), weight: 0.6, fillColor: css('--land'), fillOpacity: 1 }),
      onEachFeature: (f, layer) => {
        const cod = f.properties.codigo; M.capas.set(cod, layer);
        if (o.tip) layer.bindTooltip(() => o.tip(f.properties, PC.get(cod)), { sticky: true, className: 'story-tip', direction: 'top', offset: [0, -8] });
        layer.on('mouseover', () => { if (PC.has(cod) || cod === BCN_COD) layer.setStyle({ weight: 2, color: css('--ink') }); });
        layer.on('mouseout', () => layer.setStyle(bordeDe(M, cod)));
        if (o.onClick) layer.on('click', () => { const m = PC.get(cod); if (m) o.onClick(m); });
      },
    }).addTo(map);
    (RAIL ? RAIL.features : []).filter((f) => f.geometry.type === 'LineString' && f.properties.id !== 'R2').forEach((f) => {
      const casing = L.geoJSON(f, { pane: 'rail', interactive: false, style: { color: css('--land-edge'), weight: 5, opacity: 0.9 } }).addTo(map);
      const linea = L.geoJSON(f, { pane: 'rail', interactive: false, style: { color: f.properties.color, weight: 2.5, opacity: 0.95 } }).addTo(map);
      M.rail.set(f.properties.id, { casing, linea, color: f.properties.color });
    });
    M.annos = L.layerGroup().addTo(map);
    M.ruta = L.layerGroup().addTo(map);
    M.pintar = (fn) => M.capas.forEach((layer, cod) => {
      const m = PC.get(cod);
      const f = cod === BCN_COD ? css('--bcn') : m ? fn(m) : css('--land');
      layer.setStyle({ fillColor: typeof f === 'string' ? f : f.color, fillOpacity: typeof f === 'string' ? 1 : f.op, ...bordeDe(M, cod) });
    });
    M.vias = (estado) => M.rail.forEach((r, lid) => {
      const st = estado(lid);
      r.linea.setStyle(st === 'cut' ? { color: r.color, weight: 2.5, opacity: 0.95, dashArray: '1 6', lineCap: 'round' }
        : st === 'dim' ? { color: css('--neutral'), weight: 2, opacity: 0.6, dashArray: null } : { color: r.color, weight: 2.5, opacity: 0.95, dashArray: null });
      r.casing.setStyle({ opacity: st === 'on' ? 0.9 : 0 });
    });
    M.resaltar = (cod) => { M.sel = cod; M.capas.forEach((layer, c) => layer.setStyle(bordeDe(M, c))); if (cod && M.capas.get(cod)) M.capas.get(cod).bringToFront(); };
    M.encuadrar = (b, pad) => { if (visible(map)) map.flyToBounds(b, { ...(pad || {}), duration: 0.8 }); else M.pendiente = [b, pad]; };
    M.refrescar = () => { map.invalidateSize(); if (M.pendiente && visible(map)) { map.fitBounds(M.pendiente[0], M.pendiente[1] || {}); M.pendiente = null; } };
    if (visible(map)) map.fitBounds(o.bounds || BOUNDS_STORY, o.pad || {}); else M.pendiente = [o.bounds || BOUNDS_STORY, o.pad];
    return M;
  }
  const bordeDe = (M, cod) => (cod === M.sel ? { weight: 3, color: css('--ink') } : { weight: cod === BCN_COD ? 1 : 0.6, color: css('--land-edge') });

  /* Color de un efecto (mismas clases que el relato). Las subidas no claras se dibujan como «sin cambio claro». */
  function colorEf(e, p, apagado) {
    if (e == null) return css('--other');
    const k = claseDe(e), claro = p == null || p < 0.1;
    if (k === 4 && !claro) return { color: colClase(3), op: apagado ? 0.35 : 1 };
    return { color: colClase(k), op: apagado ? 0.3 : claro || k === 3 ? 1 : 0.55 };
  }
  const leyendaClasesHTML = (titulo, extra = '', sinSubidas = false) => `<h4>${titulo}</h4><ul>${CLASES.filter((c, i) => !(sinSubidas && i === 4)).map((c, i) => `<li><span class="sw" style="background:${colClase(i)}"></span>${c.label}</li>`).join('')}${extra}</ul>`;

  /* Buscador con autocompletado (sin <datalist>, para controlar el estilo y el teclado). */
  function autocompletar(input, lista, onPick) {
    let idx = -1, items = [];
    const pintar = () => {
      const q = norm(input.value);
      items = q ? D.municipios.filter((m) => norm(m.nombre).includes(q)).sort((a, b) => norm(a.nombre).indexOf(q) - norm(b.nombre).indexOf(q) || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 7) : [];
      idx = items.length ? 0 : -1;
      lista.innerHTML = items.map((m, i) => `<li role="option" data-i="${i}" class="${i === idx ? 'on' : ''}"><b>${esc(m.nombre)}</b><span>${m.lineas.map(chipLinea).join('')} ${esc(COMARCA.get(m.codigo) || '')}</span></li>`).join('');
      lista.hidden = !items.length;
    };
    input.addEventListener('input', pintar);
    input.addEventListener('focus', pintar);
    input.addEventListener('keydown', (e) => {
      if (lista.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; [...lista.children].forEach((li, i) => li.classList.toggle('on', i === idx)); }
      if (e.key === 'Enter' && items[idx]) { e.preventDefault(); lista.hidden = true; onPick(items[idx]); }
      if (e.key === 'Escape') lista.hidden = true;
    });
    lista.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (!li) return; e.preventDefault(); lista.hidden = true; onPick(items[+li.dataset.i]); });
    input.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 120));
  }

  /* Tramo de una línea entre dos puntos (vértices más cercanos), para dibujar el recorrido en tren. */
  function tramoLinea(lid, a, b) {
    const f = RAIL && RAIL.features.find((x) => x.properties.id === lid && x.geometry.type === 'LineString');
    if (!f) return null;
    const c = f.geometry.coordinates, cerca = (p) => { let k = 0, d = Infinity; c.forEach(([lon, lat], i) => { const dd = (lat - p[0]) ** 2 + ((lon - p[1]) * 0.75) ** 2; if (dd < d) { d = dd; k = i; } }); return k; };
    let i = cerca(a), j = cerca(b); if (i > j) [i, j] = [j, i];
    const pts = c.slice(i, j + 1).map(([lon, lat]) => [lat, lon]);
    return cerca(a) <= cerca(b) ? pts : pts.reverse();
  }
  function arco(a, b, k = 0.22) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
    const c = [mx - dy * k, my + dx * k], out = [];
    for (let t = 0; t <= 1.0001; t += 1 / 40) out.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t ** 2 * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t ** 2 * b[1]]);
    return out;
  }
  const burbuja = (M, ll, html, cls = '') => L.marker(ll, { pane: 'ruta', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="bubble ${cls}">${html}</div>` }) }).addTo(M.ruta);
  const pin = (M, ll, letra, cls) => L.marker(ll, { pane: 'ruta', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="pinAB ${cls}">${letra}</div>` }) }).addTo(M.ruta);
  const padPanel = () => (innerWidth > 900 ? { paddingTopLeft: [Math.min(430, innerWidth * 0.45), 40], paddingBottomRight: [60, 40] } : { padding: [20, 20] });

  // ------------------------------------------------------------------ 2 · SIMULADOR (planificador tipo «Google Maps»)
  const sim = { tipo: 'huelga', linea: 'todas', dur: 1, mun: null, ruta: null, M: null, listo: false };

  async function initSimulador(params) {
    if (params) {
      if (params.get('tipo')) sim.tipo = params.get('tipo');
      if (params.get('linea')) sim.linea = params.get('linea');
      if (params.get('mun') !== null) sim.mun = params.get('mun') || null;
      sim.ruta = null;
    }
    if (!sim.listo) {
      sim.listo = true;
      $('sim-tipos').innerHTML = D.tipos.map((t) => `<button type="button" role="tab" data-tipo="${t.id}"><span class="ic">${ICON[ICON_TIPO[t.id]]}</span>${CORTO_TIPO[t.id]}</button>`).join('');
      $('sim-tipos').addEventListener('click', (e) => { const b = e.target.closest('[data-tipo]'); if (!b) return; sim.tipo = b.dataset.tipo; if (sim.tipo === 'averia' && sim.linea === 'todas') sim.linea = (PC.get(sim.mun) || { lineas: ['R1'] }).lineas[0]; sim.ruta = null; actualizarSim(); });
      $('sim-lineas').addEventListener('click', (e) => { const b = e.target.closest('[data-linea]'); if (!b) return; sim.linea = b.dataset.linea; sim.ruta = null; actualizarSim(); });
      $('sim-dur').addEventListener('click', (e) => { const b = e.target.closest('[data-dur]'); if (!b) return; sim.dur = +b.dataset.dur; actualizarSim(); });
      autocompletar($('sim-origen'), $('sim-ac'), (m) => elegirOrigen(m.codigo));
      $('sim-limpiar').addEventListener('click', () => elegirOrigen(null));
      $('sim-result').addEventListener('click', (e) => {
        const t = e.target.closest('[data-mun]'); if (t) return elegirOrigen(t.dataset.mun);
        const r = e.target.closest('[data-ruta]'); if (r) { sim.ruta = r.dataset.ruta; actualizarSim(false); }
      });
      sim.M = await mapaCoropletico('map-sim', { tip: tipSim, onClick: (m) => elegirOrigen(m.codigo), pad: padPanel() });
    }
    actualizarSim();
    sim.M && setTimeout(() => sim.M.refrescar(), 60);
  }
  function elegirOrigen(cod) {
    sim.mun = cod; sim.ruta = null;
    const m = PC.get(cod);
    if (m && D.tipos.find((t) => t.id === sim.tipo).requiere_linea && !m.lineas.includes(sim.linea)) sim.linea = m.lineas[0];
    actualizarSim();
  }
  function tipSim(p, m) {
    if (p.codigo === BCN_COD) return '<b>Barcelona</b><br><span class="muted">Destino</span>';
    if (!m) return `<b>${esc(p.nombre)}</b><br><span class="muted">Fuera del análisis</span>`;
    const r = simular(sim.tipo, sim.linea).filas.find((f) => f.m.codigo === m.codigo);
    return `<b>${esc(m.nombre)}</b> ${m.lineas.map(chipLinea).join('')}<br>` + (r ? `<span class="v ${r.c.efecto < 0 ? 'down' : ''}">${pct(r.c.efecto)}</span><span class="muted">${nf(Math.max(-r.perdidos, 0))} viajes menos · clic para ver rutas</span>` : '<span class="muted">No afectado en este escenario</span>');
  }

  function opcionesRuta(m, tipo, linea) {
    const a = m.alternativa || {};
    const afectado = tipo.id === 'averia' ? m.lineas.includes(linea) : (linea === 'todas' || m.lineas.includes(linea));
    const lTren = tipo.id === 'averia' && m.lineas.includes(linea) ? linea : m.lineas[0];
    const estadoTren = !afectado ? ['ok', 'Funciona con normalidad'] : tipo.id === 'averia' ? ['bad', 'Línea cortada'] : tipo.id === 'huelga' ? ['bad', 'Servicios mínimos'] : ['warn', 'Servicios mínimos anunciados'];
    const ops = [{ id: 'tren', icon: 'tren', titulo: `Rodalies ${lTren}`, min: a.t_rodalies, sub: a.salidas_h_rodalies ? `${nf(a.salidas_h_rodalies, 1)} trenes/h un día normal` : '', estado: estadoTren, linea: lTren }];
    if (a.mejor) ops.push({ id: 'alt', icon: a.mejor === 'fgc' ? 'tren' : 'bus', titulo: cap(ALT_NOMBRE[a.mejor]), min: a.t_alt, sub: `${nf(a.salidas_h_alt, 1)} salidas/h${a.penalizacion != null ? ` · ${a.penalizacion > 0 ? '+' : ''}${nf(a.penalizacion)} min vs. tren` : ''}`, estado: a.clase === 'fuerte' ? ['ok', 'Buena alternativa'] : ['warn', 'Más lenta o menos frecuente'] });
    ops.push({ id: 'casa', icon: 'casa', titulo: 'Teletrabajar o aplazar', min: null, sub: a.mejor ? 'Si tu trabajo lo permite' : 'No hay transporte público alternativo directo', estado: a.mejor ? ['', ''] : ['warn', 'Única opción sin coche'] });
    const rec = !afectado ? 'tren' : a.mejor ? 'alt' : 'casa';
    ops.forEach((o) => { o.rec = o.id === rec; });
    return { ops: ops.sort((x, y) => y.rec - x.rec), rec, afectado };
  }

  function actualizarSim(reencuadrar = true) {
    const tipo = D.tipos.find((t) => t.id === sim.tipo) || D.tipos[0];
    sim.tipo = tipo.id;
    if (tipo.requiere_linea && sim.linea === 'todas') sim.linea = 'R1';
    history.replaceState(null, '', `#simulador?tipo=${sim.tipo}&linea=${sim.linea}${sim.mun ? '&mun=' + sim.mun : ''}`);
    const r = simular(sim.tipo, sim.linea), afect = new Map(r.filas.map((f) => [f.m.codigo, f]));
    const m = PC.get(sim.mun) || null;

    // controles
    document.querySelectorAll('#sim-tipos button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tipo === sim.tipo));
    $('sim-tipo-det').textContent = tipo.detalle;
    const lineas = (tipo.requiere_linea ? [] : ['todas']).concat(LINEAS_SIM);
    $('sim-lineas').innerHTML = `<span class="lbl">${tipo.requiere_linea ? 'Línea cortada' : 'Líneas'}</span>` + lineas.map((l) => `<button type="button" data-linea="${l}" class="${l === sim.linea ? 'on' : ''}" style="--lc:${l === 'todas' ? 'var(--ink)' : colorLinea(l)}">${l === 'todas' ? 'Toda la red' : l}</button>`).join('');
    document.querySelectorAll('#sim-dur button').forEach((b) => b.classList.toggle('on', +b.dataset.dur === sim.dur));
    $('sim-origen').value = m ? m.nombre : '';
    $('sim-limpiar').hidden = !m;

    // avisos (compactos, con explicación al pasar el cursor)
    const av = [];
    if (tipo.id === 'averia' && !tipo.coeficientes.lineas_observadas.includes(sim.linea)) av.push(['Extrapolado', `Solo se ha observado una avería sin aviso (R1, 13/05/2024). Para la ${sim.linea} se aplica el mismo coeficiente.`]);
    if (sim.dur > 1) av.push(['Varios días: rango', `Solo se han medido primeros días. Rango entre «solo el primer día» (adaptación total) y «${sim.dur} × primer día» (sin adaptación).`]);
    const avisos = av.map(([t, d]) => `<span class="warn-chip" data-tip="${esc(d)}">${ICON.aviso}${t}</span>`).join('');

    // resultado
    const perd = Math.max(-r.perdidos, 0), perdTxt = sim.dur > 1 ? `${nf(perd)}–${nf(perd * sim.dur)}` : nf(perd);
    let html;
    if (!m) {
      const top = r.filas.filter((f) => f.m.grupo === 'dependientes' && f.perdidos < 0).slice(0, 5);
      const mx = Math.max(...top.map((f) => -f.perdidos), 1);
      html = `<div class="pp-impact"><strong>${perdTxt}</strong><span>viajes menos a Barcelona${sim.dur > 1 ? ` en ${sim.dur} días` : ' el primer día'}</span></div>
        <div class="pp-sub">${r.dep.length} municipios dependientes afectados · vuelve a la normalidad ${sim.dur > 1 ? 'en pocos días' : 'al día siguiente'} ${avisos}</div>
        <h3 class="pp-h">Los más afectados</h3>
        <ol class="pp-top">${top.map((f) => `<li><button type="button" data-mun="${f.m.codigo}"><span class="nm">${esc(f.m.nombre)} ${chipLinea(f.m.lineas_clave.split('+')[0])}</span><span class="bar"><i style="width:${-f.perdidos / mx * 100}%;background:${colClase(claseDe(f.c.efecto))}"></i></span><span class="vl">${pct(f.c.efecto, 0)}</span></button></li>`).join('') || '<li class="muted">Ningún municipio dependiente afectado.</li>'}</ol>
        <p class="pp-hint">${ICON.lupa} Elige tu municipio arriba o haz clic en el mapa para ver cómo llegar a Barcelona.</p>`;
    } else {
      const f = afect.get(m.codigo), o = opcionesRuta(m, tipo, sim.linea);
      if (!sim.ruta || !o.ops.some((x) => x.id === sim.ruta)) sim.ruta = o.rec;
      const k = f ? claseDe(f.c.efecto) : 3;
      html = `<div class="pp-mun"><div><b>${esc(m.nombre)}</b><span>${esc(COMARCA.get(m.codigo) || '')} · ${GRUPO[m.grupo]}</span></div>
          ${f ? `<div class="pp-eff" style="background:${colClase(k)};color:${tintaSobre(k)}" data-tip="${esc(`${esc(f.c.fuente)}<br>${pval(f.c.p)}${f.c.observado ? '' : '<br>Extrapolado'}`)}"><strong>${pct(f.c.efecto, 0)}</strong><span>viajes</span></div>` : '<div class="pp-eff"><strong>≈ 0 %</strong><span>no afectado</span></div>'}</div>
        <div class="pp-sub">${f && f.perdidos < 0 ? `≈ ${nf(-f.perdidos)} viajes menos de ${nf(m.viajes_referencia)} un día normal` : 'Este escenario no afecta a tus líneas'} ${avisos}</div>
        <h3 class="pp-h">Cómo llegar a Barcelona</h3>
        <div class="routes">${o.ops.map((x) => `<button type="button" class="route ${x.id === sim.ruta ? 'sel' : ''}" data-ruta="${x.id}">
            <span class="ric ${x.id}">${ICON[x.icon]}</span>
            <span class="rbody"><b>${esc(x.titulo)}</b><small>${esc(x.sub)}</small>${x.estado[1] ? `<em class="st ${x.estado[0]}">${esc(x.estado[1])}</em>` : ''}</span>
            <span class="rtime">${x.min != null ? `<strong>${nf(x.min)}</strong> min` : ''}${x.rec ? '<i class="rec">Recomendada</i>' : ''}</span></button>`).join('')}</div>
        <p class="pp-hint">${o.afectado ? (sim.dur > 1 ? 'La gente se adapta en pocos días: el efecto se diluye.' : 'Mañana, todo vuelve a la normalidad.') : 'Tu línea funciona: el impacto llega por la congestión del resto de la red.'} <a href="#municipio/${m.codigo}">Ver ficha de ${esc(m.nombre)} →</a></p>`;
    }
    $('sim-result').innerHTML = html;
    detallesSim(tipo, r);

    // mapa
    const M = sim.M; if (!M) return;
    M.pintar((x) => { const f = afect.get(x.codigo); return f ? colorEf(Math.min(f.c.efecto, 0), f.c.p, m && x.codigo !== m.codigo) : (m ? { color: css('--other'), op: 0.5 } : css('--other')); });
    M.vias((lid) => (tipo.id === 'averia' ? (lid === sim.linea ? 'cut' : 'on') : (sim.linea === 'todas' || lid === sim.linea ? 'cut' : 'on')));
    M.resaltar(m ? m.codigo : null);
    $('legend-sim').innerHTML = leyendaClasesHTML(m ? 'Impacto del escenario' : `${CORTO_TIPO[tipo.id]} · ${sim.linea === 'todas' ? 'toda la red' : sim.linea}`, `<li><span class="sw" style="background:${css('--other')}"></span>No afectado</li>`, true);
    M.ruta.clearLayers();
    if (!m) { if (reencuadrar) M.encuadrar(BOUNDS_STORY, padPanel()); return; }
    const A = [m.lat, m.lon], B = BCN, o = opcionesRuta(m, tipo, sim.linea), bounds = L.latLngBounds([A, B]);
    const tren = o.ops.find((x) => x.id === 'tren'), alt = o.ops.find((x) => x.id === 'alt');
    const pts = tramoLinea(tren.linea, A, B);
    const selT = sim.ruta === 'tren', selA = sim.ruta === 'alt';
    if (pts && pts.length > 1) {
      const cortado = o.afectado && tren.estado[0] === 'bad';
      L.polyline([A, pts[0]], { pane: 'ruta', color: css('--ink-2'), weight: 2, dashArray: '2 5', opacity: 0.8 }).addTo(M.ruta);
      L.polyline(pts, { pane: 'ruta', color: css('--surface'), weight: selT ? 11 : 8, opacity: 0.95 }).addTo(M.ruta);
      L.polyline(pts, { pane: 'ruta', color: selT ? tren.linea && colorLinea(tren.linea) : css('--neutral'), weight: selT ? 7 : 5, opacity: 1, dashArray: cortado ? '2 10' : null, lineCap: 'round' }).addTo(M.ruta);
      const mid = pts[Math.floor(pts.length / 2)];
      burbuja(M, mid, `${ICON.tren}<b>${nf(tren.min)} min</b>${o.afectado ? `<em>${esc(tren.estado[1])}</em>` : ''}`, `${selT ? 'sel' : ''} ${tren.estado[0]}`);
      pts.forEach((p) => bounds.extend(p));
    }
    if (alt) {
      const ar = arco(A, B, alt.icon === 'bus' ? -0.22 : 0.22);
      L.polyline(ar, { pane: 'ruta', color: css('--surface'), weight: selA ? 10 : 7, opacity: 0.95 }).addTo(M.ruta);
      L.polyline(ar, { pane: 'ruta', color: selA ? css('--route') : css('--neutral'), weight: selA ? 6 : 4, dashArray: '9 7', opacity: 1, lineCap: 'round' }).addTo(M.ruta);
      burbuja(M, ar[20], `${ICON[alt.icon]}<b>${nf(alt.min)} min</b>`, selA ? 'sel alt' : 'alt');
      ar.forEach((p) => bounds.extend(p));
    }
    pin(M, A, 'A', 'a'); pin(M, B, 'B', 'b');
    if (reencuadrar) M.encuadrar(bounds.pad(0.15), padPanel());
  }

  function detallesSim(tipo, r) {
    const ida = tipo.barrios.filter((b) => b.sentido === 'ida');
    const avg = (k) => ida.reduce((s, b) => s + b[k], 0) / Math.max(ida.length, 1);
    $('sim-mas').innerHTML = `
      <h4>¿A qué barrios de Barcelona dejan de llegar?</h4>
      <div class="doors"><div><small>Barrios con estación</small><strong class="down">${pct(avg('con_estacion'))}</strong></div><div><small>Barrios sin estación</small><strong class="${avg('sin_estacion') < 0 ? 'down' : 'up'}">${pct(avg('sin_estacion'))}</strong></div></div>
      <p class="muted small">Datos por barrio (M3), viajes de ida desde municipios dependientes. ${esc(ida.map((b) => b.caso).join(' y '))}.</p>
      <h4>Personas más expuestas</h4>
      ${D.hay_vulnerabilidad ? '' : `<p class="small">${nf(r.filas.filter((f) => f.m.alternativa && f.m.alternativa.clase === 'sin alternativa').reduce((s, f) => s + f.m.viajes_referencia, 0))} viajes diarios salen de municipios sin alternativa directa.</p><p class="pending small">Pendiente: motorización y renta.</p>`}
      <h4>Todos los municipios afectados</h4>
      <div class="table-wrap" style="max-height:300px"><table class="tbl compact"><thead><tr><th>Municipio</th><th class="num">Efecto</th><th class="num">Viajes menos</th></tr></thead><tbody>${r.filas.map((f) => `<tr class="${f.c.p >= 0.05 ? 'ns' : ''}"><td><a href="#" data-mun="${f.m.codigo}">${esc(f.m.nombre)}</a></td><td class="num">${pct(f.c.efecto)}</td><td class="num">${nf(Math.max(-f.perdidos, 0))}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">Viajes menos = viajes de un día normal × coeficiente del escenario. En gris: sin efecto claro (p ≥ 0,05). Detalle del método en el Laboratorio.</p>`;
    $('sim-mas').querySelectorAll('[data-mun]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); elegirOrigen(a.dataset.mun); $('sim-panel').scrollTo({ top: 0, behavior: 'smooth' }); }));
  }

  // ------------------------------------------------------------------ 3 · MI MUNICIPIO
  const mun = { listo: false, M: null, F: null };
  async function initMunicipio(codigo) {
    const m = PC.get(codigo);
    $('mun-landing').hidden = !!m; $('mun-ficha').hidden = !m;
    if (!mun.listo) {
      mun.listo = true;
      autocompletar($('mun-buscar'), $('mun-ac'), (x) => { location.hash = '#municipio/' + x.codigo; });
      const top = D.municipios.filter((x) => x.rango_vulnerabilidad).sort((a, b) => a.rango_vulnerabilidad - b.rango_vulnerabilidad).slice(0, 6);
      $('mun-top').innerHTML = top.map((x) => `<a class="mchip" href="#municipio/${x.codigo}">${chipLinea(x.lineas[0])}${esc(x.nombre)} <span>${pct(x.efecto_medio, 0)}</span></a>`).join('');
      mun.M = await mapaCoropletico('map-mun-landing', {
        pad: padPanel(), onClick: (x) => { location.hash = '#municipio/' + x.codigo; },
        tip: (p, x) => p.codigo === BCN_COD ? '<b>Barcelona</b>' : x ? `<b>${esc(x.nombre)}</b> ${x.lineas.map(chipLinea).join('')}<br><span class="v ${x.efecto_medio < 0 ? 'down' : ''}">${pct(x.efecto_medio)}</span><span class="muted">efecto medio en los 4 días de caos · ${x.rango_vulnerabilidad}.º de 62</span>` : `<b>${esc(p.nombre)}</b><br><span class="muted">Fuera del análisis</span>`,
      });
      if (mun.M) { mun.M.pintar((x) => colorEf(x.efecto_medio, null)); $('legend-mun').innerHTML = leyendaClasesHTML('Efecto medio en los días de caos'); }
    }
    if (!m) { setTimeout(() => { mun.M && mun.M.refrescar(); $('mun-buscar').focus(); }, 60); return; }
    fichaMunicipio(m);
  }

  async function fichaMunicipio(m) {
    scrollTo(0, 0);
    const a = m.alternativa || {}, orden = D.municipios.filter((x) => x.efecto_medio != null).sort((x, y) => x.efecto_medio - y.efecto_medio), n = orden.length;
    const escen = D.tipos.map((t) => { const l = t.requiere_linea ? m.lineas[0] : 'todas', c = coefMunicipio(t, l, m); return { t, l, c, perd: c ? m.viajes_referencia * c.efecto / 100 : 0 }; });
    const frase = m.rango_vulnerabilidad <= Math.round(n / 3) ? 'de los más vulnerables' : m.rango_vulnerabilidad <= Math.round(2 * n / 3) ? 'de vulnerabilidad media' : 'de los menos vulnerables';
    $('mun-ficha').innerHTML = `
      <div class="ficha2">
        <div class="ficha-map card"><div id="mun-map" class="fill-map"></div></div>
        <div class="ficha-body">
          <a class="back" href="#municipio">← Buscar otro municipio</a>
          <header class="fhead">
            <p class="eyebrow">${esc(COMARCA.get(m.codigo) || '')} · ${GRUPO[m.grupo]}</p>
            <h1>${esc(m.nombre)}</h1>
            <div class="fmeta">${m.lineas.map(chipLinea).join('')}<span>${m.dist_km != null ? nf(m.dist_km, 1) + ' km de Barcelona' : ''}</span><span>${nf(m.viajes_referencia)} viajes/día a BCN</span></div>
          </header>

          <section class="card fsec">
            <h2>Es ${frase}: <span class="hl">${m.rango_vulnerabilidad}.º de ${n}</span></h2>
            <p class="muted small">Cada barra es un municipio, ordenado de más a menos caída media en los cuatro días de caos.</p>
            <div id="mun-strip"></div>
          </section>

          <section class="card fsec">
            <h2>Si mañana pasa esto…</h2>
            <div class="scen2">${escen.map((e) => { const k = e.c ? claseDe(e.c.efecto) : 3; return `<a class="scen-card" href="#simulador?tipo=${e.t.id}&linea=${e.l}&mun=${m.codigo}">
              <span class="sic">${ICON[ICON_TIPO[e.t.id]]}</span><b>${esc(e.t.nombre)}</b>
              <span class="sval" style="background:${colClase(k)};color:${tintaSobre(k)}">${e.c ? pct(e.c.efecto, 0) : '≈ 0 %'}</span>
              <small>${e.c && e.perd < 0 ? `≈ ${nf(-e.perd)} viajes menos` : 'Sin impacto relevante'}${e.c && e.c.observado === false ? ' · extrapolado' : ''}</small>
              <span class="go">Ver rutas →</span></a>`; }).join('')}</div>
          </section>

          <section class="card fsec">
            <h2>Su historial: cómo le fue cada día de caos</h2>
            <div class="hist">${D.incidencias.map((i) => { const ef = m.efectos[i.fecha], k = ef ? claseDe(ef.efecto) : 3, claro = ef && ef.p < 0.05; return `<div class="htile ${claro ? '' : 'nc'}" style="--bg:${colClase(k)};--fg:${tintaSobre(k)}" data-tip="${esc(`${i.titulo}<br>${ef ? pct(ef.efecto) + ' · ' + pval(ef.p) : ''}`)}">
              <span class="hdate">${fecha(i.fecha).slice(0, 5)}<small>${fecha(i.fecha).slice(6)}</small></span><span class="hic">${ICON[i.tipo === 'Avería' ? 'rayo' : 'huelga']}</span>
              <strong>${ef ? pct(ef.efecto, 0) : '—'}</strong><small>${esc(i.tipo)} · ${claro ? 'efecto claro' : 'no concluyente'}</small></div>`; }).join('')}</div>
          </section>

          <section class="card fsec">
            <h2>Cómo llegar a Barcelona</h2>
            <div class="trips">${[['tren', `Rodalies ${m.lineas[0]}`, a.t_rodalies, a.salidas_h_rodalies, colorLinea(m.lineas[0])]].concat(a.mejor ? [[a.mejor === 'fgc' ? 'tren' : 'bus', cap(ALT_NOMBRE[a.mejor]), a.t_alt, a.salidas_h_alt, css('--route')]] : []).map(([ic, nom, t, s, col]) => {
              const mx = Math.max(a.t_rodalies || 0, a.t_alt || 0, 1);
              return `<div class="trip"><span class="ric">${ICON[ic]}</span><div class="tbody"><div class="tl"><b>${esc(nom)}</b><span><strong>${t != null ? nf(t) : '—'}</strong> min</span></div><div class="tbar"><i style="width:${(t || 0) / mx * 100}%;background:${col}"></i></div><div class="freq" data-tip="${esc(`${nf(s, 1)} salidas por hora`)}">${'<i></i>'.repeat(Math.min(Math.round(s || 0), 16))}<span>${s != null ? nf(s, 1) + ' salidas/h' : ''}</span></div></div></div>`; }).join('')}
              ${a.mejor ? '' : `<div class="trip none"><span class="ric">${ICON.casa}</span><div class="tbody"><b>Sin alternativa directa en transporte público</b><small class="muted">Si el tren falla, solo queda el coche o no viajar.</small></div></div>`}</div>
          </section>

          <section class="card fsec">
            <h2>Vulnerabilidad social</h2>
            ${m.vulnerabilidad ? `<div class="doors"><div><small>Motorización</small><strong>${nf(m.vulnerabilidad.motorizacion)}</strong><span>vehículos/1.000 hab.</span></div><div><small>Renta</small><strong>${nf(m.vulnerabilidad.renta)} €</strong><span>por persona</span></div></div>` : '<p class="pending small">Pendiente: motorización y renta (datos abiertos de Idescat). Al añadirlos, el índice combinará dependencia del tren, alternativa, motorización y renta.</p>'}
          </section>
        </div>
      </div>`;
    tira($('mun-strip'), orden, m);
    if (mun.F) mun.F.map.remove();
    mun.F = await mapaCoropletico('mun-map', { bounds: [[m.lat - 0.2, m.lon - 0.28], [m.lat + 0.2, m.lon + 0.28]], onClick: (x) => { location.hash = '#municipio/' + x.codigo; }, tip: (p, x) => x ? `<b>${esc(x.nombre)}</b><br><span class="muted">${pct(x.efecto_medio)} de media · clic para abrir</span>` : `<b>${esc(p.nombre)}</b>` });
    if (mun.F) {
      mun.F.pintar((x) => x.codigo === m.codigo ? css('--brand') : colorEf(x.efecto_medio, null, true));
      mun.F.vias((lid) => m.lineas.includes(lid) ? 'on' : 'dim');
      mun.F.resaltar(m.codigo);
      L.marker([m.lat, m.lon], { interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="bubble sel"><b>${esc(m.nombre)}</b></div>` }) }).addTo(mun.F.annos);
    }
  }

  /* Tira de los 62 municipios ordenados por efecto medio, con el elegido destacado. */
  function tira(el, orden, m) {
    const W = ancho(el), H = 92, L0 = 4, bw = (W - 8) / orden.length;
    const mn = Math.min(...orden.map((x) => x.efecto_medio)), mx = Math.max(...orden.map((x) => x.efecto_medio), 0);
    const y0 = 40, h = (v) => Math.abs(v) / Math.max(Math.abs(mn), mx) * 30;
    let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Posición en el índice">`;
    orden.forEach((x, i) => {
      const v = x.efecto_medio, yo = v < 0 ? y0 : y0 - h(v), sel = x.codigo === m.codigo;
      s += `<rect x="${L0 + i * bw + 0.5}" y="${yo}" width="${Math.max(bw - 1, 1)}" height="${Math.max(h(v), 1.5)}" rx="1.5" fill="${sel ? css('--brand') : colClase(claseDe(v))}" opacity="${sel ? 1 : 0.75}" data-tip="${esc(`${i + 1}.º ${x.nombre}: ${pct(v)}`)}"/>`;
      if (sel) s += `<text class="lbl" x="${Math.min(Math.max(L0 + i * bw + bw / 2, 30), W - 30)}" y="14" text-anchor="middle" style="font-weight:700">${esc(m.nombre)} · ${pct(v)}</text><line x1="${L0 + i * bw + bw / 2}" x2="${L0 + i * bw + bw / 2}" y1="18" y2="${y0 - 2}" stroke="${css('--brand')}" stroke-width="1.5"/>`;
    });
    s += `<line class="zero" x1="0" x2="${W}" y1="${y0}" y2="${y0}"/><text x="2" y="${H - 2}">Más vulnerable</text><text x="${W - 2}" y="${H - 2}" text-anchor="end">Menos vulnerable</text>`;
    el.innerHTML = s + '</svg>';
  }

  // ------------------------------------------------------------------ 4 · LABORATORIO
  let labListo = false, labMap = null;
  function initLaboratorio() {
    if (labListo) { labMap && labMap.refrescar(); return; } labListo = true;
    $('lab-nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lab]'); if (!b) return;
      document.querySelectorAll('#lab-nav button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.lab').forEach((x) => { x.hidden = x.id !== 'lab-' + b.dataset.lab; });
      if (b.dataset.lab === 'validacion') pintarValidacion();
      if (b.dataset.lab === 'factores') pintarFactores();
    });
    // Casos: línea de tiempo
    $('lab-casos').innerHTML = `<div class="timeline">
        <div class="tl-cards">${D.incidencias.map((i, k) => `<button class="tl-card ${k ? '' : 'active'}" data-i="${k}"><span class="tic">${ICON[i.tipo === 'Avería' ? 'rayo' : 'huelga']}</span><small>${fecha(i.fecha)} · ${esc(i.tipo)}</small><b>${esc(i.titulo)}</b><span class="${i.perdidos.efecto_pct < 0 ? 'down' : ''}">${pct(i.perdidos.efecto_pct)} en dependientes</span></button>`).join('')}</div></div>
      <div id="lab-caso" class="lab"></div>`;
    $('lab-casos').querySelector('.timeline').addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      $('lab-casos').querySelectorAll('[data-i]').forEach((x) => x.classList.toggle('active', x.dataset.i === b.dataset.i));
      caso(D.incidencias[+b.dataset.i]);
    });
    caso(D.incidencias[0]);
    pintarMetodo();
  }

  async function caso(i) {
    const p = i.perdidos, lin = i.lineas_dependientes.slice().sort((a, b) => a.efecto_pct - b.efecto_pct), peor = lin[0];
    const dep = i.grupos.find((g) => g.grupo === 'dependientes');
    $('lab-caso').innerHTML = `
      <div class="case-hero card">
        <div class="ch-text">
          <p class="eyebrow">${fecha(i.fecha)} · ${esc(i.tipo)}</p><h2>${esc(i.titulo)}</h2>
          <p>${esc(i.lectura)}</p>
          <div class="ch-kpis"><div><strong class="down">${pct(p.efecto_pct)}</strong><span>viajes de los dependientes</span></div><div><strong>${nf(p.viajes_perdidos)}</strong><span>viajes menos ese día</span></div><div><strong>${pval(p.p_valor).replace('p ', 'p ')}</strong><span>${p.p_valor < 0.05 ? 'efecto claro' : 'no concluyente'}</span></div></div>
          <details class="small"><summary>Qué pasó exactamente</summary><p>${esc(i.descripcion)}</p><p><b>Servicio:</b> ${esc(i.tramo)}</p></details>
        </div>
        <div class="ch-map"><div id="lab-map" class="fill-map"></div><div class="story-legend mini" id="legend-lab"></div></div>
      </div>
      <div class="lab-grid">
        <div class="card"><div class="card-head"><h2>${dep && dep.p_valor < 0.05 ? 'Solo caen los que dependen del tren' : 'Ningún grupo cae de forma clara'}</h2><small>Efecto por grupo de municipios e intervalo del 95 %</small></div><div class="pad" id="c-grupos"></div></div>
        <div class="card"><div class="card-head"><h2>${peor.p_valor < 0.05 ? `La ${esc(peor.linea)} es la que más cae` : 'Ninguna línea destaca con claridad'}</h2><small>Municipios dependientes, por línea</small></div><div class="pad" id="c-lineas"></div></div>
        <div class="card"><div class="card-head"><h2>El día del caos se sale del rango normal</h2><small>Índice de viajes (día normal = 100). Banda gris: lo habitual.</small></div><div class="pad" id="c-serie"></div></div>
        <div class="card"><div class="card-head"><h2>Por tramos de la red</h2><small>Punto: cambio ese día. Barra gris: lo que varía un día normal. Fuera de la barra = anómalo.</small></div><div class="pad" id="c-tramos"></div></div>
      </div>`;
    forest($('c-grupos'), i.grupos.map((g) => ({ label: GRUPO[g.grupo] + ` (${g.municipios})`, efecto: g.efecto_pct, ic_inf: g.ic_inf, ic_sup: g.ic_sup, p: g.p_valor })), { labelW: 190 });
    forest($('c-lineas'), i.lineas_dependientes.map((l) => ({ label: `${l.linea} (${l.municipios})`, efecto: l.efecto_pct, ic_inf: l.ic_inf, ic_sup: l.ic_sup, p: l.p_valor })), { labelW: 110 });
    const xs = i.serie.map((s) => fecha(s.fecha).slice(0, 5));
    lines($('c-serie'), xs, [
      { name: 'Dependientes', color: css('--down'), values: i.serie.map((s) => s.dependientes) },
      { name: 'Control (sin Rodalies)', color: css('--ink-2'), dash: true, values: i.serie.map((s) => s.control) },
    ], { band: { lo: i.serie.map(() => i.banda_normal.inf), hi: i.serie.map(() => i.banda_normal.sup) }, marks: i.serie.map((s, k) => (s.caos ? k : -1)).filter((k) => k >= 0), maxLabels: 7 });
    rangos($('c-tramos'), i.tramos);
    if (labMap) labMap.map.remove();
    labMap = await mapaCoropletico('lab-map', { fijo: true, tip: (pp, x) => x && x.efectos[i.fecha] ? `<b>${esc(x.nombre)}</b><br><span class="v ${x.efectos[i.fecha].efecto < 0 ? 'down' : ''}">${pct(x.efectos[i.fecha].efecto)}</span><span class="muted">${pval(x.efectos[i.fecha].p)}</span>` : `<b>${esc(pp.nombre)}</b>` });
    if (labMap) {
      labMap.pintar((x) => { const e = x.efectos[i.fecha]; return e ? colorEf(e.efecto, e.p) : css('--other'); });
      labMap.vias((lid) => (i.lineas.some((l) => l.replace(' ', '') === lid || l.replace(' Nord', 'N').replace(' Sud', 'S') === lid) ? 'cut' : 'on'));
      $('legend-lab').innerHTML = leyendaClasesHTML('Viajes a BCN ese día');
    }
  }

  /* Tramos: rango normal (barra) y valor del día (punto). */
  function rangos(el, tramos) {
    const W = ancho(el), L0 = Math.min(250, W * 0.45), R = 56, rowH = 30, H = tramos.length * rowH + 26;
    const vals = tramos.flatMap((t) => [t.cambio_pct, t.normal_inf, t.normal_sup]);
    const lo = Math.min(...vals, -10) - 2, hi = Math.max(...vals, 10) + 2, x = (v) => L0 + (v - lo) / (hi - lo) * (W - L0 - R);
    let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tramos">`;
    niceTicks(lo, hi, 5).forEach((t) => { s += `<line class="${t === 0 ? 'zero' : 'grid'}" x1="${x(t)}" x2="${x(t)}" y1="2" y2="${H - 20}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${nf(t)} %</text>`; });
    tramos.forEach((t, k) => {
      const y = 6 + k * rowH + rowH / 2, fuera = t.cambio_pct < t.normal_inf || t.cambio_pct > t.normal_sup;
      const lab = t.tramo.length > 38 ? t.tramo.slice(0, 37) + '…' : t.tramo;
      s += `<text class="lbl" x="${L0 - 10}" y="${y + 4}" text-anchor="end">${esc(lab)}</text>`;
      s += `<rect x="${x(t.normal_inf)}" y="${y - 6}" width="${x(t.normal_sup) - x(t.normal_inf)}" height="12" rx="6" fill="${css('--neutral')}" opacity=".5"/>`;
      s += `<circle cx="${x(t.cambio_pct)}" cy="${y}" r="${fuera ? 7 : 5}" fill="${fuera ? colClase(claseDe(t.cambio_pct)) : css('--surface')}" stroke="${fuera ? css('--surface') : css('--ink-2')}" stroke-width="2"/>`;
      s += `<text class="val" x="${W - R + 8}" y="${y + 4}">${pct(t.cambio_pct)}</text>`;
      s += `<rect class="hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" data-tip="${esc(`<b>${esc(t.tramo)}</b><br>${pct(t.cambio_pct)} (normal: ${nf(t.normal_inf, 1)} a ${nf(t.normal_sup, 1)} %)<br>${t.municipios} municipios: ${esc(t.lista)}`)}"/>`;
    });
    el.innerHTML = s + '</svg>';
  }

  let valListo = false;
  function pintarValidacion() {
    if (valListo) return; valListo = true;
    const v = D.placebo.valores_pct, real = D.placebo.real_pct, menos = v.filter((x) => x <= real).length;
    $('lab-validacion').innerHTML = `<div class="lab-grid">
      <div class="card"><div class="card-head"><h2>${menos === 0 ? `Ninguno de los ${v.length} grupos de días al azar da` : `Solo ${menos} de ${v.length} grupos de días al azar dan`} una caída tan grande</h2><small>Prueba placebo: grupos de días normales tratados como si fueran días de caos. Si el efecto fuera casualidad, la línea azul caería dentro de la nube gris.</small></div><div class="pad" id="lab-placebo"></div></div>
      <div class="card"><div class="card-head"><h2>Antes, nada. El día 0, la caída. Después, normalidad.</h2><small>Event study: efecto en los dependientes cada día alrededor del caos. Los días previos ≈ 0 validan la comparación.</small></div><div class="pad" id="lab-evento"></div></div></div>`;
    histogram($('lab-placebo'), v, real);
    eventStudy($('lab-evento'), D.evento);
  }

  let facListo = false;
  function pintarFactores() {
    if (facListo) return; facListo = true;
    const alt = D.alternativa, dias = [...new Set(alt.map((a) => a.dia))], grupos = ['Sin alternativa directa', 'Alternativa débil', 'Alternativa fuerte'];
    const lejos = D.distancia[D.distancia.length - 1];
    $('lab-factores').innerHTML = `<div class="lab-grid">
      <div class="card"><div class="card-head"><h2>Cuanto más lejos, más cae: ${pct(lejos.efecto_pct)} a ${esc(lejos.banda)}</h2><small>Municipios con Rodalies, todos los días de caos</small></div><div class="pad" id="lab-dist"></div></div>
      <div class="card"><div class="card-head"><h2>Donde hay metro o FGC, no pasa nada</h2><small>Efecto por grupo, todos los días de caos</small></div><div class="pad" id="lab-grupos"></div></div>
      <div class="card wide2"><div class="card-head"><h2>Sin alternativa al tren, la caída se repite en cada incidencia</h2><small>Efecto según la alternativa en transporte público (GTFS). Color intenso: efecto claro (p &lt; 0,05). Pasa el cursor para ver el intervalo.</small></div>
        <div class="pad"><table class="heat"><thead><tr><th></th>${grupos.map((g) => `<th>${g}</th>`).join('')}</tr></thead><tbody>${dias.map((d) => `<tr><th>${esc(d)}</th>${grupos.map((g) => { const x = alt.find((a) => a.dia === d && a.grupo === g); if (!x) return '<td></td>'; const k = claseDe(x.efecto), cl = x.p_cluster < 0.05; return `<td style="--bg:${cl ? colClase(k) : 'var(--surface-2)'};--fg:${cl ? tintaSobre(k) : 'var(--muted)'}" data-tip="${esc(`<b>${g}</b>, ${d}<br>${pct(x.efecto)} [${pct(x.ic_inf)}, ${pct(x.ic_sup)}]<br>p = ${nf(x.p_cluster, 3)} · ${x.municipios} municipios`)}">${pct(x.efecto)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>
      <details class="card wide2 det"><summary>Modelo con distancia y alternativa a la vez</summary><div class="table-wrap"><table class="tbl"><thead><tr><th>Días</th><th>Variable</th><th class="num">Efecto</th><th class="num">IC 95 %</th><th class="num">p</th></tr></thead><tbody>${D.distancia_alternativa.map((x) => `<tr class="${x.p >= 0.05 ? 'ns' : ''}"><td>${esc(x.dias)}</td><td>${esc(x.variable)}</td><td class="num">${pct(x.efecto)}</td><td class="num">${esc(x.IC95)}</td><td class="num">${nf(x.p, 3)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
    forest($('lab-dist'), D.distancia.map((g) => ({ label: g.banda + ` (${g.municipios})`, efecto: g.efecto_pct, ic_inf: g.ic_inf, ic_sup: g.ic_sup, p: g.p_valor })), { labelW: 120 });
    forest($('lab-grupos'), D.grupos.map((g) => ({ label: g.etiqueta.replace(/ \(.*\)/, ''), efecto: g.efecto_pct, ic_inf: g.ic_inf, ic_sup: g.ic_sup, p: g.p_valor })), { labelW: 170 });
  }

  function pintarMetodo() {
    const titulos = { comparacion: ['Con qué se compara', 'calendario'], efecto: ['Cómo se mide el efecto', 'rayo'], tramos: ['Tramos de la red', 'tren'], perdidos: ['Viajes perdidos', 'bus'], placebo: ['Prueba placebo', 'huelga'], barrios: ['Barrios (M3)', 'casa'] };
    $('lab-metodo').innerHTML = `
      <div class="method-grid">${Object.entries(D.metodo).map(([k, v]) => `<div class="card mcard"><span class="ric">${ICON[(titulos[k] || ['', 'lupa'])[1]]}</span><h3>${(titulos[k] || [k])[0]}</h3><p>${esc(v)}</p></div>`).join('')}</div>
      <div class="lab-grid">
        <div class="card"><div class="card-head"><h2>Decisiones sobre los datos</h2></div><ul class="checks">
          <li><b>Datos:</b> Telefónica (M2 municipio → Barcelona y M3 municipio ↔ barrio), ${fecha(D.periodo.inicio)} – ${fecha(D.periodo.fin)}.</li>
          <li><b>Días normales:</b> laborables sin festivos, verano, eventos, lluvia ni incidencias del registro oficial de Rodalies.</li>
          <li><b>Días de caos:</b> ${D.incidencias.map((i) => fecha(i.fecha)).join(', ')}. El 19/03/2025 se excluye por lluvia.</li>
          <li><b>Municipios:</b> ≥ 200 viajes/día a Barcelona. Dependientes: con Rodalies, sin metro ni FGC y a ≥ 20 km.</li>
          <li><b>Alternativa:</b> GTFS de bus interurbano, AMB, FGC y Rodalies (tiempo puerta a puerta y frecuencia).</li>
          <li><b>Simulador:</b> viajes de un día normal × coeficiente del escenario. La avería solo se ha observado en la R1.</li></ul></div>
        <div class="card"><div class="card-head"><h2>Limitaciones</h2></div><ul class="checks warn">${D.limitaciones.map((l) => `<li>${esc(l)}</li>`).join('')}<li>${esc(D.duracion.pendiente)}</li></ul></div>
      </div>`;
  }

  // ------------------------------------------------------------------ navegación
  function route() {
    const [ruta, qs] = location.hash.replace('#', '').split('?');
    const [modo, arg] = (ruta || 'relato').split('/');
    const valido = ['relato', 'simulador', 'municipio', 'laboratorio'].includes(modo) ? modo : 'relato';
    document.querySelectorAll('.mode').forEach((s) => { s.hidden = s.id !== 'mode-' + valido; });
    document.querySelectorAll('.modes a').forEach((a) => a.classList.toggle('active', a.dataset.mode === valido));
    document.body.dataset.modo = valido;
    if (valido !== 'relato' && valido !== 'municipio') scrollTo(0, 0);
    ({ relato: initRelato, simulador: () => initSimulador(qs ? new URLSearchParams(qs) : null), municipio: () => initMunicipio(arg), laboratorio: initLaboratorio })[valido]();
  }

  Promise.all([
    fetch(DATA_URL).then((r) => { if (!r.ok) throw new Error('observatorio.json'); return r.json(); }),
    fetch(RAIL_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([d, rail]) => {
    D = d; RAIL = rail;
    PC = new Map(D.municipios.map((m) => [m.codigo, m]));
    if (!RAIL) $('status').textContent = 'No se ha encontrado la cartografía de Rodalies (../dashboard/railway-network.geojson): los mapas se muestran sin la red.';
    $('foot').textContent = `${D.fuente} · ${fecha(D.periodo.inicio)} – ${fecha(D.periodo.fin)}. Observatorio R-MOVE v2 · Team 202_E.`;
    cargarBase().then((b) => { b.features.forEach((f) => COMARCA.set(f.properties.codigo, f.properties.comarca)); }).catch(() => {});
    addEventListener('hashchange', route);
    route();
  }).catch((e) => {
    $('status').innerHTML = `No se han podido cargar los datos (${esc(e.message)}). Ejecuta <code>python src/dashboard-v2/build_observatorio.py</code> y sirve el repositorio desde la raíz con <code>python -m http.server 8000</code>.`;
  });
})();
