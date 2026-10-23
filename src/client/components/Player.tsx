import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../../shared/constants';
import { registrarEvento } from '../lib/api';

const PULO_S = 15;
/** Acima disto a faixa conta como ouvida (§13, evento `audio_completed`). */
const OUVIDA = 0.9;

function mmss(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00';
  const m = Math.floor(segundos / 60);
  const s = Math.floor(segundos % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Onde a pessoa parou, por faixa. Guardar isto é conveniência, não dado. */
function chaveDaPosicao(src: string): string {
  return `posicao:${src}`;
}

function lerPosicao(src: string): number {
  try {
    return Number(localStorage.getItem(chaveDaPosicao(src)) ?? 0);
  } catch {
    // Navegador privado ou armazenamento bloqueado: começa do zero, sem quebrar.
    return 0;
  }
}

function gravarPosicao(src: string, segundos: number): void {
  try {
    if (segundos > 5) localStorage.setItem(chaveDaPosicao(src), String(Math.floor(segundos)));
    else localStorage.removeItem(chaveDaPosicao(src));
  } catch {
    /* sem armazenamento: só não retoma */
  }
}

function limparPosicao(src: string): void {
  try {
    localStorage.removeItem(chaveDaPosicao(src));
  } catch {
    /* idem */
  }
}

export interface Faixa {
  src: string;
  titulo: string;
  /** O que aparece embaixo do título na tela de bloqueio. */
  contexto: string;
  /** Para o evento do funil. */
  lessonId: string;
  dia: number;
  duracaoConhecida?: number | null;
}

/**
 * Player de áudio.
 *
 * Decisões que importam para este público:
 *
 * - **um botão grande de tocar**, com a palavra escrita. Ícone de play sozinho é
 *   claro para quem já usa app, e ambíguo para quem não usa;
 * - **voltar e avançar 15 s** em vez de velocidade e equalizador: o que a pessoa
 *   quer é ouvir de novo a frase que não entendeu;
 * - **tempo que falta**, não tempo decorrido — é o que responde "dá tempo agora?";
 * - **retoma de onde parou**, porque oração interrompida é regra, não exceção;
 * - **Media Session**, para o áudio seguir com a tela apagada e aparecer nos
 *   controles da tela de bloqueio e do fone.
 */
export function Player({ faixas }: { faixas: Faixa[] }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [indice, setIndice] = useState(0);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [erro, setErro] = useState(false);
  const comecou = useRef(false);
  const avisouFim = useRef(false);

  const faixa = faixas[indice];

  const alternar = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !faixa) return;

    if (audio.paused) void audio.play().catch(() => setErro(true));
    else audio.pause();
  }, [faixa]);

  const pular = useCallback((segundos: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + segundos, audio.duration || 0));
  }, []);

  // Troca de faixa: recomeça do zero, menos se houver posição guardada.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !faixa) return;

    setErro(false);
    avisouFim.current = false;
    setAtual(0);
    setDuracao(faixa.duracaoConhecida ?? 0);

    const aoCarregar = () => {
      setDuracao(audio.duration || faixa.duracaoConhecida || 0);
      const guardada = lerPosicao(faixa.src);
      // Perto do fim não vale retomar: a pessoa já ouviu aquilo.
      if (guardada > 5 && audio.duration && guardada < audio.duration - 10) {
        audio.currentTime = guardada;
        setAtual(guardada);
      }
    };

    audio.addEventListener('loadedmetadata', aoCarregar);
    return () => audio.removeEventListener('loadedmetadata', aoCarregar);
  }, [faixa]);

  // Media Session: título na tela de bloqueio e controles no fone.
  useEffect(() => {
    if (!faixa || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: faixa.titulo,
      artist: APP_NAME,
      album: faixa.contexto,
    });

    const acoes: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => void audioRef.current?.play()],
      ['pause', () => audioRef.current?.pause()],
      ['seekbackward', () => pular(-PULO_S)],
      ['seekforward', () => pular(PULO_S)],
      [
        'seekto',
        (detalhes) => {
          if (audioRef.current && detalhes.seekTime !== undefined) {
            audioRef.current.currentTime = detalhes.seekTime;
          }
        },
      ],
    ];

    for (const [acao, mao] of acoes) {
      try {
        navigator.mediaSession.setActionHandler(acao, mao);
      } catch {
        // Navegador que não conhece a ação: o resto continua funcionando.
      }
    }

    return () => {
      for (const [acao] of acoes) {
        try {
          navigator.mediaSession.setActionHandler(acao, null);
        } catch {
          /* idem */
        }
      }
    };
  }, [faixa, pular]);

  if (!faixa) return null;

  const restante = Math.max(duracao - atual, 0);

  return (
    <section className="space-y-5 rounded-3xl border-2 border-noite-100 bg-white px-5 py-6">
      {faixas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {faixas.map((f, i) => (
            <button
              key={f.src}
              type="button"
              onClick={() => setIndice(i)}
              aria-pressed={i === indice}
              className={`min-h-[48px] flex-1 rounded-xl border-2 px-4 py-3 text-base font-semibold ${
                i === indice
                  ? 'border-noite-900 bg-noite-900 text-white'
                  : 'border-noite-100 bg-white text-noite-900'
              }`}
            >
              {f.titulo}
            </button>
          ))}
        </div>
      )}

      {/* biome-ignore lint/a11y/useMediaCaption: áudio de oração, sem fala a legendar */}
      <audio
        ref={audioRef}
        src={faixa.src}
        preload="metadata"
        onPlay={() => {
          setTocando(true);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';

          /*
           * O evento sai daqui, não do botão: tocar pela tela de bloqueio ou
           * pelo fone também é começar a oração, e pelo botão só se veria parte
           * do funil.
           */
          if (!comecou.current) {
            comecou.current = true;
            registrarEvento('lesson_started', { lesson_id: faixa.lessonId, dia: faixa.dia });
          }
        }}
        onPause={() => {
          setTocando(false);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
        }}
        onError={() => setErro(true)}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;
          setAtual(audio.currentTime);
          gravarPosicao(faixa.src, audio.currentTime);

          if (
            !avisouFim.current &&
            audio.duration > 0 &&
            audio.currentTime / audio.duration >= OUVIDA
          ) {
            avisouFim.current = true;
            registrarEvento('audio_completed', { lesson_id: faixa.lessonId, dia: faixa.dia });
          }
        }}
        onEnded={() => {
          setTocando(false);
          limparPosicao(faixa.src);
        }}
      />

      <button
        type="button"
        onClick={alternar}
        className="min-h-[64px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white"
      >
        {tocando ? '❚❚  Pausar' : '▶  Tocar'}
      </button>

      <div className="space-y-2">
        <label className="block">
          <span className="sr-only">Posição da oração</span>
          <input
            type="range"
            min={0}
            max={Math.max(duracao, 1)}
            step={1}
            value={Math.min(atual, duracao || 1)}
            onChange={(e) => {
              const audio = audioRef.current;
              if (audio) audio.currentTime = Number(e.target.value);
              setAtual(Number(e.target.value));
            }}
            className="h-12 w-full accent-noite-900"
          />
        </label>
        <p className="text-base font-medium text-noite-700">
          {duracao > 0 ? `Faltam ${mmss(restante)} de ${mmss(duracao)}` : 'Carregando o áudio…'}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => pular(-PULO_S)}
          className="min-h-[56px] flex-1 rounded-xl border-2 border-noite-900 px-3 py-3 text-lg font-semibold text-noite-900"
        >
          ↺ Voltar {PULO_S}s
        </button>
        <button
          type="button"
          onClick={() => pular(PULO_S)}
          className="min-h-[56px] flex-1 rounded-xl border-2 border-noite-900 px-3 py-3 text-lg font-semibold text-noite-900"
        >
          Avançar {PULO_S}s ↻
        </button>
      </div>

      {erro && (
        <p className="text-lg font-medium text-red-700">
          Não consegui tocar o áudio. Confira a internet e toque em Tocar de novo.
        </p>
      )}
    </section>
  );
}
