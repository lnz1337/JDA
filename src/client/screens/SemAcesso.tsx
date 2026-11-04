/**
 * Entrou, mas não há produto liberado. Pode ser compra ainda processando,
 * reembolso ou e-mail diferente do usado na compra — por isso a tela explica e
 * oferece o suporte (CLAUDE.md §14), em vez de só dizer "sem acesso".
 */
export function SemAcesso({ suporte, aoSair }: { suporte: string | null; aoSair: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-5 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-titulo">Ainda não há conteúdo aqui</h1>
        <p className="text-lg leading-relaxed text-texto2">
          Você entrou, mas ainda não há nenhum conteúdo liberado nesta conta.
        </p>
      </header>

      <section className="cartao space-y-3 p-5 text-lg leading-relaxed text-texto">
        <p>Isso costuma acontecer por um destes motivos:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>a compra acabou de ser feita e ainda está sendo confirmada;</li>
          <li>a compra foi feita com outro e-mail;</li>
          <li>o acesso foi encerrado por reembolso.</li>
        </ul>
        {suporte && (
          <p className="pt-2">
            Se não for nenhum desses, escreva para{' '}
            <a className="font-semibold text-ouro-forte underline" href={`mailto:${suporte}`}>
              {suporte}
            </a>{' '}
            que a gente resolve.
          </p>
        )}
      </section>

      <button type="button" onClick={aoSair} className="botao botao-secundario">
        Sair
      </button>
    </main>
  );
}
