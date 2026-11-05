"""Gera seed/circulo.json a partir do conteúdo do Círculo de São Miguel.

Lê:
  conteudo/circulo/devocional-diario.md          (31 devocionais, pelo dia do mês)
  conteudo/circulo/novena-nossa-senhora-das-gracas.md  (novena do mês, por data)

Grava seed/circulo.json no mesmo formato do seed/produtos.json
({products, programs, lessons}), com dois campos novos no programa:
`unlock_rule` com os valores `mes` e `calendario`, e `available_from`.

O corpo de cada dia sai com os rótulos da jornada ("**Leitura do dia:**",
"**Prática de hoje:**", "**Intenção:**"): é por eles que o app separa a lição
em passos. Mudar um rótulo quebra essa separação: avise a aplicação antes.

Uso: python3 conteudo/gerar_seed_circulo.py
"""
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DEVOCIONAL = RAIZ / "conteudo" / "circulo" / "devocional-diario.md"
NOVENA = RAIZ / "conteudo" / "circulo" / "novena-nossa-senhora-das-gracas.md"
DESTINO = RAIZ / "seed" / "circulo.json"

# Primeiro só em texto (decisão do Leo, 05/11). Quando os MP3 do devocional
# estiverem no R2, vira True e cada dia com roteiro ganha o audio_key.
AUDIO_DEVOCIONAL_PUBLICADO = False

PUSH_MAX = 80


def campo(bloco: str, rotulo: str, onde: str) -> str:
    m = re.search(rf"^- \*\*{rotulo}:\*\*\s*(.+)$", bloco, re.M)
    if not m:
        raise ValueError(f"{onde}: campo '{rotulo}' ausente")
    return m.group(1).strip()


def secao(bloco: str, titulo: str, onde: str, obrigatoria: bool = True) -> str:
    m = re.search(rf"^### {re.escape(titulo)}\s*\n(.*?)(?=^### |\Z)", bloco, re.S | re.M)
    texto = m.group(1).strip() if m else ""
    texto = re.sub(r"\n-{3,}\s*$", "", texto).strip()
    if obrigatoria and not texto:
        raise ValueError(f"{onde}: seção '### {titulo}' ausente ou vazia")
    return texto


def dias(texto: str, total: int, origem: str) -> list[tuple[int, str, str]]:
    partes = re.split(r"^## Dia (\d+) — (.+)$", texto, flags=re.M)
    achados = [(int(partes[i]), partes[i + 1].strip(), partes[i + 2]) for i in range(1, len(partes), 3)]
    numeros = [n for n, _, _ in achados]
    if numeros != list(range(1, total + 1)):
        raise ValueError(f"{origem}: esperava os dias 1 a {total} em ordem, achei {numeros}")
    return achados


def conferir_push(push: str, onde: str) -> str:
    if len(push) > PUSH_MAX:
        raise ValueError(f"{onde}: push com {len(push)} caracteres (máximo {PUSH_MAX})")
    return push


def corpo(leitura: str, miolo: str, pratica: str, intencao: str) -> str:
    return (
        f"**Leitura do dia:** {leitura}\n\n"
        f"{miolo}\n\n"
        f"**Prática de hoje:** {pratica}\n\n"
        f"**Intenção:** {intencao}\n"
    )


def devocional() -> tuple[dict, dict, list[dict]]:
    texto = DEVOCIONAL.read_text(encoding="utf-8")
    produto = {
        "id": "circulo-devocional",
        "name": "Devocional diário do Círculo",
        "kind": "program",
        "description_md": (
            "Um devocional para cada dia do mês: uma leitura da Bíblia, uma reflexão "
            "curta, uma oração e uma prática para o dia. Todos os participantes do "
            "Círculo rezam o mesmo devocional no mesmo dia."
        ),
        "notice": None,
        "listed": 0,
    }
    programa = {
        "id": "circulo-devocional",
        "product_id": "circulo-devocional",
        "title": "Devocional do Círculo",
        "unlock_rule": "mes",
        "total_days": 31,
        "available_from": None,
    }
    licoes = []
    for n, titulo, bloco in dias(texto, 31, "devocional"):
        onde = f"Devocional, dia {n}"
        roteiro = secao(bloco, "Roteiro do áudio", onde, obrigatoria=False)
        tem_roteiro = roteiro not in ("", "_(pendente)_")
        miolo = (
            secao(bloco, "Reflexão", onde)
            + "\n\n**Oração**\n\n"
            + secao(bloco, "Oração", onde)
        )
        licoes.append({
            "id": f"circulo-devocional-d{n:02d}",
            "program_id": programa["id"],
            "day": n,
            "title": titulo,
            "summary": campo(bloco, "Resumo", onde),
            "body_md": corpo(
                campo(bloco, "Leitura", onde),
                miolo,
                campo(bloco, "Prática", onde),
                campo(bloco, "Intenção", onde),
            ),
            "push_text": conferir_push(campo(bloco, "Push", onde), onde),
            "audio_key": (
                f"circulo/devocional/d{n:02d}.mp3"
                if AUDIO_DEVOCIONAL_PUBLICADO and tem_roteiro
                else None
            ),
            "audio_script_ready": tem_roteiro,
        })
    return produto, programa, licoes


def novena() -> tuple[dict, dict, list[dict]]:
    texto = NOVENA.read_text(encoding="utf-8")
    cabeca = texto.split("\n---\n", 1)[0]
    produto_id = campo(cabeca, "ID", "Novena")
    programa_id = campo(cabeca, "Programa", "Novena")
    inicio = campo(cabeca, "Início", "Novena")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", inicio):
        raise ValueError(f"Novena: início '{inicio}' fora do formato AAAA-MM-DD")
    oracao = secao(cabeca, "Oração da novena", "Novena")
    jaculatoria = secao(cabeca, "Jaculatória", "Novena")

    produto = {
        "id": produto_id,
        "name": "Novena de Nossa Senhora das Graças",
        "kind": "program",
        "description_md": (
            "Nove dias de oração, de 18 a 26 de novembro, preparando a festa de "
            "Nossa Senhora das Graças, a da Medalha Milagrosa, em 27 de novembro."
        ),
        "notice": None,
        "listed": 0,
    }
    programa = {
        "id": programa_id,
        "product_id": produto_id,
        "title": "Novena de Nossa Senhora das Graças",
        "unlock_rule": "calendario",
        "total_days": 9,
        "available_from": inicio,
    }
    licoes = []
    for n, titulo, bloco in dias(texto, 9, "novena"):
        onde = f"Novena, dia {n}"
        miolo = (
            secao(bloco, "Meditação", onde)
            + "\n\n**Oração da novena**\n\n"
            + oracao
            + "\n\nReze três Ave-Marias e, depois de cada uma, a jaculatória:\n\n"
            + f"*{jaculatoria}*"
        )
        licoes.append({
            "id": f"{programa_id}-d{n:02d}",
            "program_id": programa_id,
            "day": n,
            "title": titulo,
            "summary": campo(bloco, "Resumo", onde),
            "body_md": corpo(
                campo(bloco, "Leitura", onde),
                miolo,
                campo(bloco, "Prática", onde),
                campo(bloco, "Intenção", onde),
            ),
            "push_text": conferir_push(campo(bloco, "Push", onde), onde),
            "audio_key": None,
            "audio_script_ready": False,
        })
    return produto, programa, licoes


def main() -> None:
    produtos, programas, licoes = [], [], []
    for produto, programa, dias_ in (devocional(), novena()):
        produtos.append(produto)
        programas.append(programa)
        licoes.extend(dias_)

    seed = {
        "_gerado_por": "conteudo/gerar_seed_circulo.py — não edite à mão",
        "products": produtos,
        "programs": programas,
        "lessons": licoes,
    }
    DESTINO.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK: {len(produtos)} produtos, {len(licoes)} dias -> {DESTINO.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
