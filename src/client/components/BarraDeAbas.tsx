import type { Rota } from '../lib/rota';
import { irPara } from '../lib/rota';

/**
 * A barra de baixo (CLAUDE.md §4).
 *
 * A spec prevê quatro abas — Jornada, Loja, Mural e Perfil — mas **só entram as
 * que existem**: Mural é da fase 9 e Perfil da fase 7. Aba que abre uma tela
 * vazia, ou que não abre nada, ensina que o app está quebrado, e o público é
 * 55+: quem toca e não acontece nada não toca de novo.
 *
 * Com uma aba só não haveria barra; são os Tesouros (a antiga Loja) que a fazem
 * existir.
 */
const ABAS = [
  { chave: 'jornada', rotulo: 'Jornada', icone: '🙏', caminho: '/' },
  // "Tesouros" é só o nome que aparece (docs/estilo-visual.md): a rota, a chave e
  // os eventos continuam "loja", para os links e a comparação Home × Loja não quebrarem.
  { chave: 'loja', rotulo: 'Tesouros', icone: '📿', caminho: '/loja' },
] as const;

type Aba = (typeof ABAS)[number]['chave'];

/** Em que aba cada rota mora. A lição não aparece aqui de propósito (abaixo). */
export function abaDaRota(rota: Rota): Aba | null {
  switch (rota.nome) {
    case 'inicio':
    case 'programa':
      return 'jornada';
    case 'loja':
    case 'produto':
      return 'loja';
    default:
      return null;
  }
}

/**
 * A barra aparece onde a pessoa está navegando, e **não na lição**: ali o áudio
 * está tocando, os controles do player ficam na parte de baixo da tela, e um
 * convite para a loja no meio da oração é a hora errada.
 */
export function BarraDeAbas({ ativa }: { ativa: Aba }) {
  return (
    <nav
      aria-label="Seções do app"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-linha bg-cartao pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md">
        {ABAS.map((aba) => {
          const atual = aba.chave === ativa;
          return (
            <li key={aba.chave} className="flex-1">
              <button
                type="button"
                aria-current={atual ? 'page' : undefined}
                onClick={() => irPara(aba.caminho)}
                className={`flex min-h-[64px] w-full flex-col items-center justify-center gap-0.5 px-2 py-2 ${
                  atual ? 'font-bold text-ouro-forte' : 'text-texto2'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`text-2xl leading-none ${atual ? '' : 'opacity-70 grayscale'}`}
                >
                  {aba.icone}
                </span>
                {/* Texto sempre: ícone sozinho não diz nada para quem não
                    cresceu com aplicativo. */}
                <span className="text-base leading-none">{aba.rotulo}</span>
                {atual && (
                  <span aria-hidden="true" className="mt-0.5 h-1 w-8 rounded-full bg-ouro" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
