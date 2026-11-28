/* Observatorio R-MOVE · dashboard v2
 * Tres modos: relato (scrollytelling), planificador (escenarios «¿Y si…?» + ficha de cada municipio) y laboratorio.
 * Solo lee data/processed/rmove/observatorio/observatorio.json (generado por build_observatorio.py a partir de
 * los resultados del clustering del notebook 03) y la red de Rodalies. No recalcula modelos: consulta coeficientes ya estimados.
 */
(function () {
  'use strict';

  const DATA_URL = '../../data/processed/rmove/observatorio/observatorio.json';
  const RAIL_URL = 'railway-network.geojson';
  const CONTORNO_URL = '../../data/processed/rmove/observatorio/catalunya_contorno.geojson';
  const BCN = [41.3870, 2.1700];
  const BOUNDS = [[41.17, 1.62], [42.05, 2.82]];
  const FECHAS = { averia: '2024-05-13', huelga: '2025-03-17', anunciadas: ['2025-03-26', '2025-04-01'] };
  const GRUPO = { dependientes: 'Dependiente', cercanos: 'Cercano sin metro/FGC', metro_fgc: 'Con metro/FGC' };
  const ALT_NOMBRE = { bus_interurbano: 'bus interurbano', fgc: 'FGC', amb: 'bus AMB' };
  const LINEAS_SIM = ['R1', 'R2N', 'R2S', 'R3', 'R4', 'R7'];

  let D = null, RAIL = null, CONTORNO = null;
  const maps = {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ formato
  const nf = (x, d = 0) => x == null || isNaN(x) ? '—' : Number(x).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' }).replace('-', '−');
  const pct = (x, d = 1) => { if (x == null) return '—'; const r = Number(x.toFixed(d)); return r === 0 ? '≈ 0 %' : (r > 0 ? '+' : '') + nf(r, d) + ' %'; };
  const pval = (p) => p == null ? '' : p < 0.001 ? 'p < 0,001' : 'p = ' + nf(p, 3);
  const fecha = (f) => { const [y, m, d] = f.split('-'); return `${d}/${m}/${y}`; };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const fechaLarga = (f) => { const [y, m, d] = f.split('-'); return `${+d} de ${MESES[+m - 1]} de ${y}`; };
  /* Líneas de la red (ids del geojson) afectadas por una avería de una línea */
  const VIAS_LINEA = { R2S: ['R2S'], R2N: ['R2N'], R4N: ['R4'], R4S: ['R4'], R1: ['R1'], R3: ['R3'] };
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
      s += `<g class="row" style="--k:${i}">`;
      s += `<text class="lbl" x="${L - 10}" y="${y + 4}" text-anchor="end">${esc(r.label)}</text>`;
      s += `<rect class="bar${e < 0 ? ' neg' : ''}" x="${x0}" y="${y - 7}" width="${w}" height="14" rx="4" fill="${col}" opacity="${sig ? 1 : 0.45}"/>`;
      if (r.ic_inf != null) s += `<g class="fade"><line class="ci" x1="${x(r.ic_inf)}" x2="${x(r.ic_sup)}" y1="${y}" y2="${y}"/><line class="ci" x1="${x(r.ic_inf)}" x2="${x(r.ic_inf)}" y1="${y - 5}" y2="${y + 5}"/><line class="ci" x1="${x(r.ic_sup)}" x2="${x(r.ic_sup)}" y1="${y - 5}" y2="${y + 5}"/></g>`;
      const vx = Math.max(x(e), r.ic_sup != null ? x(r.ic_sup) : 0, x(0)) + 6;
      s += `<text class="val fade" x="${vx}" y="${y + 4}">${pct(e)}${sig ? '' : ' ·ns'}</text>`;
      const t = r.tip || `<b>${esc(r.label)}</b><br>${pct(e)}${r.ic_inf != null ? ` [${pct(r.ic_inf)}, ${pct(r.ic_sup)}]` : ''}${r.p != null ? '<br>' + pval(r.p) : ''}`;
      s += `<rect class="hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" data-tip="${esc(t)}"/></g>`;
    });
    el.innerHTML = s + '</svg>' + (o.nota ? `<p class="muted" style="font-size:12px;margin:4px 0 0">${o.nota}</p>` : '');
    animar(el);
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
      s += `<polygon class="fade" points="${up.concat(dn).join(' ')}" fill="${css('--neutral')}" opacity=".35"/>`;
    }
    (o.marks || []).forEach((i) => { s += `<line class="fade" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="${css('--brand')}" stroke-dasharray="3 3"/>`; });
    series.forEach((se) => {
      let d = '', pen = false;
      se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i) + ',' + y(v); pen = true; });
      // Las líneas continuas se «dibujan» al entrar; las discontinuas aparecen con un fundido (conservan su trazo).
      s += se.dash ? `<path class="fade" d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-dasharray="5 4"/>`
        : `<path class="ln" pathLength="1" d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      se.values.forEach((v, i) => { if (v != null && (o.dots || (o.marks || []).includes(i))) s += `<circle class="pop" style="--k:${i}" cx="${x(i)}" cy="${y(v)}" r="4" fill="${se.color}" stroke="${css('--surface')}" stroke-width="2"/>`; });
    });
    const step = Math.ceil(xs.length / (o.maxLabels || 8));
    const mk = o.marks || [];
    xs.forEach((lab, i) => { const cerca = mk.some((k) => k !== i && Math.abs(k - i) < step); if ((i % step === 0 && !cerca) || mk.includes(i)) s += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(lab)}</text>`; });
    xs.forEach((lab, i) => {
      const t = `<b>${esc(lab)}</b>` + series.map((se) => se.values[i] == null ? '' : `<br><span class="dot" style="background:${se.color}"></span>${esc(se.name)}: ${nf(se.values[i], 1)}${o.unit || ''}`).join('') +
        (o.band ? `<br>Rango normal: ${nf(o.band.lo[i], 1)} – ${nf(o.band.hi[i], 1)}${o.unit || ''}` : '');
      const w = (W - L - R) / Math.max(xs.length - 1, 1);
      // Capa de hover: línea guía vertical y puntos resaltados en el día bajo el cursor (va justo después de su zona activa).
      const pts = series.map((se) => se.values[i] == null ? '' : `<circle cx="${x(i)}" cy="${y(se.values[i])}" r="4.5" fill="${se.color}" stroke="${css('--surface')}" stroke-width="2"/>`).join('');
      s += `<rect class="hit" x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - T - B}" data-tip="${esc(t)}"/>` +
        `<g class="xh"><line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/>${pts}</g>`;
    });
    if (series.length > 1) s += series.map((se, k) => `<g transform="translate(${L + 4 + k * 150},${T + 2})"><line x1="0" x2="16" y1="0" y2="0" stroke="${se.color}" stroke-width="2" ${se.dash ? 'stroke-dasharray="5 4"' : ''}/><text class="lbl" x="22" y="4">${esc(se.name)}</text></g>`).join('');
    el.innerHTML = s + '</svg>';
    animar(el);
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
      if (e.ic_inf != null) s += `<line class="fade" style="--k:${i}" x1="${x(i)}" x2="${x(i)}" y1="${y(e.ic_inf)}" y2="${y(e.ic_sup)}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;
      s += `<circle class="pop" style="--k:${i}" cx="${x(i)}" cy="${y(e.efecto_pct)}" r="${e.dia === 0 ? 6 : 4.5}" fill="${c}" stroke="${css('--surface')}" stroke-width="2"/>`;
      s += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" ${e.dia === 0 ? 'class="lbl"' : ''}>${e.dia === 0 ? 'Día 0' : (e.dia > 0 ? '+' : '') + e.dia}</text>`;
      s += `<rect class="hit" x="${x(i) - 20}" y="${T}" width="40" height="${H - T - B}" data-tip="${esc(`<b>Día ${e.dia}</b><br>${pct(e.efecto_pct)}${e.ic_inf != null ? ` [${pct(e.ic_inf)}, ${pct(e.ic_sup)}]` : ''}`)}"/>` +
        `<g class="xh"><line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/></g>`;
    });
    el.innerHTML = s + '</svg>';
    animar(el);
  }

  function histogram(el, valores, real) {
    const W = ancho(el), H = 200, L = 36, R = 14, T = 10, B = 30, nb = 24;
    const lo = Math.min(...valores, real) - 0.5, hi = Math.max(...valores, real) + 0.5, bw = (hi - lo) / nb;
    const bins = Array(nb).fill(0); valores.forEach((v) => bins[Math.min(nb - 1, Math.floor((v - lo) / bw))]++);
    const mx = Math.max(...bins), x = (v) => L + (v - lo) / (hi - lo) * (W - L - R), y = (c) => T + (1 - c / mx) * (H - T - B);
    let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Placebo">`;
    niceTicks(lo, hi, 6).forEach((t) => { s += `<text x="${x(t)}" y="${H - 10}" text-anchor="middle">${nf(t)} %</text>`; });
    bins.forEach((c, i) => { if (!c) return; const a = lo + i * bw; s += `<rect class="col" style="--k:${i}" x="${x(a) + 1}" y="${y(c)}" width="${x(a + bw) - x(a) - 2}" height="${H - B - y(c)}" rx="2" fill="${css('--neutral')}" data-tip="${esc(`${nf(a, 1)} a ${nf(a + bw, 1)} %: ${c} placebos`)}"/>`; });
    s += `<g class="fade" style="--k:${nb}"><line x1="${x(real)}" x2="${x(real)}" y1="${T}" y2="${H - B}" stroke="${css('--down')}" stroke-width="2.5"/><text class="lbl" x="${x(real) + 6}" y="${T + 12}">Días de caos reales: ${pct(real)}</text></g>`;
    el.innerHTML = s + '</svg>';
    animar(el);
  }

  function ancho(el) { return Math.max(el.clientWidth || 560, 300); }

  /* Animación de entrada: el gráfico se «construye» (barras que crecen, líneas que se dibujan, puntos que aparecen)
   * cuando entra en pantalla. Sin IntersectionObserver o con «reducir movimiento» se muestra directamente. */
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');
  const obsGraf = 'IntersectionObserver' in window
    ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); obsGraf.unobserve(e.target); } }), { threshold: 0.2 })
    : null;
  function animar(el) {
    const svg = el.querySelector('svg.viz');
    if (!svg || !obsGraf || sinMovimiento.matches) return;
    svg.classList.add('anim');
    obsGraf.observe(svg);
  }

  /* Cifras grandes que «cuentan» hasta su valor al aparecer (conserva signo, decimales, miles y sufijo). */
  const CIFRAS = '.big-stat strong,.doors strong,.pp-impact strong,.kpi strong,.ch-kpis strong,.rank strong,.htile strong,.sval,.pp-eff strong,.pp-kpis strong,.scen strong,.facts strong';
  const NUM_RE = /([−+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(,\d+)?/;
  function contar(el) {
    if (el.dataset.contado === el.textContent || el.childElementCount) return;
    const txt = el.textContent, m = txt.match(NUM_RE);
    if (!m) return;
    const dec = m[3] ? m[3].length - 1 : 0, fin = Number(m[2].replace(/\./g, '') + (m[3] ? '.' + m[3].slice(1) : ''));
    if (!isFinite(fin) || fin === 0) return;
    const antes = txt.slice(0, m.index) + m[1], despues = txt.slice(m.index + m[0].length), t0 = performance.now(), dur = 650;
    el.dataset.contado = txt;
    const paso = (t) => {
      if (el.dataset.contado !== txt) return; // otro render lo ha sustituido
      const k = Math.min((t - t0) / dur, 1), v = fin * (1 - Math.pow(1 - k, 3));
      el.textContent = k < 1 ? antes + nf(v, dec) + despues : txt;
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
  if (obsGraf && !sinMovimiento.matches && 'MutationObserver' in window) {
    const obsCifra = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { obsCifra.unobserve(e.target); contar(e.target); } }), { threshold: 0.6 });
    new MutationObserver((ms) => ms.forEach((mu) => mu.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches(CIFRAS)) obsCifra.observe(n);
      n.querySelectorAll(CIFRAS).forEach((c) => obsCifra.observe(c));
    }))).observe(document.body, { childList: true, subtree: true });
  }

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
    // Totales sobre los dependientes (donde el efecto está establecido), como en el análisis por municipios.
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
    { max: 10, label: 'Suben entre un 3 y un 10 %' },
    { max: Infinity, label: 'Suben más del 10 %' },
  ];
  const claseDe = (e) => CLASES.findIndex((c) => e <= c.max);
  /* En los mapas, «sin cambio claro» no se destaca: se pinta con el gris neutro de los municipios no afectados.
   * Las dos clases de subida comparten un mismo azul (--c4 = --c5 en el CSS) y en la leyenda son una sola entrada. */
  const colMapa = (k) => (k === 3 ? css('--other') : colClase(k));
  const itemsClases = (sinSubidas = false) => [0, 1, 2].map((i) => [i, CLASES[i].label]).concat(sinSubidas ? [] : [[4, 'Suben más del 3 %']])
    .map(([i, t]) => `<li><span class="sw" style="background:${colClase(i)}"></span>${t}</li>`).join('');
  const colClase = (i) => css('--c' + i);
  /* Efecto sin significación estadística: rayado en el color de su clase (en vez de un color más suave, que se
   * confundía con la clase siguiente). Los patrones viven en un <svg> oculto y los mapas los usan con url(#…). */
  const rayado = (i) => `url(#rayas-${i})`;
  function crearRayados() {
    if (document.getElementById('rayados')) return;
    const fondo = css('--surface');
    const pats = CLASES.map((c, i) => `<pattern id="rayas-${i}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${fondo}"/><rect width="3.5" height="7" fill="${colClase(i)}"/></pattern>`).join('');
    document.body.insertAdjacentHTML('beforeend', `<svg id="rayados" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${pats}</defs></svg>`);
  }
  const swRayado = (i) => `<span class="sw" style="background:repeating-linear-gradient(135deg,${colClase(i)} 0 3px,${css('--surface')} 3px 6px)"></span>`;
  const leyendaRayado = `<li>${swRayado(1)}Rayado: sin efecto estadísticamente claro</li>`;
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
    const anun = D.barrios.filter((b) => b.caso === 'Huelga 26/03/2025' && b.sentido === 'ida');
    const avg = (k) => anun.reduce((s, b) => s + b[k], 0) / anun.length;
    $('r-puertas').innerHTML = `<div><small>Barrios con estación</small><strong class="down">${pct(avg('con_estacion'))}</strong></div>` +
      `<div><small>Barrios sin estación</small><strong class="${avg('sin_estacion') < 0 ? 'down' : 'up'}">${pct(avg('sin_estacion'))}</strong></div>`;
    eventStudy($('r-evento'), D.evento);
    const avs = (D.averias || []).slice().sort((a, b) => a.perdidos.efecto_pct - b.perdidos.efecto_pct);
    story.averia = avs[0] || null;
    if (!story.averia) $('r-paso-linea').remove();
    else {
      const a = story.averia, otras = avs.slice(1).filter((x) => x.perdidos.p_valor < 0.05);
      $('r-linea-ey').textContent = `${fechaLarga(a.fecha)} · ${a.titulo}`;
      $('r-linea').textContent = pct(a.perdidos.efecto_pct);
      $('r-linea-txt').textContent = `viajes a Barcelona desde los municipios que dependen de la ${a.linea_nombre}`;
      $('r-linea-p').innerHTML = `Los que dependen de otras líneas no cambian (<strong>${pct(a.resto.efecto_pct)}</strong>).` +
        otras.map((x) => ` Con la avería del ${fecha(x.fecha)} (${esc(x.titulo.charAt(0).toLowerCase() + x.titulo.slice(1))}) pasó lo mismo en la ${esc(x.linea_nombre)}: <strong>${pct(x.perdidos.efecto_pct)}</strong>.`).join('');
    }
    const br = D.alternativa.filter((a) => a.dia === 'Todos los días de caos');
    const nom = { 'Sin alternativa directa': 'sin alternativa', 'Alternativa débil': 'débil', 'Alternativa fuerte': 'fuerte' };
    const mx = Math.max(...br.map((a) => Math.abs(a.efecto)));
    $('r-brecha').innerHTML = br.map((a) => `<div class="bar-row" data-tip="${esc(`<b>${a.grupo}</b> (${a.municipios} municipios)<br>${pct(a.efecto)} [${pct(a.ic_inf)}, ${pct(a.ic_sup)}]`)}"><span>${cap(nom[a.grupo])}</span><span class="track"><i style="width:${Math.abs(a.efecto) / mx * 100}%;background:${css(ALT_COL[nom[a.grupo]])}"></i></span><b>${pct(a.efecto)}</b></div>`).join('');
    const VR = D.vulnerabilidad_resumen;
    if (VR) {
      // Brecha por motorización: dependientes por terciles de turismos por 1.000 hab. (notebook 05)
      const tm = VR.terciles_motorizacion, mxc = Math.max(...tm.map((t) => Math.abs(t.efecto)));
      const nomT = { baja: 'Pocos coches', media: 'Intermedio', alta: 'Muchos coches' };
      $('r-brecha-tit').innerHTML = 'Quien no tiene alternativa al tren… <b>ni coche.</b>';
      $('r-brecha-coche').innerHTML = tm.map((t) => `<div class="bar-row" data-tip="${esc(`<b>${nomT[t.nivel]}</b>: ${nf(t.min)}–${nf(t.max)} turismos por 1.000 hab. (${t.municipios} municipios)<br>${pct(t.efecto)} [${pct(t.ic_inf)}, ${pct(t.ic_sup)}]`)}"><span>${nomT[t.nivel]}</span><span class="track"><i style="width:${Math.abs(t.efecto) / mxc * 100}%;background:${colClase(claseDe(t.efecto))}"></i></span><b>${pct(t.efecto)}</b></div>`).join('');
      const mot = VR.modelo.find((x) => x.variable === 'tur100');
      $('r-coche-nota').textContent = `Efecto medio en los días de caos. A igual distancia y alternativa, cada 100 turismos más por 1.000 habitantes son ${nf(mot.coef_pp, 1)} puntos menos de caída. La renta, en conjunto, no marca diferencias.`;
      $('r-coche').hidden = false;
      $('r-pendiente').hidden = true;
    }

    $('r-empezar').addEventListener('click', () => { const sig = document.querySelectorAll('.step')[1]; if (sig) sig.scrollIntoView({ behavior: 'smooth', block: 'center' }); });

    const steps = [...document.querySelectorAll('.step')];

    cargarBase().then((base) => {
      montarMapaRelato(base);
      const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) activarPaso(e.target); }), { rootMargin: '-50% 0px -50% 0px' });
      steps.forEach((s) => io.observe(s));
      activarPaso(steps[0]);
    }).catch(() => { $('status').innerHTML = 'Falta la cartografía del relato. Ejecuta <code>python src/dashboard-v2/build_contorno.py</code>.'; });
  }

  function montarMapaRelato(base) {
    if (!window.L) { $('status').textContent = 'No se ha podido cargar Leaflet: el mapa necesita conexión a Internet.'; return; }
    // Zoom con los botones, doble clic, arrastrando o Ctrl + rueda. La rueda sola sigue moviendo el relato.
    const map = L.map('map-relato', { zoomControl: true, scrollWheelZoom: false, dragging: true, doubleClickZoom: true, boxZoom: false, keyboard: false, touchZoom: true, zoomSnap: 0.1, attributionControl: true });
    map.zoomControl.setPosition('bottomright');
    map.getContainer().addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      map.setZoomAround(map.mouseEventToContainerPoint(e), map.getZoom() + (e.deltaY < 0 ? 0.5 : -0.5));
    }, { passive: false });
    map.attributionControl.setPrefix('').addAttribution('Límites: ICGC · Red: GTFS Renfe · Datos: Telefónica');
    map.createPane('rail'); map.getPane('rail').style.zIndex = 450; map.getPane('rail').style.pointerEvents = 'none';
    const porCodigo = new Map(D.municipios.map((m) => [m.codigo, m]));
    story.capas = new Map();
    const hover = hoverUnico(map);
    story.base = L.geoJSON(base, {
      style: () => ({ color: css('--land-edge'), weight: 0.6, fillColor: css('--land'), fillOpacity: 1 }),
      onEachFeature: (f, layer) => {
        story.capas.set(f.properties.codigo, layer);
        hover(layer);
        tipFlexible(layer, () => tipRelato(f.properties, porCodigo.get(f.properties.codigo)));
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
    contornoCatalunya(map);
    paradasRodalies(map);
    story.annos = L.layerGroup().addTo(map);
    story.map = map;
    story.porCodigo = porCodigo;
    map.on('moveend zoomend resize', sombraRelato);
    map.fitBounds(BOUNDS_STORY, encuadre());
    sombraRelato();
  }

  /* Sombra de la zona del texto: un degradado en diagonal (113°, paralelo al límite oeste de la provincia) que acaba
   * justo antes de lo importante del mapa que está en pantalla (municipios del análisis, Barcelona y líneas de
   * Rodalies), para que no lo oscurezca. Se recalcula cuando el mapa se mueve; el CSS anima el cambio (--sombra). */
  function sombraRelato() {
    const st = document.querySelector('.story-stage'), map = story && story.map;
    if (!map || !st) return;
    const W = st.clientWidth, H = st.clientHeight, t = 113 * Math.PI / 180, s = Math.sin(t), c = -Math.cos(t);
    const largo = W * Math.abs(s) + H * Math.abs(c);
    let fin = largo * 0.56;   // como mucho, la sombra de la portada
    const mira = (ll) => {
      if (Array.isArray(ll)) return ll.forEach(mira);
      const p = map.latLngToContainerPoint(ll);
      if (p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H) fin = Math.min(fin, (p.x - W / 2) * s + (p.y - H / 2) * c + largo / 2);
    };
    story.capas.forEach((layer, cod) => { if (PC.has(cod) || cod === BCN_COD) mira(layer.getLatLngs()); });
    story.rail.forEach((r) => r.linea.eachLayer((l) => mira(l.getLatLngs())));
    // Sin recuadros, el texto del paso activo va directamente sobre la sombra: debajo de él tiene que estar casi
    // opaca (≥ 88 %, FUNDIDO_TEXTO px antes del final del fundido). Se mide el texto de verdad, no la caja del paso, y se
    // supone el paso centrado en pantalla, que es como queda cuando se activa.
    const txt = textoDelPaso(document.querySelector('.step.is-active .step-inner'));
    if (txt && innerWidth > 900) {
      const yb = Math.min(H, H / 2 + txt.alto / 2);
      fin = Math.max(fin - 12, (txt.derecha + 20 - W / 2) * s + (yb - H / 2) * c + largo / 2 + FUNDIDO_TEXTO) + 12;
    }
    st.style.setProperty('--sombra', `${Math.round(Math.max(0, fin - 12))}px`);
  }
  /* Extensión del texto de un paso: borde derecho de las líneas de texto (y de barras y gráficos) y su alto. */
  function textoDelPaso(el) {
    if (!el) return null;
    let derecha = 0;
    const rg = document.createRange(), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) derecha = Math.max(derecha, r.right);
    }
    el.querySelectorAll('.track, svg, .btn').forEach((x) => { derecha = Math.max(derecha, x.getBoundingClientRect().right); });
    return derecha ? { derecha, alto: el.getBoundingClientRect().height } : null;
  }

  const FUNDIDO_TEXTO = 120;   // px entre el texto y el final de la sombra (ver .story-stage::after en el CSS)
  /* Hueco a la izquierda para el texto del paso activo y el fundido de la sombra: el mapa empieza a la derecha de
   * los dos, así la sombra no oscurece nada de lo que se encuadra. Sin texto medido, el ancho de un paso (500 px). */
  function encuadre() {
    const ancho = innerWidth;
    if (ancho <= 900) return { paddingTopLeft: [12, 12], paddingBottomRight: [12, Math.round(innerHeight * 0.5)] };
    const txt = textoDelPaso(document.querySelector('.step.is-active .step-inner'));
    const derecha = txt ? txt.derecha : Math.max(40, (ancho - 1520) / 2 + 40) + 500;
    return { paddingTopLeft: [Math.round(derecha + FUNDIDO_TEXTO + 50), 30], paddingBottomRight: [70, 30] };
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
    if (paso === 'linea' && story.averia) extra = ef([story.averia.fecha]);
    if (paso === 'brecha') extra = `<span class="v">${cap(m.alternativa ? m.alternativa.clase : '—')}</span><span class="muted">${m.alternativa && m.alternativa.mejor ? `${cap(ALT_NOMBRE[m.alternativa.mejor])}: ${nf(m.alternativa.t_alt)} min (tren: ${nf(m.alternativa.t_rodalies)} min)` : 'alternativa en transporte público'}</span>${m.vulnerabilidad ? `<span class="muted">${nf(m.vulnerabilidad.motorizacion)} turismos por 1.000 hab. (motorización ${m.vulnerabilidad.nivel_motorizacion})</span>` : ''}`;
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
    sombraRelato();   // la sombra depende también del texto del paso activo
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
      if (k >= 4 && !claro) return colMapa(3);
      return claro || k === 3 ? colMapa(k) : rayado(k);
    };
    const leyendaClases = (titulo) => `<h4>${titulo}</h4><ul>${itemsClases()}${leyendaRayado}</ul><p class="note">Viajes a Barcelona frente a un día normal. Pasa el cursor por un municipio para ver el detalle.</p>`;
    const lineaLeyenda = (txt, dash) => `<li><span class="ln" style="border-top-style:${dash ? 'dotted' : 'solid'};border-color:${css('--ink-2')}"></span>${txt}</li>`;
    S.annos.clearLayers();

    switch (paso) {
      case 'averia':
        relleno = porClase([FECHAS.averia]);
        rail = (id) => id === 'R1' ? 'cut' : 'on';
        bounds = [[41.36, 2.02], [41.75, 2.80]];
        leyenda = leyendaClases('13/05/2024 · Avería R1');
        anno(41.4836, 2.1878, 'Robo de cobre<small>Montcada Bifurcació</small>', 'alert');
        { const n = D.incidencias.find((i) => i.fecha === FECHAS.averia).tramos.find((t) => /norte de Arenys/.test(t.tramo));
          anno(41.6137, 2.6547, `<b>${pct(n ? n.cambio_pct : null, 0)}</b>Maresme norte<small>sin tren al norte de Arenys</small>`); }
        anno(41.5381, 2.4447, `<b>${pct(efectoMun('Mataró', [FECHAS.averia]), 0)}</b>Mataró<small>con bus a Barcelona</small>`);
        break;
      case 'huelga':
        relleno = porClase([FECHAS.huelga]);
        rail = () => 'cut';
        leyenda = leyendaClases('17/03/2025 · Huelga general');
        anno(41.9301, 2.2549, `<b>${pct(lineaDe('R3').efecto_pct, 0)}</b>Osona · R3`);
        anno(41.6386, 2.3622, `<b>${pct(lineaDe('R2N').efecto_pct, 0)}</b>Vallès Oriental · R2 Nord`);
        anno(41.6137, 2.6547, `<b>${pct(lineaDe('R1').efecto_pct, 0)}</b>Maresme · R1`);
        anno(41.2372, 1.8059, `<b>${pct(lineaDe('R2S').efecto_pct, 0)}</b>Garraf · R2 Sud`);
        break;
      case 'anunciada': {
        relleno = porClase(FECHAS.anunciadas);
        rail = () => 'cut';
        leyenda = leyendaClases('Huelgas anunciadas · media');
        const r2s = D.incidencias.find((i) => i.fecha === '2025-04-01').lineas_dependientes.find((l) => l.linea === 'R2S');
        anno(41.2372, 1.8059, `<b>${pct(r2s.efecto_pct, 0)}</b>Garraf · R2 Sud<small>el que más cae el 1 de abril</small>`);
        anno(41.387, 2.170, 'Barcelona<small style="color:inherit;opacity:.8">los viajes llegan a otros barrios</small>', 'place');
        break;
      }
      case 'linea': {
        const a = story.averia, vias = VIAS_LINEA[a.linea_clave] || [];
        relleno = porClase([a.fecha]);
        rail = (id) => (vias.includes(id) ? 'cut' : 'on');
        const afect = D.municipios.filter((m) => m.grupo === 'dependientes' && m.efectos[a.fecha] && vias.some((v) => m.lineas.includes(v)));
        if (afect.length) {
          const lat = afect.map((m) => m.lat), lon = afect.map((m) => m.lon);
          bounds = [[Math.min(...lat, 41.387) - 0.12, Math.min(...lon, 2.17) - 0.2], [Math.max(...lat, 41.387) + 0.12, Math.max(...lon, 2.17) + 0.2]];
          const c = [lat.reduce((x, y) => x + y) / lat.length, lon.reduce((x, y) => x + y) / lon.length];
          anno(c[0], c[1], `<b>${pct(a.perdidos.efecto_pct, 0)}</b>${esc(a.linea_nombre)}<small>dependientes de la línea</small>`);
        }
        leyenda = leyendaClases(`${fecha(a.fecha)} · ${esc(a.titulo)}`);
        break;
      }
      case 'duracion':
        relleno = () => css('--other');
        leyenda = `<h4>Al día siguiente</h4><p class="note">Días +1 a +3 después del caos: los viajes vuelven a la normalidad (media de los cuatro días).</p>`;
        anno(41.387, 2.170, 'Día +1<small style="color:inherit;opacity:.8">todo vuelve a la normalidad</small>', 'place');
        break;
      case 'brecha':
        relleno = (m) => css(ALT_COL[m.alternativa && m.alternativa.clase] || '--other');
        leyenda = `<h4>Alternativa al tren hacia Barcelona</h4><ul>${['sin alternativa', 'débil', 'fuerte'].map((c) => `<li><span class="sw" style="background:${css(ALT_COL[c])}"></span>${cap(c)}</li>`).join('')}</ul><p class="note">Según el tiempo puerta a puerta y la frecuencia del bus interurbano, AMB o FGC (GTFS).</p>`;
        break;
      default: // normal y fin
        relleno = (m) => m.grupo === 'dependientes' ? css('--dep') : css('--other');
        leyenda = `<h4>Un día normal</h4><ul><li><span class="sw" style="background:${css('--dep')}"></span>Dependen del tren (35)</li><li><span class="sw" style="background:${css('--other')}"></span>Rodalies con alternativa</li><li><span class="sw" style="background:${css('--bcn')}"></span>Barcelona</li>${lineaLeyenda('Líneas de Rodalies')}</ul>`;
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
      // Las vías se dibujan siempre continuas, también las de las líneas afectadas.
      r.linea.setStyle({ color: r.color, weight: 3, opacity: 0.95, dashArray: null });
      r.casing.setStyle({ opacity: 0.9 });
    });
    $('legend-relato').innerHTML = leyenda;
    S.map.flyToBounds(bounds, { ...encuadre(), duration: 1.1 });
  }

  /* Un solo municipio resaltado a la vez. bringToFront() vuelve a insertar el trazado en el SVG y el navegador
   * puede perder su «mouseout»: el municipio se quedaba resaltado y con el tooltip abierto. Al entrar en otro
   * municipio (o al salir del mapa) se cierra el anterior a mano. */
  function hoverUnico(map) {
    let activa = null;
    map.getContainer().addEventListener('mouseleave', () => { if (activa) activa.fire('mouseout'); });
    return (layer) => {
      layer.on('mouseover', () => { if (activa && activa !== layer) activa.fire('mouseout'); activa = layer; });
      layer.on('mouseout', () => { if (activa === layer) activa = null; });
    };
  }

  /* Tooltip que sigue al cursor: encima por defecto y debajo cuando el cursor está cerca del borde superior
   * del mapa (si no, la barra de navegación lo taparía). */
  function tipFlexible(layer, contenido) {
    layer.bindTooltip(contenido, { sticky: true, className: 'story-tip', direction: 'top', offset: [0, -8] });
    const ajustar = (e) => {
      const t = layer.getTooltip(), abajo = e.containerPoint.y < 170;
      t.options.direction = abajo ? 'bottom' : 'top'; t.options.offset = abajo ? [0, 14] : [0, -8];
    };
    layer.on('mouseover', ajustar); layer.on('mousemove', ajustar);
  }

  /* Perímetro de Cataluña: relleno de tierra debajo de los municipios (completa el territorio fuera
   * de la cartografía municipal) y límite resaltado por encima (halo claro + línea oscura). */
  function contornoCatalunya(map) {
    if (!CONTORNO) return;
    const pane = (nombre, z) => { map.createPane(nombre); map.getPane(nombre).style.zIndex = z; map.getPane(nombre).style.pointerEvents = 'none'; return nombre; };
    L.geoJSON(CONTORNO, { pane: pane('cat-fondo', 350), interactive: false, style: { stroke: false, fillColor: css('--land'), fillOpacity: 1 } }).addTo(map);
    pane('cat-limite', 440);
    L.geoJSON(CONTORNO, { pane: 'cat-limite', interactive: false, style: { color: css('--surface'), weight: 6, opacity: 0.85, fill: false, lineJoin: 'round' } }).addTo(map);
    L.geoJSON(CONTORNO, { pane: 'cat-limite', interactive: false, style: { color: css('--cat-edge'), weight: 2.2, opacity: 1, fill: false, lineJoin: 'round' } }).addTo(map);
  }

  /* Paradas de Rodalies: punto pequeño con el borde del color de la línea. El nombre no se escribe en el
   * mapa (lo cargaría demasiado): aparece al pasar el cursor, junto con las líneas que paran. */
  function paradasRodalies(map) {
    if (!RAIL) return;
    map.createPane('paradas'); map.getPane('paradas').style.zIndex = 455;
    const R = 3.2, RH = 6;
    RAIL.features.filter((f) => f.geometry.type === 'Point').forEach((f) => {
      const [lon, lat] = f.geometry.coordinates, ls = (f.properties.lines || []).filter((l) => l !== 'R2');
      const p = L.circleMarker([lat, lon], { pane: 'paradas', radius: R, weight: 1.6, color: ls.length ? colorLinea(ls[0]) : css('--ink-2'), fillColor: css('--surface'), fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(`<b>${esc(f.properties.name)}</b><br>${ls.map(chipLinea).join(' ')}`, { className: 'story-tip parada-tip', direction: 'top', offset: [0, -6] })
        .addTo(map);
      p.on('mouseover', () => { p.setRadius(RH); p.setStyle({ weight: 2.5 }); });
      p.on('mouseout', () => { p.setRadius(R); p.setStyle({ weight: 1.6 }); });
    });
  }

  // ------------------------------------------------------------------ piezas comunes: mapa coroplético, iconos, buscador
  let BASE_P = null;
  const cargarBase = () => BASE_P || (BASE_P = fetch(BASE_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('municipios_mapa.geojson'); return r.json(); }));
  let PC = new Map();          // código → municipio del análisis
  let COMARCA = new Map();     // código → comarca (de la cartografía)

  const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const visible = (map) => { const z = map.getSize(); return z.x > 0 && z.y > 0; };

  const ICON = {
    tren: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.2l2-2h3.6l2 2H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-4-4-8-4zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>',
    bus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm1.5-6H6V6h12v5z"/></svg>',
    lupa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>',
    descarga: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM5 18h14v2H5z"/></svg>',
    enlace: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0zM8.5 19.5a3.5 3.5 0 0 1-2.5-6L8.2 11.3l1.4 1.4-2.2 2.2a1.5 1.5 0 0 0 2.1 2.1l2.2-2.2 1.4 1.4-2.2 2.2a3.5 3.5 0 0 1-2.4 1zm7.3-6.8-1.4-1.4 2.2-2.2a1.5 1.5 0 0 0-2.1-2.1l-2.2 2.2-1.4-1.4 2.2-2.2a3.5 3.5 0 0 1 4.9 4.9z"/></svg>',
    aviso: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l10 18H2zm-1 7v5h2V9zm0 7v2h2v-2z"/></svg>',
  };
  const CORTO_TIPO = { averia: 'Avería', huelga: 'Huelga', anunciada: 'Anunciada' };
  const colorLinea = (l) => { const f = RAIL && RAIL.features.find((x) => x.properties.id === l && x.geometry.type === 'LineString'); return f ? f.properties.color : css('--ink-2'); };
  const chipLinea = (l) => `<span class="chip" style="background:${colorLinea(l)}">${esc(l)}</span>`;
  const tintaSobre = (k) => `var(--t${k})`;   // texto legible sobre el color de cada clase (depende del tema)

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
    const hover = hoverUnico(map);
    L.geoJSON(base, {
      style: () => ({ color: css('--land-edge'), weight: 0.6, fillColor: css('--land'), fillOpacity: 1 }),
      onEachFeature: (f, layer) => {
        const cod = f.properties.codigo; M.capas.set(cod, layer);
        hover(layer);
        if (o.tip) tipFlexible(layer, () => o.tip(f.properties, PC.get(cod)));
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
    contornoCatalunya(map);
    paradasRodalies(map);
    M.annos = L.layerGroup().addTo(map);
    M.ruta = L.layerGroup().addTo(map);
    M.pintar = (fn) => M.capas.forEach((layer, cod) => {
      const m = PC.get(cod);
      const f = cod === BCN_COD ? css('--bcn') : m ? fn(m) : css('--land');
      layer.setStyle({ fillColor: typeof f === 'string' ? f : f.color, fillOpacity: typeof f === 'string' ? 1 : f.op, ...bordeDe(M, cod) });
    });
    M.vias = (estado) => M.rail.forEach((r, lid) => {
      const st = estado(lid);
      // Siempre continuas: una línea afectada ('cut') se dibuja igual que una que funciona.
      r.linea.setStyle(st === 'dim' ? { color: css('--neutral'), weight: 2, opacity: 0.6, dashArray: null } : { color: r.color, weight: 2.5, opacity: 0.95, dashArray: null });
      r.casing.setStyle({ opacity: st === 'dim' ? 0 : 0.9 });
    });
    M.resaltar = (cod) => { M.sel = cod; M.capas.forEach((layer, c) => layer.setStyle(bordeDe(M, c))); if (cod && M.capas.get(cod)) M.capas.get(cod).bringToFront(); };
    M.encuadrar = (b, pad) => { if (visible(map)) map.flyToBounds(b, { ...(pad || {}), duration: 0.8 }); else M.pendiente = [b, pad]; };
    M.refrescar = () => { map.invalidateSize(); if (M.pendiente && visible(map)) { map.fitBounds(M.pendiente[0], M.pendiente[1] || {}); M.pendiente = null; } };
    if (visible(map)) map.fitBounds(o.bounds || BOUNDS_STORY, o.pad || {}); else M.pendiente = [o.bounds || BOUNDS_STORY, o.pad];
    return M;
  }
  const bordeDe = (M, cod) => (cod === M.sel ? { weight: 3, color: css('--ink') } : { weight: cod === BCN_COD ? 1 : 0.6, color: css('--land-edge') });

  /* Color de un efecto (mismas clases que el relato). Las subidas no claras y «sin cambio claro», en gris neutro. */
  function colorEf(e, p, apagado) {
    if (e == null) return css('--other');
    const k = claseDe(e), claro = p == null || p < 0.1;
    if (k >= 4 && !claro) return { color: colMapa(3), op: apagado ? 0.35 : 1 };
    if (apagado) return { color: colMapa(k), op: 0.3 };
    return claro || k === 3 ? colMapa(k) : rayado(k);
  }
  const leyendaClasesHTML = (titulo, extra = '', sinSubidas = false) => `<h4>${titulo}</h4><ul>${itemsClases(sinSubidas)}${leyendaRayado}${extra}</ul>`;

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

  // ------------------------------------------------------------------ 2 · PLANIFICADOR (escenarios + ficha de cada municipio)
  /* Una sola herramienta para quien tiene que gestionar una incidencia (Generalitat, ATM, Renfe, ayuntamientos,
   * empresas) y para quien la sufre. Sin municipio: vista de red, con el impacto del escenario y dónde actuar primero.
   * Con municipio: «Este escenario» (rutas y acción recomendada) y «Perfil» (lo que antes era «Mi municipio»). */
  const sim = { tipo: 'huelga', linea: 'todas', dur: 1, mun: null, ruta: null, vista: 'escenario', M: null, listo: false };
  const BUS_PLAZAS = 55;   // plazas de un autobús interurbano, solo para dar orden de magnitud

  async function initSimulador(params) {
    let enfocar = false;
    if (params) {
      if (params.get('tipo')) sim.tipo = params.get('tipo');
      if (params.get('linea')) sim.linea = params.get('linea');
      if (params.get('mun') !== null) sim.mun = params.get('mun') || null;
      if (params.get('vista')) sim.vista = params.get('vista') === 'perfil' ? 'perfil' : 'escenario';
      enfocar = params.get('vista') === 'perfil' && !sim.mun;
      sim.ruta = null;
    }
    if (!sim.listo) {
      sim.listo = true;
      $('sim-tipos').innerHTML = D.tipos.map((t) => `<button type="button" role="tab" data-tipo="${t.id}">${CORTO_TIPO[t.id]}</button>`).join('');
      $('sim-tipos').addEventListener('click', (e) => { const b = e.target.closest('[data-tipo]'); if (b) cambiarTipo(b.dataset.tipo); });
      $('sim-lineas').addEventListener('click', (e) => { const b = e.target.closest('[data-linea]'); if (!b) return; sim.linea = b.dataset.linea; sim.ruta = null; actualizarSim(); });
      $('sim-dur').addEventListener('click', (e) => { const b = e.target.closest('[data-dur]'); if (!b) return; sim.dur = +b.dataset.dur; actualizarSim(false); });
      autocompletar($('sim-origen'), $('sim-ac'), (m) => elegirOrigen(m.codigo));
      $('sim-limpiar').addEventListener('click', () => elegirOrigen(null));
      $('sim-result').addEventListener('click', (e) => {
        const t = e.target.closest('[data-mun]'); if (t) { e.preventDefault(); return elegirOrigen(t.dataset.mun); }
        const r = e.target.closest('[data-ruta]'); if (r) { sim.ruta = r.dataset.ruta; return actualizarSim(false); }
        const v = e.target.closest('[data-vista]'); if (v) { e.preventDefault(); sim.vista = v.dataset.vista; $('sim-panel').scrollTo({ top: 0, behavior: 'smooth' }); return actualizarSim(false); }
        const g = e.target.closest('[data-ir-tipo]'); if (g) { sim.vista = 'escenario'; return cambiarTipo(g.dataset.irTipo); }
        if (e.target.closest('#sim-csv')) return descargarCSV();
        if (e.target.closest('#sim-copiar')) return copiarEnlace(e.target.closest('#sim-copiar'));
      });
      sim.M = await mapaCoropletico('map-sim', { tip: tipSim, onClick: (m) => elegirOrigen(m.codigo), pad: padPanel() });
    }
    actualizarSim();
    sim.M && setTimeout(() => sim.M.refrescar(), 60);
    if (enfocar) setTimeout(() => $('sim-origen').focus(), 120);
  }
  function cambiarTipo(id) {
    sim.tipo = id;
    if (sim.tipo === 'averia' && sim.linea === 'todas') sim.linea = (PC.get(sim.mun) || { lineas: ['R1'] }).lineas[0];
    sim.ruta = null; actualizarSim();
  }
  function elegirOrigen(cod) {
    sim.mun = cod; sim.ruta = null;
    if (!cod) sim.vista = 'escenario';
    const m = PC.get(cod);
    if (m && D.tipos.find((t) => t.id === sim.tipo).requiere_linea && !m.lineas.includes(sim.linea)) sim.linea = m.lineas[0];
    $('sim-panel').scrollTo({ top: 0 });
    actualizarSim();
  }
  function tipSim(p, m) {
    if (p.codigo === BCN_COD) return '<b>Barcelona</b><br><span class="muted">Destino</span>';
    if (!m) return `<b>${esc(p.nombre)}</b><br><span class="muted">Fuera del análisis</span>`;
    const r = simular(sim.tipo, sim.linea).filas.find((f) => f.m.codigo === m.codigo);
    return `<b>${esc(m.nombre)}</b> ${m.lineas.map(chipLinea).join('')}<br>` + (r ? `<span class="v ${r.c.efecto < 0 ? 'down' : ''}">${pct(r.c.efecto)}</span><span class="muted">${nf(Math.max(-r.perdidos, 0))} viajes menos · clic para abrir</span>` : '<span class="muted">No afectado en este escenario</span>');
  }

  /* Acción recomendada para quien gestiona la incidencia, a partir de lo que dice el análisis:
   * la caída depende de tener o no alternativa en transporte público (Laboratorio → Qué lo explica). */
  function accionGestion(m) {
    const a = m.alternativa || {};
    if (m.grupo === 'metro_fgc') return { nivel: 'baja', txt: 'Sin acción', det: 'Tiene metro o FGC: en los días de caos no cae.' };
    if (a.clase === 'sin alternativa' || !a.mejor) return { nivel: 'alta', txt: 'Lanzadera de bus', det: 'No hay transporte público alternativo directo: sin lanzadera, solo queda el coche o no viajar.' };
    if (a.clase === 'débil') return { nivel: 'media', txt: `Reforzar ${ALT_NOMBRE[a.mejor]}`, det: `Hay ${ALT_NOMBRE[a.mejor]} (${nf(a.t_alt)} min, ${nf(a.salidas_h_alt, 1)} salidas/h), pero más lento o con poca frecuencia para absorber a los viajeros del tren.` };
    return { nivel: 'baja', txt: `Informar: ${ALT_NOMBRE[a.mejor]}`, det: `${cap(ALT_NOMBRE[a.mejor])} es una buena alternativa (${nf(a.t_alt)} min): basta con avisar a los viajeros.` };
  }
  const NIVEL = { alta: 'Prioridad alta', media: 'Prioridad media', baja: 'Prioridad baja' };

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
    const m = PC.get(sim.mun) || null;
    if (!m) sim.vista = 'escenario';
    history.replaceState(null, '', `#planificador?tipo=${sim.tipo}&linea=${sim.linea}${m ? '&mun=' + m.codigo : ''}${m && sim.vista === 'perfil' ? '&vista=perfil' : ''}`);
    const r = simular(sim.tipo, sim.linea), afect = new Map(r.filas.map((f) => [f.m.codigo, f]));
    sim.ultimo = r;

    // controles
    document.querySelectorAll('#sim-tipos button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tipo === sim.tipo));
    $('sim-tipo-det').textContent = tipo.detalle;
    const lineas = (tipo.requiere_linea ? [] : ['todas']).concat(LINEAS_SIM);
    $('sim-lineas').innerHTML = `<span class="lbl">${tipo.requiere_linea ? 'Línea cortada' : 'Líneas'}</span>` + lineas.map((l) => `<button type="button" data-linea="${l}" class="${l === sim.linea ? 'on' : ''}" style="--lc:${l === 'todas' ? 'var(--ink)' : colorLinea(l)}">${l === 'todas' ? 'Toda la red' : l}</button>`).join('');
    document.querySelectorAll('#sim-dur button').forEach((b) => b.classList.toggle('on', +b.dataset.dur === sim.dur));
    $('sim-origen').value = m ? m.nombre : '';
    $('sim-limpiar').hidden = !m;
    $('sim-mas-wrap').hidden = !!m;

    // avisos (compactos, con explicación al pasar el cursor)
    const av = [];
    if (tipo.id === 'averia' && !tipo.coeficientes.lineas_observadas.includes(sim.linea)) av.push(['Extrapolado', `Solo se ha observado una avería sin aviso (R1, 13/05/2024). Para la ${sim.linea} se aplica el mismo coeficiente.`]);
    if (sim.dur > 1) av.push(['Varios días: rango', `Solo se han medido primeros días. Rango entre «solo el primer día» (adaptación total) y «${sim.dur} × primer día» (sin adaptación).`]);
    const avisos = av.map(([t, d]) => `<span class="warn-chip" data-tip="${esc(d)}">${ICON.aviso}${t}</span>`).join('');
    const rango = (v) => (sim.dur > 1 ? `${nf(v)}–${nf(v * sim.dur)}` : nf(v));

    $('sim-result').innerHTML = !m ? vistaRed(r, avisos, rango) : sim.vista === 'perfil' ? vistaPerfil(m) : vistaEscenario(m, tipo, afect.get(m.codigo), avisos);
    if (m && sim.vista === 'perfil') tira($('mun-strip'), D.municipios.filter((x) => x.efecto_medio != null).sort((x, y) => x.efecto_medio - y.efecto_medio), m);
    if (!m) detallesSim(tipo, r);

    // mapa
    const M = sim.M; if (!M) return;
    M.ruta.clearLayers();
    if (m && sim.vista === 'perfil') {
      // Perfil: el municipio destacado sobre el efecto medio en los días de caos; sus líneas en color, el resto en gris.
      // El municipio elegido conserva el color de su efecto y se marca con el borde grueso (bordeDe); el resto se apaga
      M.pintar((x) => colorEf(x.efecto_medio, null, x.codigo !== m.codigo));
      M.vias((lid) => (m.lineas.includes(lid) ? 'on' : 'dim'));
      M.resaltar(m.codigo);
      $('legend-sim').innerHTML = leyendaClasesHTML('Efecto medio en los días de caos', `<li><span class="sw" style="background:transparent;border:2px solid ${css('--ink')}"></span>${esc(m.nombre)}</li>`);
      if (reencuadrar) M.encuadrar([[m.lat - 0.25, m.lon - 0.35], [m.lat + 0.25, m.lon + 0.35]], padPanel());
      return;
    }
    M.pintar((x) => { const f = afect.get(x.codigo); return f ? colorEf(Math.min(f.c.efecto, 0), f.c.p, m && x.codigo !== m.codigo) : (m ? { color: css('--other'), op: 0.5 } : css('--other')); });
    M.vias((lid) => (tipo.id === 'averia' ? (lid === sim.linea ? 'cut' : 'on') : (sim.linea === 'todas' || lid === sim.linea ? 'cut' : 'on')));
    M.resaltar(m ? m.codigo : null);
    $('legend-sim').innerHTML = leyendaClasesHTML(m ? 'Impacto del escenario' : `${CORTO_TIPO[tipo.id]} · ${sim.linea === 'todas' ? 'toda la red' : sim.linea}`, `<li><span class="sw" style="background:${css('--other')}"></span>No afectado</li>`, true);
    if (!m) { if (reencuadrar) M.encuadrar(BOUNDS_STORY, padPanel()); return; }
    const A = [m.lat, m.lon], B = BCN, o = opcionesRuta(m, tipo, sim.linea), bounds = L.latLngBounds([A, B]);
    const tren = o.ops.find((x) => x.id === 'tren'), alt = o.ops.find((x) => x.id === 'alt');
    const pts = tramoLinea(tren.linea, A, B);
    const selT = sim.ruta === 'tren', selA = sim.ruta === 'alt';
    if (pts && pts.length > 1) {
      L.polyline([A, pts[0]], { pane: 'ruta', color: css('--ink-2'), weight: 2, dashArray: '2 5', opacity: 0.8 }).addTo(M.ruta);
      L.polyline(pts, { pane: 'ruta', color: css('--surface'), weight: selT ? 11 : 8, opacity: 0.95 }).addTo(M.ruta);
      L.polyline(pts, { pane: 'ruta', color: selT ? tren.linea && colorLinea(tren.linea) : css('--neutral'), weight: selT ? 7 : 5, opacity: 1, dashArray: null, lineCap: 'round' }).addTo(M.ruta);
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

  /* Vista de red: el escenario entero, para quien tiene que organizar la respuesta. */
  function vistaRed(r, avisos, rango) {
    const perd = Math.max(-r.perdidos, 0);
    const prio = r.filas.filter((f) => f.m.grupo === 'dependientes' && f.perdidos < 0).map((f) => ({ ...f, acc: accionGestion(f.m) }));
    const orden = { alta: 0, media: 1, baja: 2 };
    prio.sort((a, b) => orden[a.acc.nivel] - orden[b.acc.nivel] || a.perdidos - b.perdidos);
    const top = prio.slice(0, 6), mx = Math.max(...top.map((f) => -f.perdidos), 1);
    const sinAlt = prio.filter((f) => f.acc.nivel === 'alta'), perdSinAlt = Math.max(-sinAlt.reduce((s, f) => s + f.perdidos, 0), 0);
    return `<div class="pp-impact"><strong>${rango(perd)}</strong><span>viajes menos a Barcelona${sim.dur > 1 ? ` en ${sim.dur} días` : ' el primer día'}</span></div>
      <div class="pp-sub">Vuelve a la normalidad ${sim.dur > 1 ? 'en pocos días' : 'al día siguiente'} ${avisos}</div>
      <div class="pp-kpis">
        <div><strong>${r.dep.length}</strong><span>municipios dependientes afectados</span></div>
        <div><strong>${sinAlt.length}</strong><span>sin transporte alternativo</span></div>
        <div data-tip="${esc(`Viajes perdidos en los municipios sin alternativa ÷ ${BUS_PLAZAS} plazas por autobús. Solo da el orden de magnitud: no tiene en cuenta horas punta ni viajes de vuelta.`)}"><strong>≈ ${nf(Math.ceil(perdSinAlt / BUS_PLAZAS))}</strong><span>autobuses llenos para cubrirlos*</span></div>
      </div>
      <h3 class="pp-h">Dónde actuar primero</h3>
      <ol class="pp-prio">${top.map((f, i) => `<li><button type="button" data-mun="${f.m.codigo}">
          <span class="n">${i + 1}</span>
          <span class="nm"><b>${esc(f.m.nombre)}</b> ${chipLinea(f.m.lineas_clave.split('+')[0])}<em class="acc ${f.acc.nivel}">${esc(f.acc.txt)}</em></span>
          <span class="vl"><b>${nf(-f.perdidos)}</b><small>viajes menos</small><span class="bar"><i style="width:${-f.perdidos / mx * 100}%;background:${colClase(claseDe(f.c.efecto))}"></i></span></span></button></li>`).join('') || '<li class="muted small">Ningún municipio dependiente afectado.</li>'}</ol>
      <p class="muted small">Primero los municipios sin alternativa; dentro de cada grupo, los que pierden más viajes. La acción sale del hallazgo principal: solo cae quien no tiene alternativa al tren.</p>
      <div class="pp-actions">
        <button type="button" class="btn-s" id="sim-csv">${ICON.descarga}Descargar plan (CSV)</button>
        <button type="button" class="btn-s ghost" id="sim-copiar">${ICON.enlace}<span>Copiar enlace</span></button>
      </div>
      <p class="pp-hint">${ICON.lupa} Elige un municipio arriba o en el mapa para ver sus rutas y su perfil.</p>`;
  }

  /* Vista de municipio, pestaña «Este escenario»: impacto, rutas para el viajero y acción para el gestor. */
  function vistaEscenario(m, tipo, f, avisos) {
    const o = opcionesRuta(m, tipo, sim.linea);
    if (!sim.ruta || !o.ops.some((x) => x.id === sim.ruta)) sim.ruta = o.rec;
    const k = f ? claseDe(f.c.efecto) : 3, acc = accionGestion(m);
    const perdTxt = f && f.perdidos < 0 ? (sim.dur > 1 ? `${nf(-f.perdidos)}–${nf(-f.perdidos * sim.dur)}` : nf(-f.perdidos)) : null;
    return `${cabeceraMun(m, f, k)}
      <div class="pp-sub">${perdTxt ? `≈ ${perdTxt} viajes menos${sim.dur > 1 ? ` en ${sim.dur} días` : ''} de ${nf(m.viajes_referencia)} un día normal` : 'Este escenario no afecta a sus líneas'} ${avisos}</div>
      ${f && o.afectado ? `<div class="pp-accion ${acc.nivel}"><small>${NIVEL[acc.nivel]} · qué hacer</small><b>${esc(acc.txt)}</b><span>${esc(acc.det)}</span></div>` : ''}
      <h3 class="pp-h">Cómo llegar a Barcelona</h3>
      <div class="routes">${o.ops.map((x) => `<button type="button" class="route ${x.id === sim.ruta ? 'sel' : ''}" data-ruta="${x.id}">
          <span class="ric ${x.id}">${ICON[x.icon]}</span>
          <span class="rbody"><b>${esc(x.titulo)}</b><small>${esc(x.sub)}</small>${x.estado[1] ? `<em class="st ${x.estado[0]}">${esc(x.estado[1])}</em>` : ''}</span>
          <span class="rtime">${x.min != null ? `<strong>${nf(x.min)}</strong> min` : ''}${x.rec ? '<i class="rec">Recomendada</i>' : ''}</span></button>`).join('')}</div>
      <p class="pp-hint">${o.afectado ? (sim.dur > 1 ? 'La gente se adapta en pocos días: el efecto se diluye.' : 'Al día siguiente, todo vuelve a la normalidad.') : 'Sus líneas funcionan: el impacto llega por la congestión del resto de la red.'}</p>`;
  }

  /* Vista de municipio, pestaña «Perfil»: lo que antes era la página «Mi municipio». */
  function vistaPerfil(m) {
    const a = m.alternativa || {}, n = D.municipios.filter((x) => x.efecto_medio != null).length;
    const escen = D.tipos.map((t) => { const l = t.requiere_linea ? (m.lineas.includes(sim.linea) ? sim.linea : m.lineas[0]) : 'todas', c = coefMunicipio(t, l, m); return { t, c, perd: c ? m.viajes_referencia * c.efecto / 100 : 0 }; });
    const frase = m.rango_vulnerabilidad <= Math.round(n / 3) ? 'de los más vulnerables' : m.rango_vulnerabilidad <= Math.round(2 * n / 3) ? 'de vulnerabilidad media' : 'de los menos vulnerables';
    const mx = Math.max(a.t_rodalies || 0, a.t_alt || 0, 1);
    const viaje = ([ic, nom, t, s, col]) => `<div class="trip"><span class="ric">${ICON[ic]}</span><div class="tbody"><div class="tl"><b>${esc(nom)}</b><span><strong>${t != null ? nf(t) : '—'}</strong> min</span></div><div class="tbar"><i style="width:${(t || 0) / mx * 100}%;background:${col}"></i></div><div class="freq" data-tip="${esc(`${nf(s, 1)} salidas por hora`)}">${'<i></i>'.repeat(Math.min(Math.round(s || 0), 16))}<span>${s != null ? nf(s, 1) + ' salidas/h' : ''}</span></div></div></div>`;
    return `${cabeceraMun(m, null, 3)}
      <div class="pp-sub">${m.dist_km != null ? nf(m.dist_km, 1) + ' km de Barcelona · ' : ''}${nf(m.viajes_referencia)} viajes/día a BCN</div>
      <section class="pp-sec"><h3 class="pp-h">Índice: ${frase} · <span class="hl">${m.rango_vulnerabilidad}.º de ${n}</span></h3>
        <div id="mun-strip"></div><p class="muted small">Cada barra es un municipio, ordenado por la caída media en los días de caos.</p></section>
      <section class="pp-sec"><h3 class="pp-h">Si mañana pasa esto…</h3>
        <div class="pp-scen">${escen.map((e) => { const k = e.c ? claseDe(e.c.efecto) : 3; return `<button type="button" data-ir-tipo="${e.t.id}" data-tip="${esc(`${e.t.nombre}: ${e.c && e.perd < 0 ? `≈ ${nf(-e.perd)} viajes menos` : 'sin impacto relevante'}${e.c && e.c.observado === false ? ' · extrapolado' : ''}. Clic para ver rutas.`)}">
            <small>${CORTO_TIPO[e.t.id]}</small><span class="sval" style="background:${colClase(k)};color:${tintaSobre(k)}">${e.c ? pct(e.c.efecto, 0) : '≈ 0 %'}</span></button>`; }).join('')}</div></section>
      <section class="pp-sec"><h3 class="pp-h">Historial: cada día de caos</h3>
        <div class="hist pp-hist">${D.incidencias.map((i) => { const ef = m.efectos[i.fecha], k = ef ? claseDe(ef.efecto) : 3, claro = ef && ef.p < 0.05; return `<div class="htile ${claro ? '' : 'nc'}" style="--bg:${colClase(k)};--fg:${tintaSobre(k)}" data-tip="${esc(`${i.titulo}<br>${ef ? pct(ef.efecto) + ' · ' + pval(ef.p) : ''}`)}">
          <span class="hdate">${fecha(i.fecha).slice(0, 5)}<small>${fecha(i.fecha).slice(6)}</small></span>
          <strong>${ef ? pct(ef.efecto, 0) : '—'}</strong><small>${claro ? 'efecto claro' : 'no concluyente'}</small></div>`; }).join('')}</div></section>
      <section class="pp-sec"><h3 class="pp-h">Cómo llegar a Barcelona</h3>
        <div class="trips">${[['tren', `Rodalies ${m.lineas[0]}`, a.t_rodalies, a.salidas_h_rodalies, colorLinea(m.lineas[0])]].concat(a.mejor ? [[a.mejor === 'fgc' ? 'tren' : 'bus', cap(ALT_NOMBRE[a.mejor]), a.t_alt, a.salidas_h_alt, css('--route')]] : []).map(viaje).join('')}
          ${a.mejor ? '' : `<div class="trip none"><div class="tbody"><b>Sin alternativa directa en transporte público</b><small class="muted">Si el tren falla, solo queda el coche o no viajar.</small></div></div>`}</div></section>
      <section class="pp-sec"><h3 class="pp-h">Vulnerabilidad social</h3>
        ${m.vulnerabilidad ? fichaSocial(m) : '<p class="pending small">Pendiente: motorización y renta (notebook 05).</p>'}</section>`;
  }

  /* Cabecera común del municipio, con el selector de pestaña. */
  function cabeceraMun(m, f, k) {
    return `<div class="pp-mun"><div><b>${esc(m.nombre)}</b><span>${m.lineas.map(chipLinea).join('')} ${esc(COMARCA.get(m.codigo) || '')} · ${GRUPO[m.grupo]}</span></div>
        ${sim.vista === 'escenario' ? (f ? `<div class="pp-eff" style="background:${colClase(k)};color:${tintaSobre(k)}" data-tip="${esc(`${esc(f.c.fuente)}<br>${pval(f.c.p)}${f.c.observado ? '' : '<br>Extrapolado'}`)}"><strong>${pct(f.c.efecto, 0)}</strong><span>viajes</span></div>` : '<div class="pp-eff"><strong>≈ 0 %</strong><span>no afectado</span></div>') : ''}</div>
      <div class="pp-seg" role="tablist"><button type="button" role="tab" data-vista="escenario" aria-selected="${sim.vista === 'escenario'}">Este escenario</button><button type="button" role="tab" data-vista="perfil" aria-selected="${sim.vista === 'perfil'}">Perfil del municipio</button></div>`;
  }

  /* Plan descargable: todos los municipios afectados con su efecto, viajes perdidos y acción recomendada. */
  function descargarCSV() {
    const r = sim.ultimo, tipo = r.tipo;
    const q = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const dec = (x, d = 1) => (x == null ? '' : Number(x).toFixed(d).replace('.', ','));
    const cab = ['Municipio', 'Comarca', 'Grupo', 'Líneas', 'Viajes a BCN (día normal)', 'Efecto (%)', 'IC 95 % inf.', 'IC 95 % sup.', 'p', 'Viajes perdidos (1.er día)', 'Alternativa', 'Mejor alternativa', 'Minutos alternativa', 'Turismos por 1.000 hab.', 'Prioridad', 'Acción recomendada'];
    const filas = r.filas.slice().sort((a, b) => a.perdidos - b.perdidos).map((f) => { const m = f.m, a = m.alternativa || {}, acc = accionGestion(m);
      return [m.nombre, COMARCA.get(m.codigo) || '', GRUPO[m.grupo], m.lineas_clave, nf(m.viajes_referencia).replace(/\./g, ''), dec(f.c.efecto), dec(f.c.ic_inf), dec(f.c.ic_sup), dec(f.c.p, 3), Math.round(Math.max(-f.perdidos, 0)), a.clase || '', a.mejor ? ALT_NOMBRE[a.mejor] : '', a.t_alt ?? '', m.vulnerabilidad ? m.vulnerabilidad.motorizacion : '', NIVEL[acc.nivel], acc.txt]; });
    const meta = `# R-MOVE · ${tipo.nombre} · ${sim.linea === 'todas' ? 'toda la red' : sim.linea}. Viajes perdidos = viajes de un día normal × efecto del escenario (clustering, notebook 03).`;
    const csv = '﻿' + [meta, cab.map(q).join(';'), ...filas.map((x) => x.map(q).join(';'))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const aEl = Object.assign(document.createElement('a'), { href: url, download: `rmove_plan_${tipo.id}_${sim.linea}.csv` });
    document.body.appendChild(aEl); aEl.click(); aEl.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function copiarEnlace(btn) {
    const ok = () => { const s = btn.querySelector('span'); s.textContent = 'Enlace copiado'; setTimeout(() => { s.textContent = 'Copiar enlace'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(ok, () => prompt('Copia este enlace:', location.href));
    else prompt('Copia este enlace:', location.href);
  }

  function detallesSim(tipo, r) {
    const ida = tipo.barrios.filter((b) => b.sentido === 'ida');
    const avg = (k) => ida.reduce((s, b) => s + b[k], 0) / Math.max(ida.length, 1);
    $('sim-mas').innerHTML = `
      <h4>¿A qué barrios de Barcelona dejan de llegar?</h4>
      <div class="doors"><div><small>Barrios con estación</small><strong class="down">${pct(avg('con_estacion'))}</strong></div><div><small>Barrios sin estación</small><strong class="${avg('sin_estacion') < 0 ? 'down' : 'up'}">${pct(avg('sin_estacion'))}</strong></div></div>
      <p class="muted small">Datos por barrio, viajes de ida desde municipios dependientes. ${esc(ida.map((b) => b.caso).join(' y '))}.</p>
      <h4>Personas más expuestas</h4>
      <p class="small">${nf(r.filas.filter((f) => f.m.alternativa && f.m.alternativa.clase === 'sin alternativa').reduce((s, f) => s + f.m.viajes_referencia, 0))} viajes diarios salen de municipios sin alternativa directa.</p>
      ${D.vulnerabilidad_resumen ? (() => {
        const VR = D.vulnerabilidad_resumen, pocos = r.filas.filter((f) => f.m.grupo === 'dependientes' && f.m.vulnerabilidad && f.m.vulnerabilidad.nivel_motorizacion === 'baja');
        const tb = VR.terciles_motorizacion.find((t) => t.nivel === 'baja'), ta = VR.terciles_motorizacion.find((t) => t.nivel === 'alta');
        return `<p class="small">${nf(pocos.reduce((s, f) => s + f.m.viajes_referencia, 0))} viajes diarios salen de <b>${pocos.length} municipios dependientes con pocos coches</b> (≤ ${nf(VR.cortes_motorizacion[0])} turismos por 1.000 hab.)${pocos.length ? `: ≈ ${nf(Math.max(-pocos.reduce((s, f) => s + f.perdidos, 0), 0))} viajes menos en este escenario` : ''}.</p>
        <p class="muted small">Con menos coches hay menos margen para cambiar de modo: en los días de caos, los dependientes con poca motorización cayeron ${pct(tb.efecto)} de media, frente a ${pct(ta.efecto)} los que tienen más coches.</p>`;
      })() : '<p class="pending small">Pendiente: motorización y renta.</p>'}
      <h4>Municipios con efecto significativo</h4>
      <div class="table-wrap" style="max-height:300px"><table class="tbl compact"><thead><tr><th>Municipio</th><th class="num">Efecto</th><th class="num">Viajes menos</th></tr></thead><tbody>${r.filas.filter((f) => f.c.p != null && f.c.p < 0.05).map((f) => `<tr><td><a href="#" data-mun="${f.m.codigo}">${esc(f.m.nombre)}</a></td><td class="num">${pct(f.c.efecto)}</td><td class="num">${nf(Math.max(-f.perdidos, 0))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Ningún municipio con efecto significativo en este escenario.</td></tr>'}</tbody></table></div>
      <p class="muted small">Solo municipios con efecto estadísticamente significativo (p &lt; 0,05). Viajes menos = viajes de un día normal × coeficiente del escenario. Detalle del método en el Laboratorio.</p>`;
    $('sim-mas').querySelectorAll('[data-mun]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); elegirOrigen(a.dataset.mun); }));
  }

  /* Ficha «Vulnerabilidad social»: motorización y renta del municipio y qué implica (notebook 05). */
  function fichaSocial(m) {
    const v = m.vulnerabilidad, VR = D.vulnerabilidad_resumen;
    const NIV = { baja: 'de las más bajas', media: 'intermedia', alta: 'de las más altas' };
    const nivTxt = (n) => n ? NIV[n] : '';
    let lectura = '';
    if (VR) {
      const t = VR.terciles_motorizacion, tb = t.find((x) => x.nivel === 'baja'), ta = t.find((x) => x.nivel === 'alta');
      const sinAlt = !m.alternativa || m.alternativa.clase === 'sin alternativa';
      if (m.grupo === 'dependientes' && v.nivel_motorizacion === 'baja')
        lectura = `<b>Depende del tren y tiene pocos coches${sinAlt ? ', sin alternativa directa' : ''}: es el perfil más expuesto.</b> Los dependientes con poca motorización cayeron ${pct(tb.efecto)} de media en los días de caos.`;
      else if (m.grupo === 'dependientes' && v.nivel_motorizacion === 'alta')
        lectura = `<b>Depende del tren, pero con más coches hay más margen para cambiar de modo.</b> Los dependientes con mucha motorización cayeron ${pct(ta.efecto)} de media, frente a ${pct(tb.efecto)} los que tienen pocos coches.`;
      else if (m.grupo === 'dependientes')
        lectura = `<b>Depende del tren, con una motorización intermedia.</b> Entre los dependientes, cuantos menos coches, más caída (${pct(tb.efecto)} con pocos, ${pct(ta.efecto)} con muchos).`;
      else
        lectura = `<b>${m.grupo === 'metro_fgc' ? 'Tiene metro o FGC' : 'Está cerca de Barcelona'}:</b> la alternativa de transporte pesa más que los coches o la renta.`;
      lectura += ' La renta, en conjunto, no explica las diferencias entre municipios.';
    }
    return `<div class="doors">
        <div><small>Motorización</small><strong>${nf(v.motorizacion)}</strong><span>turismos por 1.000 hab. · ${nivTxt(v.nivel_motorizacion)}</span></div>
        <div><small>Renta</small><strong>${v.renta != null ? nf(v.renta) + ' €' : '—'}</strong><span>neta por persona · ${nivTxt(v.nivel_renta)}</span></div></div>
      ${VR ? `<p class="small">${lectura}</p><p class="muted small">Nivel según los terciles de los ${VR.dependientes} municipios dependientes: pocos coches ≤ ${nf(VR.cortes_motorizacion[0])}, muchos > ${nf(VR.cortes_motorizacion[1])} turismos por 1.000 hab.; renta baja ≤ ${nf(VR.cortes_renta[0])} €, alta > ${nf(VR.cortes_renta[1])} €. Fuentes: DGT, INE Padrón y ADRH. Detalle en <a href="#laboratorio">Laboratorio → Qué lo explica</a>.</p>` : ''}`;
  }

  /* Tira de los 62 municipios ordenados por efecto medio, con el elegido destacado. */
  function tira(el, orden, m) {
    const W = ancho(el), H = 92, L0 = 4, bw = (W - 8) / orden.length;
    const mn = Math.min(...orden.map((x) => x.efecto_medio)), mx = Math.max(...orden.map((x) => x.efecto_medio), 0);
    const y0 = 40, h = (v) => Math.abs(v) / Math.max(Math.abs(mn), mx) * 30;
    let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Posición en el índice">`;
    orden.forEach((x, i) => {
      const v = x.efecto_medio, yo = v < 0 ? y0 : y0 - h(v), sel = x.codigo === m.codigo;
      s += `<rect x="${L0 + i * bw + 0.5}" y="${yo}" width="${Math.max(bw - 1, 1)}" height="${Math.max(h(v), 1.5)}" rx="1.5" fill="${sel ? css('--ink') : colClase(claseDe(v))}" opacity="${sel ? 1 : 0.75}" data-tip="${esc(`${i + 1}.º ${x.nombre}: ${pct(v)}`)}"/>`;
      if (sel) s += `<text class="lbl" x="${Math.min(Math.max(L0 + i * bw + bw / 2, 30), W - 30)}" y="14" text-anchor="middle" style="font-weight:600">${esc(m.nombre)} · ${pct(v)}</text><line x1="${L0 + i * bw + bw / 2}" x2="${L0 + i * bw + bw / 2}" y1="18" y2="${y0 - 2}" stroke="${css('--ink')}" stroke-width="1.5"/>`;
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
      const botones = [...document.querySelectorAll('#lab-nav button')], antes = botones.findIndex((x) => x.classList.contains('active'));
      const atras = botones.indexOf(b) < antes;
      botones.forEach((x) => x.classList.toggle('active', x === b));
      // Solo las subpestañas (hijos directos de la sección): el detalle del caso (#lab-caso) también es .lab y no debe ocultarse
      document.querySelectorAll('#mode-laboratorio > .lab').forEach((x) => {
        const ver = x.id === 'lab-' + b.dataset.lab;
        // Misma entrada que al cambiar de página (y en el mismo sentido que el orden de las pestañas)
        if (ver && x.hidden) { x.classList.remove('entra'); void x.offsetWidth; x.classList.toggle('atras', atras); x.classList.add('entra'); }
        x.hidden = !ver;
      });
      if (b.dataset.lab === 'validacion') pintarValidacion();
      if (b.dataset.lab === 'factores') pintarFactores();
    });
    // Casos: línea de tiempo
    $('lab-casos').innerHTML = `<div class="timeline">
        <div class="tl-cards">${CASOS().map((i, k) => `<button class="tl-card ${k ? '' : 'active'}" data-i="${k}"><small>${fecha(i.fecha)} · ${esc(i.tipo)}</small><b>${esc(i.titulo)}</b><span class="${i.perdidos.efecto_pct < 0 ? 'down' : ''}">${pct(i.perdidos.efecto_pct)} en ${i.linea_nombre ? 'la ' + esc(i.linea_nombre) : 'dependientes'}</span></button>`).join('')}</div></div>
      <div id="lab-caso" class="lab"></div>`;
    $('lab-casos').querySelector('.timeline').addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      $('lab-casos').querySelectorAll('[data-i]').forEach((x) => x.classList.toggle('active', x.dataset.i === b.dataset.i));
      caso(CASOS()[+b.dataset.i]);
    });
    caso(CASOS()[0]);
    pintarMetodo();
    // Tras cambiar de tema (recarga), volver a la subpestaña en la que se estaba
    let volver = null; try { volver = sessionStorage.getItem('rmove-lab'); sessionStorage.removeItem('rmove-lab'); } catch (e) {}
    const bv = volver && document.querySelector(`#lab-nav [data-lab="${volver}"]`);
    if (bv && !bv.classList.contains('active')) bv.click();
  }

  /* Casos del Laboratorio: días de caos y, al final, averías de una sola línea (sección 4.6 del notebook 03).
   * La huelga del 26/03/2025 no se muestra en el Laboratorio (sigue en el resto del observatorio y en las medias). */
  const OCULTOS_LAB = ['2025-03-26'];
  const CASOS = () => D.incidencias.concat(D.averias || []).filter((i) => !OCULTOS_LAB.includes(i.fecha));

  async function caso(i) {
    const p = i.perdidos, lin = i.lineas_dependientes.slice().sort((a, b) => a.efecto_pct - b.efecto_pct), peor = lin[0];
    const esAveria = !!i.linea_clave, dep = i.grupos.find((g) => g.grupo === (esAveria ? 'linea_afectada' : 'dependientes'));
    const quien = esAveria ? `dependientes de la ${esc(i.linea_nombre)}` : 'dependientes';
    $('lab-caso').innerHTML = `
      <div class="case-hero card">
        <div class="ch-text">
          <p class="eyebrow">${fecha(i.fecha)} · ${esc(i.tipo)}</p><h2>${esc(i.titulo)}</h2>
          <p>${esc(i.lectura)}</p>
          <div class="ch-kpis"><div><strong class="down">${pct(p.efecto_pct)}</strong><span>viajes de los ${quien}</span></div><div><strong>${nf(p.viajes_perdidos)}</strong><span>viajes menos ese día</span></div><div><strong>${pval(p.p_valor).replace('p ', 'p ')}</strong><span>${p.p_valor < 0.05 ? 'efecto claro' : 'no concluyente'}</span></div></div>
          <details class="small"><summary>Qué pasó exactamente</summary><p>${esc(i.descripcion)}</p><p><b>Servicio:</b> ${esc(i.tramo)}</p></details>
        </div>
        <div class="ch-map"><div id="lab-map" class="fill-map"></div><div class="story-legend mini" id="legend-lab"></div></div>
      </div>
      <div class="lab-grid">
        <div class="card"><div class="card-head"><h2>${dep && dep.p_valor < 0.05 ? (esAveria ? `Solo cae la ${esc(i.linea_nombre)}, no las demás líneas` : 'Solo caen los que dependen del tren') : 'Ningún grupo cae de forma clara'}</h2><small>Efecto por grupo de municipios e intervalo del 95 %</small></div><div class="pad" id="c-grupos"></div></div>
        <div class="card"><div class="card-head"><h2>${peor.p_valor < 0.05 ? `La ${esc(peor.linea)} es la que más cae` : 'Ninguna línea destaca con claridad'}</h2><small>Municipios dependientes, por línea</small></div><div class="pad" id="c-lineas"></div></div>
        <div class="card"><div class="card-head"><h2>El día del caos se sale del rango normal</h2><small>Índice de viajes (día normal = 100). Banda gris: lo habitual.</small></div><div class="pad" id="c-serie"></div></div>
        <div class="card"><div class="card-head"><h2>Por tramos de la red</h2><small>Punto: cambio ese día. Barra gris: lo que varía un día normal. Fuera de la barra = anómalo.</small></div><div class="pad" id="c-tramos"></div></div>
      </div>`;
    forest($('c-grupos'), i.grupos.map((g) => ({ label: (g.etiqueta || GRUPO[g.grupo]) + ` (${g.municipios})`, efecto: g.efecto_pct, ic_inf: g.ic_inf, ic_sup: g.ic_sup, p: g.p_valor })), { labelW: esAveria ? 250 : 190 });
    forest($('c-lineas'), i.lineas_dependientes.map((l) => ({ label: `${l.linea} (${l.municipios})`, efecto: l.efecto_pct, ic_inf: l.ic_inf, ic_sup: l.ic_sup, p: l.p_valor })), { labelW: 110 });
    const xs = i.serie.map((s) => fecha(s.fecha).slice(0, 5));
    lines($('c-serie'), xs, [
      { name: esAveria ? `Dependientes ${i.linea_nombre}` : 'Dependientes', color: css('--down'), values: i.serie.map((s) => s.dependientes) },
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
    const alt = D.alternativa, dias = [...new Set(alt.map((a) => a.dia))].filter((d) => !OCULTOS_LAB.map(fecha).includes(d)), grupos = ['Sin alternativa directa', 'Alternativa débil', 'Alternativa fuerte'];
    const lejos = D.distancia[D.distancia.length - 1];
    $('lab-factores').innerHTML = `<div class="lab-grid">
      <div class="card"><div class="card-head"><h2>Cuanto más lejos, más cae: ${pct(lejos.efecto_pct)} a ${esc(lejos.banda)}</h2><small>Municipios con Rodalies, todos los días de caos</small></div><div class="pad" id="lab-dist"></div></div>
      <div class="card"><div class="card-head"><h2>Donde hay metro o FGC, no pasa nada</h2><small>Efecto por grupo, todos los días de caos</small></div><div class="pad" id="lab-grupos"></div></div>
      <div class="card wide2"><div class="card-head"><h2>Sin alternativa al tren, la caída se repite en cada incidencia</h2><small>Efecto según la alternativa en transporte público (GTFS), municipios con Rodalies. Color intenso: efecto claro (p &lt; 0,05). Pasa el cursor para ver el intervalo.</small></div>
        <div class="pad"><table class="heat"><thead><tr><th></th>${grupos.map((g) => `<th>${g}</th>`).join('')}</tr></thead><tbody>${dias.map((d) => `<tr><th>${esc(d)}</th>${grupos.map((g) => { const x = alt.find((a) => a.dia === d && a.grupo === g); if (!x) return '<td></td>'; const k = claseDe(x.efecto), cl = x.p < 0.05; return `<td style="--bg:${cl ? colClase(k) : 'var(--surface-2)'};--fg:${cl ? tintaSobre(k) : 'var(--muted)'}" data-tip="${esc(`<b>${g}</b>, ${d}<br>${pct(x.efecto)} [${pct(x.ic_inf)}, ${pct(x.ic_sup)}]<br>${pval(x.p)} · ${x.municipios} municipios`)}">${pct(x.efecto)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>
      ${factoresSociales()}
</div>`;
    forest($('lab-dist'), D.distancia.map((g) => ({ label: g.banda + ` (${g.municipios})`, efecto: g.efecto_pct, ic_inf: g.ic_inf, ic_sup: g.ic_sup, p: g.p_valor })), { labelW: 120 });
    forest($('lab-grupos'), D.grupos.map((g) => ({ label: g.etiqueta.replace(/ \(.*\)/, ''), efecto: g.efecto_pct, ic_inf: g.ic_inf, ic_sup: g.ic_sup, p: g.p_valor })), { labelW: 170 });
    const VR = D.vulnerabilidad_resumen;
    if (VR) {
      const NOM = { baja: 'Baja', media: 'Media', alta: 'Alta' };
      const filasT = (ts, u) => ts.map((t) => ({ label: `${NOM[t.nivel]} (${nf(t.min)}–${nf(t.max)}${u})`, efecto: t.efecto, ic_inf: t.ic_inf, ic_sup: t.ic_sup, p: t.ic_inf < 0 && t.ic_sup > 0 ? 1 : 0 }));
      forest($('lab-motor'), filasT(VR.terciles_motorizacion, ''), { labelW: 150, aria: 'Efecto por terciles de motorización' });
      forest($('lab-renta'), filasT(VR.terciles_renta, ' €'), { labelW: 170, aria: 'Efecto por terciles de renta' });
    }
  }

  /* Tarjetas de motorización y renta (notebook 05). Vacío si aún no hay datos. */
  function factoresSociales() {
    const VR = D.vulnerabilidad_resumen;
    if (!VR) return '<div class="card wide2"><div class="card-head"><h2>Motorización y renta</h2></div><p class="pending small" style="margin:0 16px 16px">Pendiente: se añaden con el notebook 05.</p></div>';
    const tb = VR.terciles_motorizacion.find((t) => t.nivel === 'baja'), ta = VR.terciles_motorizacion.find((t) => t.nivel === 'alta');
    const mot = VR.modelo.find((x) => x.variable === 'tur100'), R = VR.robustez;
    const ren13 = VR.por_dia.find((d) => d.fecha === FECHAS.averia);
    const pp = (x) => (x > 0 ? '+' : '') + nf(x, 2).replace('-', '−');
    return `
      <div class="card"><div class="card-head"><h2>Con menos coches, más caída: ${pct(tb.efecto)} frente a ${pct(ta.efecto)}</h2><small>Municipios dependientes por terciles de motorización (turismos por 1.000 hab.). Efecto medio en los 4 días de caos, ponderado por la fiabilidad de cada municipio.</small></div><div class="pad" id="lab-motor"></div></div>
      <div class="card"><div class="card-head"><h2>La renta no marca diferencias</h2><small>Municipios dependientes por terciles de renta neta por persona (ADRH).</small></div><div class="pad" id="lab-renta"></div></div>
      <div class="card wide2"><div class="card-head"><h2>A igual distancia y alternativa, +100 turismos por 1.000 hab. son ${nf(mot.coef_pp, 1)} puntos menos de caída</h2><small>Regresión ponderada entre los ${VR.muestra} municipios con Rodalies. Variable explicada: efecto medio de cada municipio en los días de caos. Positivo = menos caída. Es una asociación entre municipios, no una causa.</small></div>
        <div class="pad"><table class="tbl compact"><thead><tr><th>Factor</th><th class="num">Puntos de caída</th><th class="num">IC 95 %</th><th class="num">p</th></tr></thead><tbody>${VR.modelo.map((x) => `<tr class="${x.p >= 0.05 ? 'ns' : ''}"><td>${esc(x.etiqueta)}</td><td class="num">${pp(x.coef_pp)}</td><td class="num">[${pp(x.ic_inf)}, ${pp(x.ic_sup)}]</td><td class="num">${pval(x.p).replace('p = ', '').replace('p < ', '< ')}</td></tr>`).join('')}</tbody></table>
          <p class="muted small">R² = ${nf(VR.r2, 2)}. En gris: sin efecto claro (p ≥ 0,05).</p></div>
        <ul class="checks">
          <li>Quitando cualquier municipio, el efecto de la motorización queda entre ${pp(R.quitar_un_municipio[0])} y ${pp(R.quitar_un_municipio[1])} puntos.</li>
          <li>Test de permutación (motorización asignada al azar): ${pval(R.p_permutacion)}.</li>
          <li>Controlando también por la alternativa en transporte público (GTFS): ${pp(R.control_transporte_alternativo.coef_pp)} puntos (${pval(R.control_transporte_alternativo.p)}).</li>
          <li>En los municipios sin Rodalies no aparece ninguna relación (${pval(R.placebo_sin_rodalies.p_motorizacion)}): el método no la inventa.</li></ul>
        <ul class="checks warn">
          <li>Evidencia moderada: sin ponderar por el ruido de cada municipio, ${pp(R.sin_pesos.coef_pp)} puntos (${pval(R.sin_pesos.p)}). Mismo signo los 4 días, pero ningún día por separado es significativo.</li>
          ${ren13 ? `<li>Renta: solo en la avería sin aviso (${fecha(ren13.fecha)}) los municipios con más renta caen más (${pp(ren13.coef_renta)} puntos por +1.000 €, ${pval(ren13.p_renta)}). ¿Teletrabajo ante un imprevisto? Es una hipótesis, no una conclusión.</li>` : ''}</ul></div>`;
  }

  function pintarMetodo() {
    // Notación matemática en HTML: variables en cursiva, fracciones apiladas, subíndices.
    const v = (x) => `<i>${x}</i>`;
    const fr = (a, b) => `<span class="fr"><span>${a}</span><span>${b}</span></span>`;
    const med = (x) => `med<sub>${v('s')}∈${v('R')}(${v('t')})</sub> ${x}`;
    const G = D.grupos.find((g) => g.grupo === 'dependientes'), P = D.placebo, PM = D.perdidos_media;
    const plac = P.valores_pct.slice().sort((a, b) => a - b), q = (f) => plac[Math.min(plac.length - 1, Math.max(0, Math.round(f * (plac.length - 1))))];
    const pre = D.evento.filter((e) => e.dia < 0), preMin = Math.min(...pre.map((e) => e.efecto_pct)), preMax = Math.max(...pre.map((e) => e.efecto_pct));
    const T = Object.fromEntries(D.tipos.map((t) => [t.id, t.coeficientes]));
    const VR = D.vulnerabilidad_resumen, R = VR && VR.robustez, mot = VR && VR.modelo.find((x) => x.variable === 'tur100');
    const pp = (x) => `${x > 0 ? '+' : ''}${nf(x, 1)}`;
    const sec = (id, n, titulo, cuerpo) => `<section class="card msec" id="m-${id}"><h2><span class="mn">${n}</span>${titulo}</h2>${cuerpo}</section>`;
    const porque = (html) => `<div class="mwhy"><b>Por qué es válido.</b> ${html}</div>`;
    const indice = [['pregunta', 'La pregunta'], ['datos', 'Datos y muestra'], ['referencia', 'Qué es un día normal'], ['estimador', 'El estimador'], ['inferencia', 'Incertidumbre: placebos'],
      ['regresion', 'Comprobación: regresión'], ['viajes', 'De % a viajes y simulador'], ...(VR ? [['vulnerabilidad', 'Motorización y renta']] : []), ['significacion', 'Cómo leer la p'], ['limites', 'Limitaciones']];

    $('lab-metodo').innerHTML = `<div class="metodo">
      <nav class="mtoc" aria-label="Secciones del método">${indice.map(([id, t], i) => `<a href="#" data-m="${id}"><span>${i}</span>${t}</a>`).join('')}</nav>
      <div class="mbody">

      ${sec('pregunta', 0, 'La pregunta y la idea', `
        <p>¿Cuántos viajes a Barcelona deja de hacer un municipio el día que falla Rodalies, frente a los que habría hecho sin la incidencia? Ese «sin incidencia» no se observa: se <b>construye</b> con dos referencias que el caos no puede tocar.</p>
        <ol class="mlist"><li><b>Días normales parecidos</b> del mismo municipio: fijan su nivel habitual.</li><li><b>Municipios sin Rodalies</b> el mismo día: miden lo que le pasa a todo el mundo ese día (tiempo, estacionalidad, demanda).</li></ol>
        <div class="mkpis"><div><strong class="down">${pct(G.efecto_pct)}</strong><span>dependientes, media de los ${D.incidencias.length} días de caos</span></div><div><strong>[${nf(G.ic_inf, 1)}, ${nf(G.ic_sup, 1)}] %</strong><span>intervalo del 95 %</span></div><div><strong>${pval(P.p_valor)}</strong><span>frente a días normales</span></div><div><strong>${nf(PM.viajes_perdidos)}</strong><span>viajes menos por día de caos, de ${nf(PM.viajes_dia_normal)}</span></div></div>`)}

      ${sec('datos', 1, 'Datos y muestra', `
        <p>${v('V')}<sub>${v('m')},${v('t')}</sub> = viajes del municipio ${v('m')} a Barcelona el día ${v('t')} (Telefónica, segmentos Regional y Residente, cualquier modo), ${fecha(D.periodo.inicio)} – ${fecha(D.periodo.fin)}. Para un grupo ${v('G')} de municipios, ${v('V')}<sub>${v('G')},${v('t')}</sub> = Σ<sub>${v('m')}∈${v('G')}</sub> ${v('V')}<sub>${v('m')},${v('t')}</sub>.</p>
        <table class="tbl compact mtab"><thead><tr><th>Grupo</th><th>Definición</th><th class="num">Municipios</th></tr></thead><tbody>
          <tr><td>Dependientes</td><td>Rodalies, sin metro ni FGC, ≥ 20 km</td><td class="num">35</td></tr>
          <tr><td>Cercanos</td><td>Rodalies, sin metro ni FGC, &lt; 20 km</td><td class="num">16</td></tr>
          <tr><td>Con metro/FGC</td><td>Rodalies y alternativa ferroviaria</td><td class="num">11</td></tr>
          <tr><td><b>Control ${v('C')}</b></td><td>Sin estación de Rodalies</td><td class="num">71</td></tr></tbody></table>
        <p class="small">Solo municipios con ≥ 200 viajes/día. <b>Días limpios ${v('L')}</b>: 273 laborables (119 en 2023, 97 en 2024, 57 en 2025) sin festivos, puentes, verano, eventos, mal tiempo (lluvia ≥ 2 mm, ≥ 0,5 mm entre 6 y 10 h o rachas ≥ 60 km/h), incidencias del registro oficial de Rodalies (más los cortes largos completos) ni los 5 días con errores en los datos. <b>Días de caos</b>: ${D.incidencias.map((i) => fecha(i.fecha)).join(', ')} (el 19/03/2025 se descarta por lluvia).</p>
        ${porque(`el control no tiene estación, así que <b>ninguna incidencia de Rodalies le afecta</b>: todo lo que cambia en él un día de caos es choque común. Los días limpios aíslan la variación normal: cualquier otro choque (lluvia, festivo, otra avería) contaminaría la referencia.`)}`)}

      ${sec('referencia', 2, 'Qué es un día normal: tipos de día', `
        <p>Cada año, los días limpios se agrupan con <b>K-means (${v('k')} = 4)</b> sobre dos variables estandarizadas: el volumen del control y la época del año.</p>
        <div class="eq">${v('x')}<sub>${v('t')}</sub> = ( ln ${v('V')}<sub>${v('C')},${v('t')}</sub> ,&nbsp; día del año / 365 ) &nbsp;&nbsp;→&nbsp;&nbsp; ${v('R')}(${v('t')}) = { ${v('s')} ∈ ${v('L')} : mismo año y mismo tipo que ${v('t')} }</div>
        <p>El «día normal» de un grupo es la <b>mediana</b> de sus viajes en ${v('R')}(${v('t')}).</p>
        ${porque(`(1) El tipo se asigna <b>solo con el control</b>: un día de caos no puede parecer un «día flojo» por su propia caída, así que la referencia no depende del resultado (sin circularidad). (2) Mismo año y época: la tendencia y la estacionalidad quedan fuera de la comparación. (3) La mediana no se mueve por un día atípico dentro del tipo. (4) ${v('k')} y las variables se eligieron minimizando el error en días limpios usados como falsos días de caos, <b>sin mirar los días de caos</b>.`)}`)}

      ${sec('estimador', 3, 'El estimador', `
        <div class="eq big">${v('ê')}<sub>${v('G')}</sub>(${v('t')}) = ln ${fr(`${v('V')}<sub>${v('G')},${v('t')}</sub>`, med(`${v('V')}<sub>${v('G')},${v('s')}</sub>`))} − ln ${fr(`${v('V')}<sub>${v('C')},${v('t')}</sub>`, med(`${v('V')}<sub>${v('C')},${v('s')}</sub>`))}
          <span class="eqr">efecto = 100 · (e<sup>${v('ê')}</sup> − 1) %</span></div>
        <p>Con varios días de caos se promedia: ${v('ê')}<sub>${v('G')}</sub> = <sup>1</sup>⁄<sub>${v('n')}</sub> Σ<sub>${v('t')}</sub> ${v('ê')}<sub>${v('G')}</sub>(${v('t')}). Es una diferencia en diferencias: el cambio del grupo frente a su normal, menos el cambio del control frente al suyo.</p>
        ${porque(`supongamos ln ${v('V')}<sub>${v('G')},${v('t')}</sub> = ${v('a')}<sub>${v('G')}</sub> + ${v('λ')}<sub>${v('t')}</sub> + ${v('τ')}·caos<sub>${v('t')}</sub> + ${v('u')}<sub>${v('G')},${v('t')}</sub> y ln ${v('V')}<sub>${v('C')},${v('t')}</sub> = ${v('a')}<sub>${v('C')}</sub> + ${v('λ')}<sub>${v('t')}</sub> + ${v('u')}<sub>${v('C')},${v('t')}</sub>. Dividir por la mediana elimina el nivel ${v('a')}; restar el control elimina el choque común ${v('λ')}<sub>${v('t')}</sub>. Queda ${v('ê')} = ${v('τ')} + ruido. Esto exige <b>tendencias paralelas</b>: sin incidencia, grupo y control se moverían igual. Se comprueba: los 5 días laborables anteriores al caos dan entre ${pct(preMin)} y ${pct(preMax)}, ninguno significativo. Trabajar en logaritmos hace el efecto multiplicativo (comparable entre municipios de distinto tamaño), y sumar volúmenes da el efecto sobre el viajero medio.`)}`)}

      ${sec('inferencia', 4, 'Incertidumbre: placebos (prueba de permutación)', `
        <p>No se supone ninguna distribución del error: se <b>mide</b>. Cada día limpio ${v('d')} se trata como un falso día de caos, con el clustering reentrenado sin ${v('d')}, y se calcula ${v('ê')}*(${v('d')}). Son ${v('N')} = 272 realizaciones del estimador cuando el efecto real es 0.</p>
        <div class="eq">${v('p')} = ${fr(`1 + #{ ${v('ê')}* ≤ ${v('ê')} }`, `${v('N')} + 1`)} &nbsp;&nbsp;&nbsp;&nbsp; IC<sub>95</sub> = [ ${v('ê')} − ${v('q')}<sub>0,975</sub>(${v('ê')}*) ,&nbsp; ${v('ê')} − ${v('q')}<sub>0,025</sub>(${v('ê')}*) ]</div>
        <p class="small">Con ${v('n')} días de caos, ${v('ê')}* es la media de ${v('n')} placebos al azar (20.000 réplicas). Por municipio la prueba es bilateral: ${v('p')} = min(1, 2·min(${v('p')}<sub>↓</sub>, ${v('p')}<sub>↑</sub>)).</p>
        ${porque(`si la incidencia no tuviera efecto, el día de caos sería <b>intercambiable</b> con cualquier día limpio. Entonces su rango entre los placebos es uniforme y el «+1» hace la prueba <b>exacta</b>: P(${v('p')} ≤ α) ≤ α con cualquier tamaño de muestra, sin suponer normalidad ni independencia entre municipios (los placebos conservan la correlación real). Reentrenar sin ${v('d')} evita que un placebo esté en su propia referencia, lo que subestimaría el ruido. El intervalo invierte la prueba: son los efectos que no se rechazarían al 5 %.`)}
        <div class="mres"><b>Resultado.</b> 200 grupos de ${D.incidencias.length} días normales al azar: el 95 % entre ${pct(q(0.025))} y ${pct(q(0.975))}. El efecto real (${pct(P.real_pct)}) no lo alcanza <b>ninguno</b> (${pval(P.p_valor)}). La caída no es ruido ni un artefacto del método.</div>`)}

      ${sec('regresion', 5, 'Comprobación: regresión de diferencias en diferencias', `
        <div class="eq">ln ${v('V')}<sub>${v('m')},${v('t')}</sub> = ${v('α')}<sub>${v('m')},dow(${v('t')})</sub> + ${v('δ')}<sub>${v('t')}</sub> + ${v('β')} · tratado<sub>${v('m')},${v('t')}</sub> + ${v('ε')}<sub>${v('m')},${v('t')}</sub></div>
        <p class="small">${v('α')}: nivel de cada municipio cada día de la semana. ${v('δ')}<sub>${v('t')}</sub>: efecto fijo de fecha (choque común). tratado = 1 si ${v('m')} es del grupo y ${v('t')} es día de caos. Efecto = 100·(e<sup>${v('β')}</sup> − 1). Errores agrupados por municipio.</p>
        <table class="tbl compact mtab"><thead><tr><th>Caso</th><th class="num">Placebos (principal)</th><th class="num">Regresión</th></tr></thead><tbody>
          <tr><td>Media de los días de caos · dependientes</td><td class="num">−6,2 %</td><td class="num">−6,8 %</td></tr>
          <tr><td>Huelga 17/03/2025 · dependientes</td><td class="num">−8,9 %</td><td class="num">−10,7 %</td></tr>
          <tr><td>Avería 13/05/2024 · dependientes</td><td class="num">−10,3 %</td><td class="num">−8,5 %</td></tr>
          <tr><td>Avería 13/05/2024 · dependientes R1</td><td class="num">−13,5 %</td><td class="num">−17,2 %</td></tr></tbody></table>
        ${porque(`es un método independiente (modelo paramétrico, mismo peso para cada municipio, todos los días limpios del periodo) y da la <b>misma dirección y significación</b>. Si el resultado fuera un artefacto de los tipos de día o de las medianas, no se reproduciría. Las diferencias de tamaño se explican porque el método principal pondera por volumen.`)}`)}

      ${sec('viajes', 6, 'De porcentaje a viajes, y el simulador', `
        <div class="eq">viajes perdidos<sub>${v('G')}</sub>(${v('t')}) = ${med(`${v('V')}<sub>${v('G')},${v('s')}</sub>`)} × (1 − e<sup>${v('ê')}<sub>${v('G')}</sub>(${v('t')})</sup>)</div>
        <p>Es el efecto aplicado al volumen de un día normal: de media ${nf(PM.viajes_perdidos)} viajes menos de ${nf(PM.viajes_dia_normal)}. El <b>simulador</b> hace lo mismo municipio a municipio con el coeficiente observado más parecido al escenario:</p>
        <ul class="mlist small">
          <li><b>Avería sin aviso:</b> dependientes de la R1 el 13/05/2024 (${pct(T.averia.dependiente_linea_cortada.efecto)}, ${pval(T.averia.dependiente_linea_cortada.p)}). Solo se ha observado en la R1: en otras líneas es una extrapolación y el dashboard lo marca.</li>
          <li><b>Huelga general:</b> coeficiente de cada línea el 17/03/2025.</li>
          <li><b>Huelga anunciada:</b> media de los coeficientes del 26/03 y el 01/04/2025, con ${v('p')} = max(${v('p')}<sub>1</sub>, ${v('p')}<sub>2</sub>): solo es significativo si lo es <b>cada</b> día por separado (prueba de intersección-unión, nivel ≤ 5 %; conservadora).</li></ul>
        <p class="small"><b>Tramos de la red:</b> esperado = ${v('V')}<sub>${v('C')},${v('t')}</sub> × proporción habitual tramo/control (días limpios del mismo año y día de la semana); la significación se mide frente a la variación de ese total en los días limpios.</p>
        ${porque(`como ${v('ê')} es un cambio relativo, multiplicarlo por el volumen normal da su equivalente en viajes. Es una aproximación: supone que el efecto del grupo vale para cada municipio que lo forma y solo cubre el primer día (los días +1 a +3 vuelven a la normalidad).`)}`)}

      ${VR ? sec('vulnerabilidad', 7, 'Motorización y renta: regresión ponderada', `
        <div class="eq">${v('ê')}<sub>${v('m')}</sub> = ${v('β')}<sub>0</sub> + ${v('β')}<sub>1</sub>·tur100<sub>${v('m')}</sub> + ${v('β')}<sub>2</sub>·renta<sub>${v('m')}</sub> + ${v('β')}<sub>3</sub>·dist10<sub>${v('m')}</sub> + ${v('β')}<sub>4</sub>·metroFGC<sub>${v('m')}</sub> + ${v('u')}<sub>${v('m')}</sub>, &nbsp;&nbsp; pesos ${v('w')}<sub>${v('m')}</sub> = 1 / ${v('σ')}<sub>${v('m')}</sub><sup>2</sup></div>
        <p class="small">${v('ê')}<sub>${v('m')}</sub>: efecto medio del municipio en los días de caos (mismo estimador). ${v('σ')}<sub>${v('m')}</sub>: desviación típica de la media de ${D.incidencias.length} placebos del municipio (su ruido). ${VR.muestra} municipios con Rodalies, errores robustos HC1.</p>
        <p><b>+100 turismos por 1.000 hab. → ${nf(mot.coef_pp, 1)} puntos menos de caída</b> (IC [${pp(mot.ic_inf)}, ${pp(mot.ic_sup)}], ${pval(mot.p)}), a igual distancia, renta y alternativa. R² = ${nf(VR.r2, 2)}.</p>
        ${porque(`el ruido de un municipio pequeño (${v('σ')} de 14–20 puntos) es 10 veces el de uno grande (1–2 puntos). Con varianzas distintas y conocidas, ponderar por 1/${v('σ')}<sup>2</sup> da el estimador lineal insesgado de <b>mínima varianza</b> (mínimos cuadrados generalizados, Aitken); HC1 protege si los pesos no son exactos. Robustez: quitando un municipio cada vez, el coeficiente está entre ${nf(R.quitar_un_municipio[0], 1)} y ${nf(R.quitar_un_municipio[1], 1)}; permutando la motorización, ${pval(R.p_permutacion)}; en el control (donde no debería haber relación), ${pval(R.placebo_sin_rodalies.p_motorizacion)}. Sin pesos, ${pval(R.sin_pesos.p)}: la evidencia es <b>moderada</b>.`)}`) : ''}

      ${sec('significacion', VR ? 8 : 7, 'Cómo leer la significación', `
        <ul class="mlist">
          <li><b>${v('p')} &lt; 0,05</b> → efecto significativo: si no hubiera efecto, una caída así saldría en menos del 5 % de los días normales.</li>
          <li><b>No significativo no es «sin efecto»</b>: con 4 días de caos y municipios pequeños, el intervalo es ancho. El dashboard lo indica y no lo usa como hallazgo.</li>
          <li><b>Pruebas múltiples:</b> con decenas de pruebas (días × líneas × municipios) se esperan algunos falsos positivos al 5 %. Por eso las conclusiones se apoyan en los <b>agregados</b> (grupos, media de días, placebo global con ${pval(P.p_valor)}) y en patrones que se repiten; un resultado aislado (renta solo el 13/05, 1 de 8 pruebas) se presenta como hipótesis.</li></ul>`)}

      ${sec('limites', VR ? 9 : 8, 'Limitaciones', `<ul class="checks warn mchecks">${D.limitaciones.map((l) => `<li>${esc(l)}</li>`).join('')}<li>${esc(D.duracion.pendiente)}</li></ul>`)}
      </div></div>`;

    const cont = $('lab-metodo');
    const enlaces = cont.querySelectorAll('[data-m]');
    const marca = (id) => enlaces.forEach((a) => { const on = a.dataset.m === id; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    enlaces.forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const s = $('m-' + a.dataset.m);
      if (s) s.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));
    // Índice activo: se marca la sección que ocupa la parte alta de la pantalla mientras se lee
    if (pintarMetodo.io) pintarMetodo.io.disconnect();
    if ('IntersectionObserver' in window) {
      pintarMetodo.io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) marca(e.target.id.slice(2)); }), { rootMargin: '-15% 0px -75% 0px' });
      cont.querySelectorAll('.msec').forEach((s) => pintarMetodo.io.observe(s));
    }
    marca(indice[0][0]);
  }

  // ------------------------------------------------------------------ cabecera: se esconde y aparece al acercar el ratón
  /* Con ratón:
   *  · Relato: visible arriba del todo; se esconde al bajar con el scroll y vuelve al subir.
   *  · Planificador y Laboratorio: escondida para dejar toda la pantalla al contenido.
   *  · En todas: aparece al llevar el ratón al borde superior y se va al alejarlo. Al entrar en una página se
   *    muestra un momento para que se vea que está ahí. Cuando está escondida queda a la vista el filete naranja.
   * En pantallas táctiles (sin ratón) solo cuenta el scroll: se esconde al bajar y vuelve al subir. */
  (function barra() {
    const bar = document.querySelector('.topbar'), raiz = document.documentElement;
    const conRaton = matchMedia('(hover: hover) and (pointer: fine)');
    let y0 = scrollY, pendiente = false, porScroll = false, encima = false, aviso = null;
    const fija = () => conRaton.matches && document.body.dataset.modo !== 'relato';   // planificador y laboratorio
    const aplicar = () => {
      const oculta = !encima && (fija() || porScroll);
      bar.classList.toggle('oculta', oculta); raiz.classList.toggle('barra-oculta', oculta);
      bar.classList.toggle('flotando', !oculta && (fija() || scrollY > 0));
    };
    const mostrarUnMomento = () => {
      encima = true; aplicar(); clearTimeout(aviso);
      aviso = setTimeout(() => { encima = false; aplicar(); }, 1500);
    };
    addEventListener('scroll', () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        const y = scrollY, d = y - y0;
        if (y < bar.offsetHeight) { porScroll = false; y0 = y; }
        else if (d > 8) { porScroll = true; y0 = y; }
        else if (d < -8) { porScroll = false; y0 = y; }
        aplicar();
      });
    }, { passive: true });
    document.addEventListener('mousemove', (e) => {
      if (!conRaton.matches) return;
      // Aparece al llegar al borde (24 px); mientras está abierta, se mantiene con el ratón encima de ella
      const ahora = e.clientY <= (bar.classList.contains('oculta') ? 24 : bar.offsetHeight + 16);
      if (aviso && !ahora) return;   // el aviso al entrar dura su segundo y medio aunque se mueva el ratón
      if (ahora !== encima || aviso) { clearTimeout(aviso); aviso = null; encima = ahora; aplicar(); }
    });
    document.documentElement.addEventListener('mouseleave', () => { encima = false; aplicar(); });
    addEventListener('hashchange', () => { porScroll = false; if (conRaton.matches) mostrarUnMomento(); else aplicar(); });
    if (conRaton.matches) mostrarUnMomento(); else aplicar();
  })();

  // ------------------------------------------------------------------ tema claro / oscuro
  /* Por defecto, oscuro; el botón fija «claro» u «oscuro» y lo recuerda (localStorage). Los mapas y los
   * gráficos se dibujan con los colores del tema al crearse, así que al cambiar se recarga la página en el mismo
   * sitio (la sección, el escenario y el scroll se conservan; la subpestaña del Laboratorio también). */
  (function botonTema() {
    const b = $('tema'), raiz = document.documentElement;
    const actual = () => raiz.dataset.tema || 'oscuro';   // el oscuro es el tema por defecto
    const pintar = () => {
      const t = actual(), otro = t === 'oscuro' ? 'claro' : 'oscuro';
      b.dataset.actual = t; b.title = `Cambiar a tema ${otro}`; b.setAttribute('aria-label', b.title);
    };
    pintar();
    b.addEventListener('click', () => {
      const nuevo = actual() === 'oscuro' ? 'claro' : 'oscuro';
      try { localStorage.setItem('rmove-tema', nuevo); } catch (e) { /* sin almacenamiento: solo esta visita */ }
      const lab = document.querySelector('#lab-nav button.active');
      if (lab) try { sessionStorage.setItem('rmove-lab', lab.dataset.lab); } catch (e) {}
      raiz.dataset.tema = nuevo; pintar();
      location.reload();
    });
  })();

  // ------------------------------------------------------------------ navegación
  function route() {
    const [ruta, qs] = location.hash.replace('#', '').split('?');
    const [modo0, arg] = (ruta || 'relato').split('/');
    // Enlaces antiguos: «¿Y si…?» (#simulador) y «Mi municipio» (#municipio/código) ahora son el planificador.
    let params = qs ? new URLSearchParams(qs) : null;
    if (modo0 === 'municipio') params = new URLSearchParams(arg ? `mun=${arg}&vista=perfil` : 'vista=perfil');
    const modo = modo0 === 'simulador' || modo0 === 'municipio' ? 'planificador' : modo0;
    if (modo !== modo0) history.replaceState(null, '', '#planificador' + (params ? '?' + params : ''));
    const valido = ['relato', 'planificador', 'laboratorio'].includes(modo) ? modo : 'relato';
    document.querySelectorAll('.mode').forEach((s) => { s.hidden = s.id !== 'mode-' + valido; });
    // Navegación en forma de línea de tren: el tren se desplaza hasta la parada de la sección activa
    const orden = ['relato', 'planificador', 'laboratorio'], i = orden.indexOf(valido);
    document.querySelectorAll('.linea a').forEach((a) => { const k = orden.indexOf(a.dataset.mode); a.classList.toggle('active', k === i); a.classList.toggle('pasada', k < i); });
    document.querySelector('.linea').style.setProperty('--i', i);
    const sec = $('mode-' + valido);
    // Sentido del cambio, el mismo que el del tren: hacia la derecha la página se desliza a la izquierda, y al revés
    const antes = orden.indexOf(document.body.dataset.modo);
    if (antes >= 0 && antes !== i) document.documentElement.dataset.dir = i > antes ? 'adelante' : 'atras';
    if (!document.startViewTransition && document.body.dataset.modo && document.body.dataset.modo !== valido) { sec.classList.remove('entra'); void sec.offsetWidth; sec.classList.add('entra'); }
    document.body.dataset.modo = valido;
    if (valido !== 'relato') scrollTo(0, 0);
    ({ relato: initRelato, planificador: () => initSimulador(params), laboratorio: initLaboratorio })[valido]();
  }

  Promise.all([
    fetch(DATA_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('observatorio.json'); return r.json(); }),
    fetch(RAIL_URL, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(CONTORNO_URL, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([d, rail, contorno]) => {
    D = d; RAIL = rail; CONTORNO = contorno;
    PC = new Map(D.municipios.map((m) => [m.codigo, m]));
    crearRayados();
    if (!RAIL) $('status').textContent = 'No se ha encontrado la cartografía de Rodalies (railway-network.geojson): los mapas se muestran sin la red.';
    // Tablero de la cabecera (estilo panel de salidas): cifras del propio análisis
    const periodo = `${D.periodo.inicio.slice(0, 4)}–${D.periodo.fin.slice(0, 4)}`;
    $('tablero').innerHTML = [['Municipios', D.municipios.length], ['Datos', periodo]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('foot').textContent = `${D.fuente} · ${fecha(D.periodo.inicio)} – ${fecha(D.periodo.fin)}. Observatorio R-MOVE v2 · Team 202_E.`;
    cargarBase().then((b) => { b.features.forEach((f) => COMARCA.set(f.properties.codigo, f.properties.comarca)); }).catch(() => {});
    // Cambio de sección con fundido cruzado (View Transitions) donde el navegador lo permite
    addEventListener('hashchange', () => {
      const m0 = location.hash.replace('#', '').split(/[/?]/)[0] || 'relato', modo = m0 === 'simulador' || m0 === 'municipio' ? 'planificador' : m0;
      if (document.startViewTransition && modo !== document.body.dataset.modo) {
        // Si se cambia de página antes de que acabe la transición, el navegador la salta: no es un error
        const vt = document.startViewTransition(route); vt.ready.catch(() => {}); vt.finished.catch(() => {});
      }
      else route();
    });
    route();
  }).catch((e) => {
    $('status').innerHTML = `No se han podido cargar los datos (${esc(e.message)}). Ejecuta <code>python src/dashboard-v2/build_observatorio.py</code> y sirve el repositorio desde la raíz con <code>python -m http.server 8000</code>.`;
  });
})();
