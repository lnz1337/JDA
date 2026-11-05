import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../../shared/constants';
import { minutosDe } from '../../shared/licao';
import { registrarEvento } from '../lib/api';

const PULO_S = 15;
/** Acima disto a faixa conta como ouvida (§6, evento `audio_completed`). */
const OUVIDA = 0.9;

export function mmss(segundos: number): string {
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

export interface Tocador {
  faixas: Faixa[];
  faixa: Faixa | undefined;
  indice: number;
  escolher: (indice: number) => void;
  tocando: boolean;
  /** Já tocou alguma vez nesta lição (ou retomou de uma posição guardada). */
  comecou: boolean;
  atual: number;
  duracao: number;
  erro: boolean;
  alternar: () => void;
  pular: (segundos: number) => void;
  buscar: (segundos: number) => void;
  /**
   * O `<audio>`. A tela da lição o monta **uma vez**, num lugar fixo da árvore,
   * e os controles (grande no passo 1, mini nos outros) só leem e mandam nele.
   * É por isso que trocar de passo não para a oração.
   */
  elemento: JSX.Element | null;
}

/**
 * O áudio da lição, separado dos controles.
 *
 * Decisões que importam para este público:
 *
 * - **retoma de onde parou**, porque oração interrompida é regra, não exceção;
 * - **Media Session**, para o áudio seguir com a tela apagada e aparecer nos
 *   controles da tela de bloqueio e do fone;
 * - `lesson_started` sai do evento `play`, não do botão, e `audio_completed`
 *   acima de 90% da faixa, uma vez (§6).
 *
 * Os efeitos dependem do `src` da faixa, não do objeto: a tela da lição se
 * redesenha a cada troca de passo, e recomeçar a contagem ali zeraria o tempo
 * na tela e soltaria o `audio_completed` de novo.
 */
export function useTocador(
  faixas: Faixa[],
  aoOuvir?: (faixa: Faixa, indice: number) => void,
): Tocador {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [indice, setIndice] = useState(0);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [erro, setErro] = useState(false);
  const [comecou, setComecou] = useState(false);
  const registrouInicio = useRef(false);
  const avisouFim = useRef(false);
  const aoOuvirRef = useRef(aoOuvir);
  aoOuvirRef.current = aoOuvir;

  const faixa = faixas[indice];
  const src = faixa?.src;
  const duracaoConhecida = faixa?.duracaoConhecida ?? 0;

  const alternar = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setErro(true));
    else audio.pause();
  }, []);

  const pular = useCallback((segundos: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + segundos, audio.duration || 0));
  }, []);

  const buscar = useCallback((segundos: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = segundos;
    setAtual(segundos);
  }, []);

  // Troca de faixa: recomeça do zero, menos se houver posição guardada.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    setErro(false);
    avisouFim.current = false;
    setAtual(0);
    setDuracao(duracaoConhecida);

    const aoCarregar = () => {
      setDuracao(audio.duration || duracaoConhecida || 0);
      const guardada = lerPosicao(src);
      // Perto do fim não vale retomar: a pessoa já ouviu aquilo.
      if (guardada > 5 && audio.duration && guardada < audio.duration - 10) {
        audio.currentTime = guardada;
        setAtual(guardada);
        setComecou(true);
      }
    };

    audio.addEventListener('loadedmetadata', aoCarregar);
    return () => audio.removeEventListener('loadedmetadata', aoCarregar);
  }, [src, duracaoConhecida]);

  // Media Session: título na tela de bloqueio e controles no fone.
  const titulo = faixa?.titulo;
  const contexto = faixa?.contexto;
  useEffect(() => {
    if (!titulo || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: titulo,
      artist: APP_NAME,
      album: contexto ?? '',
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
  }, [titulo, contexto, pular]);

  const elemento = faixa ? (
    // biome-ignore lint/a11y/useMediaCaption: áudio de oração, sem fala a legendar
    <audio
      ref={audioRef}
      src={faixa.src}
      preload="metadata"
      onPlay={() => {
        setTocando(true);
        setComecou(true);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';

        /*
         * O evento sai daqui, não do botão: tocar pela tela de bloqueio ou pelo
         * fone também é começar a oração, e pelo botão só se veria parte do funil.
         */
        if (!registrouInicio.current) {
          registrouInicio.current = true;
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

        /*
         * Só contando com o áudio tocando: retomar uma faixa parada depois dos
         * 90% pula para a posição guardada, e esse pulo dispara `timeupdate`
         * sem a pessoa ouvir nada — era um `audio_completed` repetido a cada
         * vez que ela abria a lição.
         */
        if (
          !avisouFim.current &&
          !audio.paused &&
          audio.duration > 0 &&
          audio.currentTime / audio.duration >= OUVIDA
        ) {
          avisouFim.current = true;
          registrarEvento('audio_completed', { lesson_id: faixa.lessonId, dia: faixa.dia });
          aoOuvirRef.current?.(faixa, indice);
        }
      }}
      onEnded={() => {
        setTocando(false);
        limparPosicao(faixa.src);
      }}
    />
  ) : null;

  return {
    faixas,
    faixa,
    indice,
    escolher: setIndice,
    tocando,
    comecou,
    atual,
    duracao,
    erro,
    alternar,
    pular,
    buscar,
    elemento,
  };
}

/**
 * O player grande, do passo 1 (e da lição de tela única).
 *
 * - **um botão grande de tocar**, com a palavra escrita. Ícone de play sozinho é
 *   claro para quem já usa app, e ambíguo para quem não usa;
 * - **voltar e avançar 15 s** em vez de velocidade e equalizador: o que a pessoa
 *   quer é ouvir de novo a frase que não entendeu;
 * - **tempo que falta**, não tempo decorrido — é o que responde "dá tempo agora?".
 *
 * `destaque` decide se o botão de tocar é o dourado da tela. Depois que a oração
 * foi ouvida, o dourado passa para o "Continuar": um dourado por tela.
 */
export function PlayerGrande({
  t,
  destaque,
  rotuloOuvir,
}: {
  t: Tocador;
  destaque: boolean;
  rotuloOuvir: string;
}) {
  if (!t.faixa) return null;

  const restante = Math.max(t.duracao - t.atual, 0);
  const minutos = minutosDe(t.faixa.duracaoConhecida ?? t.duracao);
  const tocar =
    t.indice > 0
      ? `▶  Tocar ${t.faixa.titulo.toLowerCase()}`
      : t.comecou
        ? '▶  Continuar ouvindo'
        : `▶  ${rotuloOuvir}${minutos ? ` · ${minutos} min` : ''}`;

  return (
    <section className="space-y-5 cartao px-5 py-6">
      {t.faixas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {t.faixas.map((f, i) => (
            <button
              key={f.src}
              type="button"
              onClick={() => t.escolher(i)}
              aria-pressed={i === t.indice}
              className={`min-h-[52px] flex-1 rounded-xl border-2 px-4 py-3 text-base font-semibold ${
                i === t.indice
                  ? 'border-ouro bg-fundo2 text-ouro-forte'
                  : 'border-linha bg-cartao text-texto'
              }`}
            >
              {f.titulo}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={t.alternar}
        className={`botao ${destaque ? 'botao-dourado' : 'botao-secundario'}`}
      >
        {t.tocando ? '❚❚  Pausar' : tocar}
      </button>

      <div className="space-y-2">
        <label className="block">
          <span className="sr-only">Posição da oração</span>
          <input
            type="range"
            min={0}
            max={Math.max(t.duracao, 1)}
            step={1}
            value={Math.min(t.atual, t.duracao || 1)}
            onChange={(e) => t.buscar(Number(e.target.value))}
            className="h-12 w-full accent-[#bd8f34]"
          />
        </label>
        <p className="text-base font-medium text-texto2">
          {t.duracao > 0 ? `Faltam ${mmss(restante)} de ${mmss(t.duracao)}` : 'Carregando o áudio…'}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => t.pular(-PULO_S)}
          className="botao botao-secundario flex-1"
        >
          ↺ Voltar {PULO_S}s
        </button>
        <button
          type="button"
          onClick={() => t.pular(PULO_S)}
          className="botao botao-secundario flex-1"
        >
          Avançar {PULO_S}s ↻
        </button>
      </div>

      {t.erro && (
        <p className="text-lg font-medium text-red-700">
          Não consegui tocar o áudio. Confira a internet e toque em Tocar de novo.
        </p>
      )}
    </section>
  );
}

/**
 * O mini player fixo embaixo, nos passos 2 e 3: um botão só, com o tempo que
 * falta. Aparece depois que a oração começou — antes disso ele seria um convite
 * a voltar para o passo 1, e o "‹ Voltar um passo" já faz isso.
 */
export function MiniPlayer({ t }: { t: Tocador }) {
  if (!t.faixa || !t.comecou) return null;

  const restante = Math.max(t.duracao - t.atual, 0);
  const tempo = t.duracao > 0 ? ` · ${mmss(restante)}` : '';

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-linha bg-cartao">
      <div className="mx-auto max-w-md px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <button
          type="button"
          onClick={t.alternar}
          className="botao botao-secundario"
          aria-label={t.tocando ? 'Pausar a oração' : 'Continuar a oração'}
        >
          {t.tocando ? `⏸  Pausar${tempo}` : `▶  Continuar ouvindo${tempo}`}
        </button>
        {t.erro && (
          <p className="mt-2 text-base font-medium text-red-700">
            Não consegui tocar o áudio. Confira a internet.
          </p>
        )}
      </div>
    </div>
  );
}
