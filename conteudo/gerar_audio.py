"""Pipeline de áudio da jornada com o Voice Studio (voicestudio.sh).

O Voice Studio não tem tag de pausa documentada, então o roteiro é gerado em
trechos (um por parágrafo) e montado com ffmpeg, inserindo silêncios e o canto.

Etapas (rode na ordem, por dia ou com --dia todos):

  1. planejar    corta o roteiro em trechos -> audio/dNN/trechos/NNN.txt + plano.json
  2. sintetizar  gera cada trecho -> NNN.wav. Motores:
                   --motor api        API local do Voice Studio (padrão)
                   --motor omnivoice  modelo OmniVoice direto em Python (ex.: Google Colab)
                 (ou gere manualmente no app e salve com o mesmo nome NNN.wav)
  3. montar      junta trechos + silêncios + canto (+ fundo) -> audio/saida/dNN.mp3

Exemplos:
  python3 conteudo/gerar_audio.py planejar --dia 1
  VOICESTUDIO_URL=http://127.0.0.1:PORTA VOICESTUDIO_VOICE=minha-voz \\
      python3 conteudo/gerar_audio.py sintetizar --dia 1
  python3 conteudo/gerar_audio.py montar --dia 1 --canto midia/canto.wav --fundo midia/pad.wav

Variáveis de ambiente (sintetizar):
  VOICESTUDIO_URL    URL base da API local (ver a tela de API do app). Obrigatória.
  VOICESTUDIO_VOICE  nome/id da voz clonada. Obrigatória.
  VOICESTUDIO_MODEL  modelo, se a API exigir (padrão: omnivoice).
  VOICESTUDIO_KEY    chave, se a API exigir.

Variáveis de ambiente (sintetizar --motor omnivoice; requer `pip install omnivoice`):
  OMNIVOICE_REF_AUDIO  áudio de referência da voz (8 a 15 s, limpo). Obrigatória.
  OMNIVOICE_REF_TEXT   transcrição exata do áudio de referência (recomendado;
                       sem ela o Whisper transcreve automaticamente).
  OMNIVOICE_SPEED      velocidade da fala (padrão: modelo decide; 0.9 = mais calmo).
  OMNIVOICE_STEPS      passos de geração (padrão 32; 16 = mais rápido).

Outras:
  JDA_AUDIO_DIR      pasta de trabalho dos áudios (padrão: <repo>/audio). No Colab,
                     aponte para o Drive para retomar de onde parou.

Requer ffmpeg no PATH. O motor api não tem dependências Python externas.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gerar_seed import RAIZ, carregar_dias  # noqa: E402

PASTA_AUDIO = Path(os.environ.get("JDA_AUDIO_DIR", RAIZ / "audio"))
RESPIRO_ENTRE_PARAGRAFOS = 0.6  # segundos
VOLUME_FUNDO = 0.08              # fundo bem baixo, só sob a narração
TAXA = 44100

MARCA_PAUSA = re.compile(r"^\[pausa (\d+(?:[.,]\d+)?)s\]$")
MARCA_CANTO = "[CANTO DE SÃO MIGUEL]"


# ---------- planejar ----------

def montar_plano(roteiro: str) -> list[dict]:
    """Converte o roteiro em sequência de {fala|pausa|canto}."""
    itens: list[dict] = []
    for bloco in re.split(r"\n\s*\n", roteiro.strip()):
        bloco = " ".join(bloco.split())
        if not bloco:
            continue
        m = MARCA_PAUSA.match(bloco)
        if m:
            itens.append({"tipo": "pausa", "seg": float(m.group(1).replace(",", "."))})
        elif bloco == MARCA_CANTO:
            itens.append({"tipo": "canto"})
        elif "[" in bloco:
            raise ValueError(f"Marcação desconhecida no trecho: {bloco[:60]}")
        else:
            if itens and itens[-1]["tipo"] == "fala":
                itens.append({"tipo": "pausa", "seg": RESPIRO_ENTRE_PARAGRAFOS})
            itens.append({"tipo": "fala", "texto": bloco})

    n = 0
    for item in itens:
        if item["tipo"] == "fala":
            n += 1
            item["arquivo"] = f"{n:03d}"
    return itens


def pasta_dia(dia: int) -> Path:
    return PASTA_AUDIO / f"d{dia:02d}"


def cmd_planejar(dia: dict) -> None:
    if not dia["audio_script"]:
        print(f"Dia {dia['day']}: roteiro pendente, pulando.")
        return
    plano = montar_plano(dia["audio_script"])
    pasta = pasta_dia(dia["day"])
    trechos = pasta / "trechos"
    trechos.mkdir(parents=True, exist_ok=True)
    for item in plano:
        if item["tipo"] == "fala":
            (trechos / f"{item['arquivo']}.txt").write_text(item["texto"] + "\n", encoding="utf-8")
    (pasta / "plano.json").write_text(json.dumps(plano, ensure_ascii=False, indent=2), encoding="utf-8")
    falas = sum(1 for i in plano if i["tipo"] == "fala")
    pausas = sum(i["seg"] for i in plano if i["tipo"] == "pausa")
    print(f"Dia {dia['day']}: {falas} trechos, {pausas:.1f}s de pausas -> {pasta}")


def ler_plano(dia: int) -> list[dict]:
    caminho = pasta_dia(dia) / "plano.json"
    if not caminho.exists():
        raise SystemExit(f"Dia {dia}: rode 'planejar' antes.")
    return json.loads(caminho.read_text(encoding="utf-8"))


# ---------- sintetizar ----------

def sintetizar_api(texto: str, destino: Path) -> None:
    url = os.environ.get("VOICESTUDIO_URL")
    voz = os.environ.get("VOICESTUDIO_VOICE")
    if not url or not voz:
        raise SystemExit("Defina VOICESTUDIO_URL e VOICESTUDIO_VOICE (veja o topo do arquivo).")
    corpo = json.dumps({
        "model": os.environ.get("VOICESTUDIO_MODEL", "omnivoice"),
        "input": texto,
        "voice": voz,
        "response_format": "wav",
        "language": "pt",
    }).encode("utf-8")
    req = urllib.request.Request(
        url.rstrip("/") + "/v1/audio/speech",
        data=corpo,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    chave = os.environ.get("VOICESTUDIO_KEY")
    if chave:
        req.add_header("Authorization", f"Bearer {chave}")
    with urllib.request.urlopen(req, timeout=300) as resp:
        destino.write_bytes(resp.read())


_OMNI: dict = {}


def _omnivoice():
    """Carrega o modelo e o prompt de voz uma vez só por processo."""
    if _OMNI:
        return _OMNI
    ref_audio = os.environ.get("OMNIVOICE_REF_AUDIO")
    if not ref_audio or not Path(ref_audio).exists():
        raise SystemExit("Defina OMNIVOICE_REF_AUDIO com o caminho do áudio de referência.")
    ref_text = os.environ.get("OMNIVOICE_REF_TEXT") or None

    import torch
    from omnivoice import OmniVoice

    cuda = torch.cuda.is_available()
    modelo = OmniVoice.from_pretrained(
        "k2-fsa/OmniVoice",
        device_map="cuda:0" if cuda else "cpu",
        dtype=torch.float16 if cuda else torch.float32,
        load_asr=ref_text is None,  # sem transcrição, o Whisper transcreve a referência
    )
    _OMNI["modelo"] = modelo
    _OMNI["prompt"] = modelo.create_voice_clone_prompt(ref_audio=ref_audio, ref_text=ref_text)
    velocidade = os.environ.get("OMNIVOICE_SPEED")
    _OMNI["speed"] = float(velocidade) if velocidade else None
    _OMNI["num_step"] = int(os.environ.get("OMNIVOICE_STEPS", "32"))
    print(f"OmniVoice carregado ({'GPU' if cuda else 'CPU'}).")
    return _OMNI


def sintetizar_omnivoice(texto: str, destino: Path) -> None:
    import numpy as np
    import wave

    omni = _omnivoice()
    modelo = omni["modelo"]
    audio = modelo.generate(
        text=texto,
        language="pt",
        voice_clone_prompt=omni["prompt"],
        speed=omni["speed"],
        num_step=omni["num_step"],
    )[0]
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(destino), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(getattr(modelo, "sampling_rate", 24000)))
        w.writeframes(pcm.tobytes())


def sintetizar_simulado(texto: str, destino: Path) -> None:
    """Tom baixo com a duração estimada da fala (~2,4 palavras/s). Só para testar a montagem."""
    duracao = max(1.0, len(texto.split()) / 2.4)
    ffmpeg("-f", "lavfi", "-i", f"sine=frequency=220:duration={duracao:.2f}",
           "-af", "volume=0.2", str(destino))


MOTORES = {
    "api": sintetizar_api,
    "omnivoice": sintetizar_omnivoice,
    "simulado": sintetizar_simulado,
}


def cmd_sintetizar(dia: dict, motor: str, refazer: bool) -> None:
    if not dia["audio_script"]:
        return
    plano = ler_plano(dia["day"])
    trechos = pasta_dia(dia["day"]) / "trechos"
    sintetizar = MOTORES[motor]
    feitos = 0
    for item in plano:
        if item["tipo"] != "fala":
            continue
        wav = trechos / f"{item['arquivo']}.wav"
        if wav.exists() and not refazer:
            continue
        tmp = wav.with_suffix(".tmp.wav")  # grava em temporário: sessão interrompida não deixa wav pela metade
        sintetizar(item["texto"], tmp)
        tmp.replace(wav)
        feitos += 1
        print(f"  dia {dia['day']:02d} trecho {item['arquivo']}")
    print(f"Dia {dia['day']}: {feitos} trechos gerados ({motor}).")


# ---------- montar ----------

def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def duracao(caminho: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(caminho)],
        check=True, capture_output=True, text=True,
    ).stdout
    return float(out.strip())


def padronizar(origem: Path, destino: Path) -> None:
    ffmpeg("-i", str(origem), "-ar", str(TAXA), "-ac", "2", "-c:a", "pcm_s16le", str(destino))


def silencio(seg: float, destino: Path) -> None:
    ffmpeg("-f", "lavfi", "-i", f"anullsrc=r={TAXA}:cl=stereo", "-t", f"{seg:.2f}",
           "-c:a", "pcm_s16le", str(destino))


def concatenar(partes: list[Path], destino: Path, tmp: Path) -> None:
    lista = tmp / f"{destino.stem}.txt"
    lista.write_text("".join(f"file '{p.as_posix()}'\n" for p in partes), encoding="utf-8")
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(lista), "-c", "copy", str(destino))


def com_fundo(voz: Path, fundo: Path, destino: Path) -> None:
    ffmpeg("-i", str(voz), "-stream_loop", "-1", "-i", str(fundo),
           "-filter_complex",
           f"[1:a]aresample={TAXA},aformat=channel_layouts=stereo,volume={VOLUME_FUNDO},"
           f"afade=t=in:d=2[f];[0:a][f]amix=inputs=2:duration=first:normalize=0[m]",
           "-map", "[m]", "-c:a", "pcm_s16le", str(destino))


def cmd_montar(dia: dict, canto: Path | None, fundo: Path | None) -> None:
    if not dia["audio_script"]:
        return
    if canto and not canto.exists():
        raise SystemExit(f"Canto não encontrado: {canto}")
    if not canto:
        print(f"Dia {dia['day']}: sem --canto, usando 3 s de silêncio no lugar (só para teste).")
    plano = ler_plano(dia["day"])
    trechos = pasta_dia(dia["day"]) / "trechos"
    faltando = [i["arquivo"] for i in plano
                if i["tipo"] == "fala" and not (trechos / f"{i['arquivo']}.wav").exists()]
    if faltando:
        raise SystemExit(f"Dia {dia['day']}: faltam os trechos {', '.join(faltando)} (.wav)")

    saida = PASTA_AUDIO / "saida"
    saida.mkdir(parents=True, exist_ok=True)
    final = saida / f"d{dia['day']:02d}.mp3"

    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        canto_pad = tmp / "canto.wav"
        if canto:
            padronizar(canto, canto_pad)
        else:
            silencio(3.0, canto_pad)

        # Divide em blocos de narração separados pelo canto; o fundo entra só na narração.
        blocos: list[list[Path]] = [[]]
        sequencia: list[Path | str] = []
        for n, item in enumerate(plano):
            if item["tipo"] == "canto":
                sequencia.append("bloco")
                blocos.append([])
                sequencia.append(canto_pad)
                continue
            parte = tmp / f"p{n:03d}.wav"
            if item["tipo"] == "pausa":
                silencio(item["seg"], parte)
            else:
                padronizar(trechos / f"{item['arquivo']}.wav", parte)
            blocos[-1].append(parte)
        sequencia.append("bloco")

        finais: list[Path] = []
        idx_bloco = 0
        for elem in sequencia:
            if elem != "bloco":
                finais.append(elem)
                continue
            partes = blocos[idx_bloco]
            idx_bloco += 1
            if not partes:
                continue
            narr = tmp / f"bloco{idx_bloco}.wav"
            concatenar(partes, narr, tmp)
            if fundo:
                misturado = tmp / f"bloco{idx_bloco}_fundo.wav"
                com_fundo(narr, fundo, misturado)
                narr = misturado
            finais.append(narr)

        bruto = tmp / "bruto.wav"
        concatenar(finais, bruto, tmp)
        ffmpeg("-i", str(bruto), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
               "-ar", str(TAXA), "-c:a", "libmp3lame", "-b:a", "128k", str(final))

    seg = duracao(final)
    print(f"Dia {dia['day']}: {final} ({int(seg // 60)}min{int(seg % 60):02d}s)")


# ---------- CLI ----------

def main() -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg não encontrado no PATH.")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("etapa", choices=["planejar", "sintetizar", "montar"])
    ap.add_argument("--dia", required=True, help="número do dia (1-19) ou 'todos'")
    ap.add_argument("--motor", choices=list(MOTORES), default="api",
                    help="sintetizar: api (Voice Studio local), omnivoice (Python/Colab) ou simulado (teste)")
    ap.add_argument("--refazer", action="store_true", help="sintetizar: regera trechos já existentes")
    ap.add_argument("--canto", type=Path, help="montar: arquivo do Canto de São Miguel")
    ap.add_argument("--fundo", type=Path, help="montar: trilha de fundo (opcional, entra em loop)")
    args = ap.parse_args()

    dias = carregar_dias()
    if args.dia != "todos":
        dias = [d for d in dias if d["day"] == int(args.dia)]

    for dia in dias:
        if args.etapa == "planejar":
            cmd_planejar(dia)
        elif args.etapa == "sintetizar":
            cmd_sintetizar(dia, args.motor, args.refazer)
        else:
            cmd_montar(dia, args.canto, args.fundo)


if __name__ == "__main__":
    main()
