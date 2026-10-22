import { APP_NAME } from '../../shared/constants';

/**
 * Entrou, mas não há produto liberado. Pode ser compra ainda processando,
 * reembolso ou e-mail diferente do usado na compra — por isso a tela explica e
 * oferece o suporte (CLAUDE.md §14), em vez de só dizer "sem acesso".
 */
export function SemAcesso({ suporte, aoSair }: { suporte: string | null; aoSair: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-noite-900">{APP_NAME}</h1>
        <p className="text-sm text-noite-700">
          Você entrou, mas ainda não há nenhum conteúdo liberado nesta conta.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-noite-100 bg-white p-5 text-sm text-noite-700">
        <p>Isso costuma acontecer por um destes motivos:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>a compra acabou de ser feita e ainda está sendo confirmada;</li>
          <li>a compra foi feita com outro e-mail;</li>
          <li>o acesso foi encerrado por reembolso.</li>
        </ul>
        {suporte && (
          <p className="pt-2">
            Se não for nenhum desses, escreva para{' '}
            <a className="font-medium text-noite-900 underline" href={`mailto:${suporte}`}>
              {suporte}
            </a>{' '}
            que a gente resolve.
          </p>
        )}
      </section>

      <button type="button" onClick={aoSair} className="text-sm text-noite-700 underline">
        Sair
      </button>
    </main>
  );
}
