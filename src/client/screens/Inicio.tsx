import { APP_NAME, EMAIL_SUPORTE, JOURNEY_TOTAL_DAYS } from '../../shared/constants';
import { Arte, BotaoTema, Ornamento } from '../components/Visual';

/**
 * A porta de entrada de `jornadacomeuanjo.com` para quem chega sem sessão.
 *
 * Ela existe por dois motivos. O primeiro é que um domínio que não serve nada é
 * sinal ruim de entrega: provedor compara o domínio do link com o do remetente, e
 * domínio sem conteúdo não ajuda. O segundo é que quem recebe o link e não lembra
 * do que comprou precisa reconhecer onde está antes de digitar um e-mail.
 *
 * Nada de promessa de resultado (CLAUDE.md §14): a linguagem é devocional e
 * descreve o que o app tem, não o que ele faz pela vida de quem reza.
 */
export function Inicio({ aoEntrar }: { aoEntrar: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col">
      <div className="relative">
        <Arte prioridade />
        <div className="absolute right-4 top-3">
          <BotaoTema />
        </div>
      </div>
      <div className="flex flex-col gap-7 px-6 pb-12">
        <header className="space-y-4 text-center">
          <p className="rotulo">Aplicativo de orações</p>
          <h1 className="text-4xl font-bold leading-tight text-titulo">{APP_NAME}</h1>
          <Ornamento />
          <p className="text-xl leading-relaxed text-texto2">
            Uma jornada de {JOURNEY_TOTAL_DAYS} dias de oração com São Miguel Arcanjo, um dia por
            vez, com áudio para rezar junto e um lembrete no horário que você escolher.
          </p>
        </header>

        <button type="button" onClick={aoEntrar} className="botao botao-dourado">
          Entrar no meu app
        </button>

        <p className="text-lg leading-relaxed text-texto2">
          Já comprou e precisa de ajuda para entrar? Escreva para{' '}
          <a className="font-semibold text-ouro-forte underline" href={`mailto:${EMAIL_SUPORTE}`}>
            {EMAIL_SUPORTE}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
