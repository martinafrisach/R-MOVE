"""Package allowlisted dashboard assets and hash-verified results; never run analysis."""
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit, unquote
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src/dashboard"
OUTPUT = ROOT / "dist/dashboard-pages"
ASSETS = ("index.html", "dashboard.css", "dashboard.js", "case-views.js", "favicon.svg")
RESULTS = {
    "2025-06-05": "data/processed/rmove/incidencia_2025_06_05.json",
    "2025-02-07": "data/processed/rmove/incidencia_2025_02_07.json",
}


def read_regular(relative):
    path = ROOT / relative
    if path.is_symlink() or any(p.is_symlink() for p in path.parents if p != ROOT.parent):
        raise ValueError(f"Enlace simbólico no permitido: {relative}")
    if not path.is_file() or not path.resolve().is_relative_to(ROOT):
        raise ValueError(f"Falta archivo: {relative}")
    return path.read_bytes()


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        self.links.extend(v for k, v in attrs if k in ("src", "href") and v)


def validate_routes(files):
    # Resolve below a project prefix to catch absolute paths that break Pages.
    from posixpath import normpath, dirname
    for name in ("index.html", "src/dashboard/index.html"):
        parser = Links()
        parser.feed(files[name].decode("utf-8"))
        for link in parser.links:
            parsed = urlsplit(link)
            if parsed.scheme in ("https", "http"):
                continue
            if parsed.scheme or parsed.netloc or parsed.path.startswith("/"):
                raise ValueError(f"Ruta no relativa en {name}: {link}")
            target = normpath(dirname(name) + "/" + unquote(parsed.path))
            if target.endswith("/") or parsed.path.endswith("/"):
                target += "/index.html"
            target = target.removeprefix("/")
            if target not in files:
                raise ValueError(f"Destino ausente: {name} -> {link}")
    js = files["src/dashboard/dashboard.js"].decode("utf-8")
    cases = re.search(r"const CASES=(\{[^;]+\});", js)
    expected = {date: "../../" + path for date, path in RESULTS.items()}
    if not cases or json.loads(cases[1].replace("'", '"')) != expected:
        raise ValueError("Las rutas CASES de dashboard.js no coinciden con el artefacto")
    css = files["src/dashboard/dashboard.css"].decode("utf-8")
    if re.search(r"url\s*\(|@import", css, re.I):
        raise ValueError("Revisar nuevas dependencias CSS antes de publicarlas")


def prepare():
    manifest = json.loads(read_regular("src/dashboard/publication.json"))
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("results"), dict):
        raise ValueError("Manifiesto de publicación no válido")
    results = manifest["results"]
    if set(results) - set(RESULTS.values()):
        raise ValueError("El manifiesto contiene resultados fuera de la lista permitida")
    files = {"src/dashboard/" + name: read_regular("src/dashboard/" + name) for name in ASSETS}
    files["index.html"] = read_regular("src/dashboard/pages-entry.html")
    errors = []
    for date, relative in RESULTS.items():
        try:
            content = read_regular(relative)
            entry = results.get(relative, {})
            digest = hashlib.sha256(content).hexdigest()
            if entry.get("sha256") != digest:
                raise ValueError(f"SHA-256 ausente o desactualizado: {relative}")
            data = json.loads(content)
            if (data.get("version_esquema") != 3 or data.get("fecha_incidencia") != date
                    or not isinstance(data.get("municipios"), list) or not data["municipios"]
                    or not isinstance(data.get("relaciones"), list) or not data["relaciones"]):
                raise ValueError(f"Esquema incompatible: {relative}")
            for row in data["relaciones"]:
                if row.get("estado") != "ok" or any(
                    type(row.get(key)) not in (int, float) or not math.isfinite(row[key])
                    for key in ("variacion_observada_pct", "diferencia_viajes")
                ):
                    raise ValueError(f"Relación inválida: {relative}")
            files[relative] = content
        except (ValueError, TypeError, AttributeError) as error:
            errors.append(str(error))
    # Routes are checked even when the result files are blocked.
    validate_routes({**dict.fromkeys(RESULTS.values(), b""), **files})
    if errors:
        raise ValueError("Publicación bloqueada:\n- " + "\n- ".join(errors))
    return files


def main():
    if sys.argv[1:] not in ([], ["--check"]):
        raise ValueError("Uso: python src/dashboard/build-pages.py [--check]")
    if OUTPUT.parent.is_symlink():
        raise ValueError("dist no puede ser un enlace simbólico")
    # Refuse stale output instead of recursively deleting a computed directory.
    if not sys.argv[1:] and OUTPUT.exists():
        raise ValueError("dist/dashboard-pages ya existe; revísalo y retíralo antes de reconstruir")
    files = prepare()
    if not sys.argv[1:]:
        OUTPUT.mkdir(parents=True)
        for relative, content in files.items():
            target = OUTPUT / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        actual = {p.relative_to(OUTPUT).as_posix() for p in OUTPUT.rglob("*") if p.is_file()}
        if actual != set(files):
            raise ValueError("El artefacto contiene archivos inesperados")
    print(f"Validación correcta: {len(files)} archivos permitidos")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
