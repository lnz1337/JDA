/**
 * Peças visuais do app (docs/estilo-visual.md, "Componentes").
 *
 * Só aparência: nenhuma delas decide nada sobre acesso, dia ou compra. As cores
 * vêm dos tokens do `index.css`, então cada peça serve aos dois temas sem
 * conhecer o tema.
 */
import { useState } from 'react';
import { APP_NAME } from '../../shared/constants';
import { minutosDe } from '../../shared/licao';
import {
  aplicarLetra,
  indiceDaLetra,
  TAMANHOS_DE_LETRA,
  temaAtual,
  trocarTema,
  type Tema,
} from '../lib/aparencia';

/**
 * São Miguel Arcanjo, de Guido Reni (c. 1635), em domínio público. Dois
 * recortes, gerados por `scripts/arte.ts`: a faixa (3:1) para o alto das telas
 * e o cartão (4:3). A metade de baixo desbota para o fundo da página.
 *
 * `prioridade` só na Home: é a primeira tela da manhã, e só ali a imagem
 * merece passar na frente do resto.
 */
export function Arte({
  recorte = 'faixa',
  prioridade = false,
  desbotar = true,
  className = '',
}: {
  recorte?: 'faixa' | 'cartao';
  prioridade?: boolean;
  desbotar?: boolean;
  className?: string;
}) {
  const base = `/img/sao-miguel-${recorte}`;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <img
        src={`${base}-480.webp`}
        srcSet={`${base}-480.webp 480w, ${base}-960.webp 960w`}
        sizes="(min-width: 28rem) 28rem, 100vw"
        alt="São Miguel Arcanjo, pintura de Guido Reni"
        loading={prioridade ? 'eager' : 'lazy'}
        decoding="async"
        width={960}
        height={recorte === 'faixa' ? 320 : 720}
        className="block h-auto w-full"
      />
      {desbotar && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-3/5 bg-linear-to-b from-transparent to-fundo"
        />
      )}
    </div>
  );
}

/** "☀️ Claro" / "🌙 Escuro": o botão diz para onde vai, não onde está. */
export function BotaoTema({ compacto = false }: { compacto?: boolean }) {
  const [tema, setTema] = useState<Tema>(() => temaAtual());
  const destino = tema === 'escuro' ? '☀️ Claro' : '🌙 Escuro';
  return (
    <button
      type="button"
      onClick={() => setTema(trocarTema())}
      aria-label={tema === 'escuro' ? 'Usar o tema claro' : 'Usar o tema escuro'}
      className={`min-h-[52px] shrink-0 rounded-xl border border-linha bg-cartao font-bold text-ouro-forte ${
        compacto ? 'px-[12px] text-[15px]' : 'px-3 text-base'
      }`}
    >
      {destino}
    </button>
  );
}

/**
 * Cabeçalho fixo: o nome do app em serifa, "COM SÃO MIGUEL ARCANJO" embaixo e,
 * à direita, o botão de tema.
 */
export function Cabecalho() {
  return (
    <header className="sticky top-0 z-10 bg-linear-to-b from-fundo2 to-fundo">
      <div className="mx-auto max-w-[448px] px-[20px] pb-[8px] pt-[8px]">
        {/*
         * Em px, não em rem: o cabeçalho é moldura e não cresce com o A+ — na
         * letra maior ele tomaria um terço da tela. O conteúdo é que cresce.
         */}
        <div className="flex items-center justify-between gap-[12px]">
          <p className="font-serif text-[24px] font-bold leading-tight text-titulo">{APP_NAME}</p>
          <BotaoTema compacto />
        </div>
        <p className="font-sans text-[15px] font-extrabold uppercase leading-tight tracking-[2px] text-ouro">
          com São Miguel Arcanjo
        </p>
        {/* Só no staging (vite.config.ts): mostra qual versão está na tela. */}
        {__VERSAO__ && (
          <p className="font-sans text-[13px] leading-tight text-texto2">versão {__VERSAO__}</p>
        )}
      </div>
    </header>
  );
}

/**
 * A− / A+: quatro tamanhos de letra, guardados no aparelho. Aumentar aumenta
 * todo o texto, inclusive os botões.
 */
export function ControleLetra() {
  const [indice, setIndice] = useState(() => indiceDaLetra());
  const ultimo = TAMANHOS_DE_LETRA.length - 1;
  const mudar = (passo: number) => setIndice(aplicarLetra(indice + passo));
  const classe =
    'min-h-[52px] min-w-[52px] rounded-xl border border-linha bg-cartao px-3 text-lg font-bold text-ouro-forte disabled:opacity-40';
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Tamanho da letra">
      <button
        type="button"
        onClick={() => mudar(-1)}
        disabled={indice === 0}
        aria-label="Diminuir a letra"
        className={classe}
      >
        A−
      </button>
      <button
        type="button"
        onClick={() => mudar(1)}
        disabled={indice === ultimo}
        aria-label="Aumentar a letra"
        className={classe}
      >
        A+
      </button>
    </div>
  );
}

/** Linha fina dourada, uma cruz pequena no meio, linha de novo. */
export function Ornamento() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-3 text-ouro">
      <span className="h-px w-16 bg-current opacity-70" />
      <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor">
        <rect x="6" y="0" width="2" height="18" rx="1" />
        <rect x="1" y="5" width="12" height="2" rx="1" />
      </svg>
      <span className="h-px w-16 bg-current opacity-70" />
    </div>
  );
}

/** "🕐 7 min", arredondado para cima. Sem duração, sem chip. */
export function ChipDuracao({ segundos }: { segundos: number | null | undefined }) {
  const minutos = minutosDe(segundos);
  if (!minutos) return null;
  return (
    <span className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-linha px-3 text-base font-semibold text-texto">
      <span aria-hidden="true">🕐</span> {minutos} min
    </span>
  );
}

/**
 * Barra de progresso em segmentos: um por passo, os feitos em `ouro`, o atual
 * mais escuro. O "Passo 2 de 3" vai escrito para leitor de tela.
 */
export function BarraDePassos({ atual, total }: { atual: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={atual}
      aria-label={`Passo ${atual} de ${total}`}
      className="flex gap-2"
    >
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const cor = n < atual ? 'bg-ouro' : n === atual ? 'bg-ouro-forte' : 'bg-linha';
        return <span key={n} className={`h-2 flex-1 rounded-full ${cor}`} />;
      })}
    </div>
  );
}

/**
 * As velas da jornada (9×14px): acesa em degradê dourado com um brilho leve,
 * apagada na cor da linha. "N de 19 acesas" ao lado, quando pedido.
 */
export function Velas({
  acesas,
  total,
  legenda = true,
  centro = false,
}: {
  /** Os dias concluídos (1 a `total`). */
  acesas: ReadonlySet<number>;
  total: number;
  legenda?: boolean;
  /** Centraliza as velas e a legenda (tela da vela acesa). */
  centro?: boolean;
}) {
  const n = [...acesas].filter((d) => d >= 1 && d <= total).length;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${centro ? 'justify-center' : ''}`}
    >
      <div
        aria-hidden="true"
        className={`flex flex-wrap items-end gap-[5px] ${centro ? 'justify-center' : ''}`}
      >
        {Array.from({ length: total }, (_, i) => {
          const acesa = acesas.has(i + 1);
          return (
            <span
              key={i}
              className={`block h-[14px] w-[9px] rounded-t-[5px] rounded-b-[2px] ${acesa ? '' : 'bg-linha'}`}
              style={
                acesa
                  ? {
                      background: 'linear-gradient(180deg, #f0cd7a 0%, #bd8f34 100%)',
                      boxShadow: '0 0 6px rgba(240, 205, 122, 0.55)',
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
      {legenda ? (
        <span className="text-base font-semibold text-texto2">
          {n} de {total} {n === 1 ? 'acesa' : 'acesas'}
        </span>
      ) : (
        <span className="sr-only">
          {n} de {total} velas acesas
        </span>
      )}
    </div>
  );
}
