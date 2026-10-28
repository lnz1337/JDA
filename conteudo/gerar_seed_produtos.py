"""Gera seed/produtos.json a partir de conteudo/produtos/*.md.

Cada arquivo é um produto (programa) com lições. Formato:

    # Título do produto
    - **ID:** slug (= products.id e programs.id)
    - **Bundle:** (opcional) slug do bundle que o contém; produto grátis não tem
    - **Liberação:** all | daily
    - **Aviso:** (opcional) texto obrigatório na tela, ex. aviso de saúde
    - **Descrição:** texto curto da loja

    ## Lição N — Título
    - **Resumo:** frase curta
    - **Áudio:** pronto   (opcional) a faixa já existe e não sai do roteiro, ex. um canto
    ### Texto
    markdown mostrado na tela
    ### Roteiro do áudio   (opcional)
    roteiro no mesmo formato da jornada ([pausa Ns], [CANTO DE SÃO MIGUEL])

Uso: python3 conteudo/gerar_seed_produtos.py
"""
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "conteudo" / "produtos"
DESTINO = RAIZ / "seed" / "produtos.json"

META = {"ID": "id", "Bundle": "bundle", "Liberação": "unlock_rule", "Aviso": "aviso", "Descrição": "descricao"}


def _meta(bloco: str, rotulo: str) -> str | None:
    m = re.search(rf"^- \*\*{rotulo}:\*\*\s*(.+)$", bloco, re.M)
    return m.group(1).strip() if m else None


def parse_produto(caminho: Path) -> dict:
    texto = caminho.read_text(encoding="utf-8")
    titulo = re.search(r"^# (.+)$", texto, re.M)
    if not titulo:
        raise ValueError(f"{caminho.name}: falta o título '# ...'")
    partes = re.split(r"^## Lição (\d+) — (.+)$", texto, flags=re.M)
    cabecalho = partes[0]

    produto = {"title": titulo.group(1).strip()}
    for rotulo, chave in META.items():
        produto[chave] = _meta(cabecalho, rotulo)
    for obrigatorio in ("id", "unlock_rule", "descricao"):
        if not produto[obrigatorio]:
            raise ValueError(f"{caminho.name}: campo '{obrigatorio}' ausente")
    if produto["unlock_rule"] not in ("all", "daily"):
        raise ValueError(f"{caminho.name}: Liberação deve ser all ou daily")

    licoes = []
    for i in range(1, len(partes), 3):
        n, tit, bloco = int(partes[i]), partes[i + 1].strip(), partes[i + 2]
        m_texto = re.search(r"### Texto\s*\n(.*?)(?=^### Roteiro do áudio|\Z)", bloco, re.S | re.M)
        m_rot = re.search(r"### Roteiro do áudio\s*\n(.*)", bloco, re.S)
        if not m_texto or not m_texto.group(1).strip():
            raise ValueError(f"{caminho.name}: lição {n} sem '### Texto'")
        audio_pronto = (_meta(bloco, "Áudio") or "").lower() == "pronto"
        if audio_pronto and m_rot:
            raise ValueError(f"{caminho.name}: lição {n} tem 'Áudio: pronto' e roteiro; escolha um")
        licoes.append({
            "day": n,
            "audio_pronto": audio_pronto,
            "title": tit,
            "resumo": _meta(bloco, "Resumo"),
            "texto": m_texto.group(1).strip(),
            "audio_script": m_rot.group(1).strip() if m_rot else None,
            "programa": produto["id"],
        })
    if [l["day"] for l in licoes] != list(range(1, len(licoes) + 1)):
        raise ValueError(f"{caminho.name}: lições fora de ordem")
    produto["lessons"] = licoes
    return produto


def carregar_produtos() -> dict[str, dict]:
    produtos = {}
    for caminho in sorted(PASTA.glob("*.md")):
        p = parse_produto(caminho)
        if p["id"] in produtos:
            raise ValueError(f"ID repetido: {p['id']}")
        produtos[p["id"]] = p
    return produtos


def carregar_licoes(programa: str) -> list[dict]:
    """Lições de um produto no formato usado por gerar_audio.py."""
    produtos = carregar_produtos()
    if programa not in produtos:
        raise SystemExit(f"Produto '{programa}' não encontrado em conteudo/produtos/. Opções: {', '.join(produtos)}")
    return produtos[programa]["lessons"]


def main() -> None:
    produtos = carregar_produtos()
    seed = {"products": [], "programs": [], "lessons": []}
    for p in produtos.values():
        seed["products"].append({
            "id": p["id"],
            "name": p["title"],
            "kind": "program",
            "bundle_id": p["bundle"],
            "description_md": p["descricao"],
            "notice": p["aviso"],
            "listed": 0,
        })
        seed["programs"].append({
            "id": p["id"],
            "product_id": p["id"],
            "title": p["title"],
            "unlock_rule": p["unlock_rule"],
            "total_days": len(p["lessons"]),
        })
        for l in p["lessons"]:
            corpo = l["texto"]
            if p["aviso"]:
                corpo = f"> {p['aviso']}\n\n{corpo}"
            seed["lessons"].append({
                "id": f"{p['id']}-l{l['day']:02d}",
                "program_id": p["id"],
                "day": l["day"],
                "title": l["title"],
                "summary": l["resumo"],
                "body_md": corpo,
                "audio_key": f"{p['id']}/l{l['day']:02d}.mp3" if l["audio_script"] or l["audio_pronto"] else None,
            })

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(seed['products'])} produtos, {len(seed['lessons'])} lições -> {DESTINO.relative_to(RAIZ)}")
    for p in produtos.values():
        com_audio = [l["day"] for l in p["lessons"] if l["audio_script"]]
        prontos = [l["day"] for l in p["lessons"] if l["audio_pronto"]]
        extra = f" | faixa pronta nas lições {prontos}" if prontos else ""
        print(f"  {p['id']:<22} {len(p['lessons'])} lições | narração nas lições {com_audio or '-'}{extra}")


if __name__ == "__main__":
    main()
