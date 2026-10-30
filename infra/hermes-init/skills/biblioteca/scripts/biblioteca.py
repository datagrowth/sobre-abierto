#!/usr/bin/env python3
"""Cliente de la Biblioteca de Conocimiento de la empresa para Hermes.

Solo usa la biblioteca estándar. Habla con el monitor por la red interna con el
token que hermes-init deja en $HERMES_HOME/.biblioteca-token.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("BIBLIOTECA_URL", "http://hermes-monitor:3110").rstrip("/") + "/hermes-vault/agent"
TIMEOUT_S = 60


def token():
    value = os.environ.get("BIBLIOTECA_TOKEN", "").strip()
    if value:
        return value
    path = os.path.join(os.environ.get("HERMES_HOME", "/opt/data"), ".biblioteca-token")
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        sys.exit(f"No encuentro el token de la Biblioteca ({path}). Reinicia Hermes (docker compose restart hermes).")


def call(method, path, body=None, query=None):
    url = BASE + path + ("?" + urllib.parse.urlencode(query) if query else "")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token(),
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        try:
            detail = json.loads(err.read().decode("utf-8")).get("message", "")
        except (ValueError, OSError):
            detail = ""
        sys.exit(f"La Biblioteca respondió {err.code}: {detail or err.reason}")
    except urllib.error.URLError as err:
        sys.exit(f"No puedo conectar con la Biblioteca en {BASE}: {err.reason}")


def buscar(args):
    res = call("POST", "/buscar", {"consulta": args.consulta, "limite": args.limite})
    if args.json:
        print(json.dumps(res["resultados"], ensure_ascii=False, indent=2))
    elif not res["resultados"]:
        print("Nada en la Biblioteca sobre eso.")
    else:
        print(res["contexto"])


def leer(args):
    res = call("GET", "/leer", query={"ruta": args.ruta, "desde": args.desde, "max": args.max})
    paginas = f" · {res['paginas']} páginas" if res.get("paginas") else ""
    print(f"# {res['titulo']} ({res['ruta']}{paginas})")
    if res.get("estado") == "scanned":
        print("Aviso: parece un PDF escaneado (sin texto). Hay poco o nada que leer.")
    print(f"Caracteres {res['desde']}–{res['hasta']} de {res['total']}\n")
    print(res["texto"])
    if res["hasta"] < res["total"]:
        print(f"\n[Sigue: biblioteca.py leer \"{res['ruta']}\" --desde {res['hasta']}]")


def documentos(args, sin_nota):
    query = {"limite": args.limite}
    if sin_nota:
        query["sin_nota"] = "1"
    res = call("GET", "/documentos", query=query)
    if not res["documentos"]:
        print("No hay documentos pendientes de nota." if sin_nota else "No hay documentos en la Biblioteca.")
        return
    print(f"{res['total']} documento(s){' sin nota' if sin_nota else ''}; se muestran {len(res['documentos'])}:")
    for doc in res["documentos"]:
        extra = [f"{doc['paginas']} pág."] if doc.get("paginas") else []
        if doc["estado"] == "scanned":
            extra.append("escaneado, sin texto")
        if doc["estado"] == "error":
            extra.append(f"no se pudo leer: {doc.get('error')}")
        if not sin_nota and doc["con_nota"]:
            extra.append("ya tiene nota")
        print(f"- {doc['ruta']}" + (f" ({', '.join(extra)})" if extra else ""))


def proponer(args):
    if args.archivo:
        with open(args.archivo, encoding="utf-8") as fh:
            contenido = fh.read()
    else:
        contenido = sys.stdin.read()
    body = {"titulo": args.titulo, "contenido": contenido}
    for key in ("fuente", "carpeta", "motivo"):
        if getattr(args, key):
            body[key] = getattr(args, key)
    res = call("POST", "/propuestas", body)
    print(f"Propuesta guardada en {res['ruta']} (pendiente de aprobar en la Biblioteca).")


def main():
    parser = argparse.ArgumentParser(prog="biblioteca.py", description="Biblioteca de Conocimiento de la empresa")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("buscar", help="busca en notas y documentos (por palabras y por significado)")
    p.add_argument("consulta")
    p.add_argument("--limite", type=int, default=5)
    p.add_argument("--json", action="store_true", help="solo la lista de resultados")
    p = sub.add_parser("leer", help="texto de una nota o documento, por partes")
    p.add_argument("ruta")
    p.add_argument("--desde", type=int, default=0)
    p.add_argument("--max", type=int, default=20000)
    p = sub.add_parser("pendientes", help="documentos que aún no tienen nota")
    p.add_argument("--limite", type=int, default=20)
    p = sub.add_parser("documentos", help="todos los documentos")
    p.add_argument("--limite", type=int, default=50)
    p = sub.add_parser("proponer", help="propone una nota (queda pendiente de aprobar)")
    p.add_argument("--titulo", required=True)
    p.add_argument("--fuente", help="documento del que sale la nota (ruta en la Biblioteca)")
    p.add_argument("--carpeta", help="carpeta donde guardarla al aprobarla")
    p.add_argument("--motivo", help="por qué se propone")
    p.add_argument("--archivo", help="archivo con el markdown (si no, se lee de la entrada estándar)")
    args = parser.parse_args()
    if args.cmd == "buscar":
        buscar(args)
    elif args.cmd == "leer":
        leer(args)
    elif args.cmd in ("pendientes", "documentos"):
        documentos(args, args.cmd == "pendientes")
    else:
        proponer(args)


if __name__ == "__main__":
    main()
