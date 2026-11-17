# ── Exportación para el dashboard: pestañas «Incidencias» y «Resultados» ─────
# Ejecutar AL FINAL del notebook (usa los objetos de las secciones 1–5 y del anexo B).
import hashlib, json, math

def exportar_resultados(destino=None):
    destino = destino or (PROC / "rmove" / "resultados" / "dashboard_resultados.json")

    def num(x, d=2):
        x = float(x); assert math.isfinite(x), "Valor no finito"; return round(x, d)
    def efecto(f):          # fila de comparar() → efecto, IC y p de la regresión
        lo, hi = map(float, f["regresión_IC95"].strip("[]").split(","))
        return {"efecto_pct": num(f["regresión_%"]), "ic_inf": num(lo), "ic_sup": num(hi), "p_valor": num(f["regresión_p"], 4)}

    NOMBRES_LINEA = {"R1": "R1", "R2N": "R2 Nord", "R2S": "R2 Sud", "R3": "R3", "R4": "R4", "R7": "R7"}
    TODAS = ["R1", "R2 Nord", "R2 Sud", "R3", "R4", "R7"]
    FICHAS = {
        "2024-05-13": {"titulo": "Robo de cobre en Montcada", "tipo": "Avería",
                       "descripcion": "Primer día laborable tras el robo de cable en Montcada Bifurcació (domingo 12/05). Avería sin aviso previo.",
                       "tramo": "R1 solo entre Badalona y Arenys · R3 solo hasta Montcada Ripollet · R4 Nord hasta Cerdanyola y R4 Sud hasta L'Hospitalet · R7 sin servicio",
                       "lineas": ["R1", "R2 Nord", "R3", "R4", "R7"],
                       "lectura": "Caída concentrada en la línea cortada: el Maresme (R1), sobre todo al norte de Arenys, donde no había tren."},
        "2025-03-17": {"titulo": "Huelga de Rodalies", "tipo": "Huelga",
                       "descripcion": "Huelga de los sindicatos minoritarios contra el traspaso de Rodalies: retrasos y supresiones en toda la red.",
                       "tramo": "Toda la red", "lineas": TODAS,
                       "lectura": "Caos generalizado: caen los corredores más alejados, Osona (R3), Garraf (R2 Sud) y Maresme norte (R1)."},
        "2025-03-26": {"titulo": "Huelga de 24 horas", "tipo": "Huelga",
                       "descripcion": "Jornada de huelga anunciada en Rodalies.",
                       "tramo": "Toda la red", "lineas": TODAS,
                       "lectura": "Huelga anunciada: el Garraf (R2 Sud) es el corredor que más cae."},
        "2025-04-01": {"titulo": "Huelga de 24 horas", "tipo": "Huelga",
                       "descripcion": "Jornada de huelga anunciada en Rodalies. Coincide con averías de electrificación en la R4 (Castellbisbal) y la R2 Nord (vía única La Llagosta–Sant Andreu) desde el 31/03.",
                       "tramo": "Toda la red", "lineas": TODAS,
                       "lectura": "Huelga anunciada: el Garraf (R2 Sud) vuelve a ser el corredor más afectado."},
    }
    grupo_json = {"Dependiente": "dependientes", "Cercano sin metro/FGC": "cercanos",
                  "Con metro/FGC": "metro_fgc", "Sin Rodalies (control)": "sin_rodalies"}
    grupos_reg = {"dependientes": info.index[info.dependiente],
                  "cercanos": info.index[info.grupo == "Cercano sin metro/FGC"],
                  "metro_fgc": info.index[info.con_alt]}
    limpios = todos[todos.fecha.isin(cal.index[cal.limpio])]
    viajes_ref = limpios.groupby("municipio_code").viajes.median()

    incidencias = []
    for d in sorted(caos_real):
        fecha = d.strftime("%Y-%m-%d"); ficha = FICHAS.get(fecha, {"titulo": DIAS_CAOS[fecha], "tipo": "", "descripcion": "",
                                                                    "tramo": "", "lineas": [], "lectura": ""})
        # 1) Efecto por grupo (regresión, con IC)
        tabla = comparar(grupos_reg, [d])
        grupos = [{"grupo": g, "municipios": int(f.municipios), **efecto(f)} for g, f in tabla.iterrows()]
        dep_ef = next(g for g in grupos if g["grupo"] == "dependientes")
        normal = viajes_normales(DEP, d)

        # 2) Serie: dependientes vs control alrededor del día (100 = día normal)
        lab = cal.index[~(cal.finde | cal.festivo)]
        i = lab.get_loc(d); fechas = lab[max(0, i - 10): i + 11]
        ref = fechas[cal.loc[fechas, "limpio"].values]
        if len(ref) < 5: ref = cal.index[cal.limpio & (cal.index.year == d.year)]
        idx_dep = tot_dep.reindex(fechas) / tot_dep.reindex(ref).median() * 100
        idx_ctrl = tot_ctrl.reindex(fechas) / tot_ctrl.reindex(ref).median() * 100
        lo, hi = idx_dep.reindex(ref).quantile([.05, .95])
        serie = [{"fecha": f.strftime("%Y-%m-%d"), "dependientes": num(idx_dep[f]), "control": num(idx_ctrl[f]),
                  "limpio": bool(cal.at[f, "limpio"]), "caos": bool(f in caos_real)}
                 for f in fechas if math.isfinite(idx_dep[f]) and math.isfinite(idx_ctrl[f])]

        # 3) Volumen total por tramo de línea (sección 4.1)
        tramos = []
        for etiqueta, linea, selector, afectada in TRAMOS.get(fecha, []):
            codes = municipios_tramo(linea, selector)
            if not codes: continue
            r = efecto_volumen(codes, d)
            tramos.append({"tramo": etiqueta, "linea": NOMBRES_LINEA.get(linea.split()[0], linea) + (" " + linea.split()[1] if " " in linea else ""),
                           "afectada": bool(afectada), "municipios": len(codes),
                           "viajes_esperados": num(r["viajes_esperados"], 0), "viajes_perdidos": num(r["viajes_perdidos"], 0),
                           "cambio_pct": num(r["cambio_%"]), "normal_inf": num(r["normal_lo"]), "normal_sup": num(r["normal_hi"]),
                           "p_valor": num(r["p"], 4), "lista": ", ".join(lm.loc[codes, "municipio"])})

        # 4) Dependientes por línea (sección 4.2)
        lineas_dep = [{"linea": f.linea, "municipios": int(f.municipios), "efecto_pct": num(f["cambio_%"]),
                       "ic_inf": num(f.lo), "ic_sup": num(f.hi), "p_valor": num(f.p, 4),
                       "viajes_perdidos": num(f.viajes_perdidos, 0)}
                      for _, f in res_lineas[res_lineas.fecha == d].iterrows()]

        # 5) Municipio a municipio
        r = efectos_municipio(d)
        municipios = [{"codigo": c, "nombre": f.municipio, "grupo": grupo_json[f.grupo], "lineas": f.lineas,
                       "dist_km": num(f.dist_km, 1), "lat": num(f.stop_lat, 5), "lon": num(f.stop_lon, 5),
                       "viajes_referencia": num(viajes_ref.get(c, f.viajes_dia), 0),
                       "efecto_pct": num(f["efecto_%"]), "p_valor": num(f.p, 4)}
                      for c, f in r.sort_index().iterrows()]

        # 6) Duración en esta incidencia (event study individual)
        b = base[~base.fecha.isin(set(caos_real) - {d})].copy()
        fechas_d = np.sort(b.fecha.unique()); i0 = list(fechas_d).index(np.datetime64(d))
        rel_d = pd.Series("fuera", index=pd.DatetimeIndex(fechas_d))
        for k in range(-5, 4):
            if 0 <= i0 + k < len(fechas_d): rel_d.iloc[i0 + k] = str(k)
        b["rel_dep"] = np.where(b.dependiente == 1, b.fecha.map(rel_d), "fuera")
        tt = pf.feols("y ~ i(rel_dep, ref='fuera') | mun_dow + fecha", data=b, vcov={"CRV1": "municipio_code"}).tidy()
        evento = sorted([{"dia": int(ix.split("::")[-1]), "efecto_pct": num((np.exp(f.Estimate) - 1) * 100),
                          "ic_inf": num((np.exp(f["2.5%"]) - 1) * 100), "ic_sup": num((np.exp(f["97.5%"]) - 1) * 100)}
                         for ix, f in tt.iterrows()], key=lambda e: e["dia"])

        incidencias.append({
            "fecha": fecha, **ficha, "grupos": grupos,
            "perdidos": {"viajes_dia_normal": num(normal, 0), "viajes_perdidos": num(-normal * dep_ef["efecto_pct"] / 100, 0),
                         "efecto_pct": dep_ef["efecto_pct"], "p_valor": dep_ef["p_valor"]},
            "serie": serie, "banda_normal": {"inf": num(lo), "sup": num(hi)},
            "tramos": tramos, "lineas_dependientes": lineas_dep, "municipios": municipios, "evento": evento,
            "caso_od": fecha in ("2025-03-17",)})
        print(f"{fecha}: {len(municipios)} municipios, {len(tramos)} tramos, {len(lineas_dep)} líneas")

    # Resultados globales (media de los días de caos)
    grupos_glob = [{"grupo": k, "etiqueta": n, "municipios": int(f.municipios), **efecto(f)}
                   for (n, f), k in zip(res_grupos.iterrows(), ["dependientes", "cercanos", "metro_fgc"])]
    distancia = [{"banda": n.replace("Sin metro/FGC · ", ""), "municipios": int(f.municipios), **efecto(f)}
                 for n, f in res_dist.iterrows()]
    evento = [{"dia": int(f.k), "efecto_pct": num(f["efecto_%"]), "ic_inf": num(f.lo), "ic_sup": num(f.hi)}
              for _, f in t.sort_values("k").iterrows()]
    assert [e["dia"] for e in evento] == list(range(-5, 4))
    dia0 = next(e for e in evento if e["dia"] == 0)
    placebo = {"real_pct": num((np.exp(obs) - 1) * 100), "p_valor": num(p_plac, 4),
               "valores_pct": [num((np.exp(v) - 1) * 100) for v in plac]}
    perd = [i["perdidos"] for i in incidencias]
    perdidos_media = float(np.mean([p["viajes_perdidos"] for p in perd]))
    normal_media = float(np.mean([p["viajes_dia_normal"] for p in perd]))
    dep_g = grupos_glob[0]; lejos = distancia[-1]; cerca = distancia[0]
    fmt = lambda v, d=1: f"{v:+.{d}f}".replace(".", ",").replace("-", "−")
    miles_ = lambda v: f"{v:,.0f}".replace(",", ".")

    barrios = [   # M3 (copiado de m3_hallazgos.md, H2)
        {"caso": "Todos los días de caos", "sentido": "ida",    "con_estacion": -19.0, "sin_estacion": 1.8,   "p_diferencia": 0.0009},
        {"caso": "Todos los días de caos", "sentido": "vuelta", "con_estacion": -18.3, "sin_estacion": 4.9,   "p_diferencia": 0.0009},
        {"caso": "Huelga 17/03/2025",      "sentido": "ida",    "con_estacion": -18.4, "sin_estacion": -10.1, "p_diferencia": 0.235},
        {"caso": "Huelga 17/03/2025",      "sentido": "vuelta", "con_estacion": -14.1, "sin_estacion": 4.1,   "p_diferencia": 0.018},
        {"caso": "Avería 13/05/2024",      "sentido": "ida",    "con_estacion": -26.6, "sin_estacion": 2.8,   "p_diferencia": 0.003},
        {"caso": "Avería 13/05/2024",      "sentido": "vuelta", "con_estacion": -32.0, "sin_estacion": 3.1,   "p_diferencia": 0.001},
    ]
    resultado = {
        "version_esquema": 2,
        "fuente": "R-MOVE · M2 (municipio → Barcelona, notebook 04) y M3 (municipio ↔ barrio), Telefónica Smart Steps",
        "periodo": {"inicio": INICIO, "fin": FIN},
        "respuesta": {"titulo": "Sí, pero solo donde el tren no tiene alternativa",
                      "texto": (f"En los días de caos, los municipios que dependen de Rodalies hacen un {abs(dep_g['efecto_pct']):.1f} % menos de viajes ".replace(".", ",")
                                + f"a Barcelona (≈ {miles_(perdidos_media)} viajes menos al día). Donde hay metro, FGC o bus cercano, no cambia de forma clara.")},
        "kpis": [
            {"valor": len(caos_real), "decimales": 0, "unidad": "", "etiqueta": "Días de caos analizados"},
            {"valor": int(info.dependiente.sum()), "decimales": 0, "unidad": "", "etiqueta": "Municipios dependientes de Rodalies"},
            {"valor": dep_g["efecto_pct"], "decimales": 1, "unidad": " %", "etiqueta": "Viajes a Barcelona el día del caos (dependientes)"},
            {"valor": -round(perdidos_media, -1), "decimales": 0, "unidad": "", "etiqueta": "Viajes perdidos por día de caos"},
        ],
        "conclusiones": [
            {"pregunta": "¿Quién deja de viajar?", "titulo": "Solo quien no tiene alternativa",
             "texto": f"Los municipios dependientes hacen un {abs(dep_g['efecto_pct']):.1f} % menos de viajes a Barcelona. Los cercanos o con metro/FGC no cambian de forma clara.".replace(".", ",", 1)},
            {"pregunta": "¿Importa la distancia?", "titulo": "Cuanto más lejos, más impacto",
             "texto": f"{fmt(cerca['efecto_pct'])} % a menos de 15 km y {fmt(lejos['efecto_pct'])} % a más de 30 km de Barcelona."},
            {"pregunta": "¿Qué línea es más vulnerable?", "titulo": "Depende de dónde falla el tren",
             "texto": "En una avería cae la línea cortada (Maresme, 13/05/2024). En las huelgas, el Garraf (R2 Sud) cae siempre."},
            {"pregunta": "¿Cuánto dura?", "titulo": "Un día",
             "texto": f"El día del caos el efecto es de {fmt(dia0['efecto_pct'])} %; al día siguiente los viajes vuelven a la normalidad."},
        ],
        "incidencias": incidencias,
        "grupos": grupos_glob, "distancia": distancia, "evento": evento, "placebo": placebo, "barrios": barrios,
        "perdidos_media": {"viajes_perdidos": num(perdidos_media, 0), "viajes_dia_normal": num(normal_media, 0)},
        "metodo": {
            "comparacion": "Cada día de caos se compara con días limpios (laborables sin lluvia, festivos, verano, eventos ni incidencias), descontando lo que hacen ese mismo día los municipios sin Rodalies (control).",
            "efecto": "Regresión de diferencias en diferencias con efectos fijos de municipio × día de la semana y de fecha; errores agrupados por municipio. «Efecto claro» = p < 0,05.",
            "tramos": "Volumen total de los municipios del tramo afectado frente a lo esperado: viajes del control ese día × proporción habitual tramo/control (días limpios del mismo año y día de la semana).",
            "perdidos": "Viajes perdidos = viajes de un día normal × efecto estimado. Es una aproximación.",
            "placebo": f"{len(plac)} grupos de días normales al azar tratados como si fueran días de caos.",
            "barrios": "M3: regresión con efecto fijo día × tipo de barrio; municipios dependientes con ≥ 200 viajes/día hacia cada tipo.",
        },
        "limitaciones": [
            "Datos diarios de todos los modos de transporte: no identifican el tren ni la hora.",
            "Solo cuatro días de caos válidos; en los municipios pequeños la significación individual es baja.",
            "Los municipios de control pueden notar el caos de forma indirecta: el efecto real podría ser algo mayor.",
            "Las magnitudes de M3 no son comparables con las de M2; se comparan direcciones y diferencias dentro de M3.",
        ],
    }
    destino.parent.mkdir(parents=True, exist_ok=True)
    contenido = json.dumps(resultado, ensure_ascii=False, indent=1).encode("utf-8")
    destino.write_bytes(contenido)
    print(f"\nGuardado: {destino}")
    print("SHA-256 para publication.json:", hashlib.sha256(contenido).hexdigest())

exportar_resultados()
