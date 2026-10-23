"""Gera seed/jornada-19-dias.json a partir de conteudo/jornada-19-dias.md.

Uso: python3 conteudo/gerar_seed.py
"""
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / "conteudo" / "jornada-19-dias.md"
DESTINO = RAIZ / "seed" / "jornada-19-dias.json"

PROGRAM_ID = "jornada-19"
PRODUCT_ID = "jornada-meu-anjo"

CAMPOS = {
    "Resumo": "resumo",
    "Leitura": "leitura",
    "Reflexão": "reflexao",
    "Prática": "pratica",
    "Intenção": "intencao",
    "Push": "push_text",
}


def parse_dia(numero: int, titulo: str, bloco: str) -> dict:
    dia = {"day": numero, "title": titulo.strip()}
    for rotulo, chave in CAMPOS.items():
        m = re.search(rf"^- \*\*{rotulo}:\*\*\s*(.+)$", bloco, re.M)
        if not m:
            raise ValueError(f"Dia {numero}: campo '{rotulo}' ausente")
        dia[chave] = m.group(1).strip()

    m = re.search(r"### Roteiro do áudio\s*\n(.*)", bloco, re.S)
    roteiro = m.group(1).strip() if m else ""
    roteiro = re.sub(r"\n-{3,}\s*$", "", roteiro).strip()
    dia["audio_script"] = None if roteiro in ("", "_(pendente)_") else roteiro
    return dia


def body_md(d: dict) -> str:
    return (
        f"**Leitura do dia:** {d['leitura']}\n\n"
        f"{d['reflexao']}\n\n"
        f"**Prática de hoje:** {d['pratica']}\n\n"
        f"**Intenção:** {d['intencao']}"
    )


def carregar_dias() -> list[dict]:
    texto = ORIGEM.read_text(encoding="utf-8")
    partes = re.split(r"^## Dia (\d+) — (.+)$", texto, flags=re.M)
    # partes = [preambulo, num, titulo, bloco, num, titulo, bloco, ...]
    dias = [
        parse_dia(int(partes[i]), partes[i + 1], partes[i + 2])
        for i in range(1, len(partes), 3)
    ]
    numeros = [d["day"] for d in dias]
    if numeros != list(range(1, 20)):
        raise ValueError(f"Esperava dias 1..19, encontrei {numeros}")
    return dias


def main() -> None:
    dias = carregar_dias()

    seed = {
        "product": {
            "id": PRODUCT_ID,
            "name": "Jornada com São Miguel",
            "kind": "program",
            "listed": 0,
        },
        "program": {
            "id": PROGRAM_ID,
            "product_id": PRODUCT_ID,
            "title": "Jornada de 19 dias com São Miguel",
            "unlock_rule": "daily",
            "total_days": 19,
        },
        "lessons": [
            {
                "id": f"{PROGRAM_ID}-d{d['day']:02d}",
                "program_id": PROGRAM_ID,
                "day": d["day"],
                "title": d["title"],
                "summary": d["resumo"],
                "body_md": body_md(d),
                "push_text": d["push_text"],
                "audio_key": f"jornada/d{d['day']:02d}.mp3",
                "audio_script_ready": d["audio_script"] is not None,
            }
            for d in dias
        ],
    }

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8")

    prontos = sum(1 for d in dias if d["audio_script"])
    palavras = [len(d["audio_script"].split()) for d in dias if d["audio_script"]]
    print(f"OK: {len(dias)} dias -> {DESTINO.relative_to(RAIZ)}")
    print(f"Roteiros prontos: {prontos}/19 | palavras por roteiro: {palavras}")


if __name__ == "__main__":
    main()
