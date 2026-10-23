import { APP_NAME, EMAIL_SUPORTE, JOURNEY_TOTAL_DAYS } from '../../shared/constants';

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-ouro-500">
          Aplicativo de orações
        </p>
        <h1 className="text-4xl font-semibold leading-tight text-noite-900">{APP_NAME}</h1>
        <p className="text-xl leading-relaxed text-noite-700">
          Uma jornada de {JOURNEY_TOTAL_DAYS} dias de oração com São Miguel Arcanjo, um dia por vez,
          com áudio para rezar junto e um lembrete no horário que você escolher.
        </p>
      </header>

      <button
        type="button"
        onClick={aoEntrar}
        className="w-full rounded-xl bg-noite-900 px-4 py-5 text-xl font-semibold text-white"
      >
        Entrar no meu app
      </button>

      <p className="text-lg leading-relaxed text-noite-700">
        Já comprou e precisa de ajuda para entrar? Escreva para{' '}
        <a className="font-medium text-noite-900 underline" href={`mailto:${EMAIL_SUPORTE}`}>
          {EMAIL_SUPORTE}
        </a>
        .
      </p>
    </main>
  );
}
