import type { VoltaDaCompra } from '../lib/compra';

/**
 * A faixa que responde à volta do checkout (CLAUDE.md §7).
 *
 * Fica por cima de qualquer tela porque a pessoa pode voltar em qualquer uma —
 * no iPhone o checkout abre fora do app, e voltar pelo ícone pode cair na Home.
 */
export function AvisoDaCompra({ volta }: { volta: VoltaDaCompra }) {
  if (volta.estado === 'nada') return null;

  return (
    <div className="fixed inset-x-0 top-0 z-20 px-4 pt-4">
      <div className="mx-auto max-w-md rounded-2xl border-2 border-ouro-300 bg-white px-5 py-4 shadow-lg">
        {volta.estado === 'esperando' && (
          <p className="text-lg leading-relaxed text-noite-900">
            Conferindo sua compra…{' '}
            <span className="text-noite-700">pode deixar o app aberto.</span>
          </p>
        )}

        {volta.estado === 'liberado' && (
          <p className="text-lg font-semibold leading-relaxed text-noite-900">
            Pronto! Seu conteúdo já está liberado.
          </p>
        )}

        {/*
         * Nada de "erro" aqui: Pix e boleto demoram por natureza, e o pagamento
         * pode estar perfeito. Dizer que falhou faria a pessoa pagar de novo.
         */}
        {volta.estado === 'demorando' && (
          <p className="text-lg leading-relaxed text-noite-900">
            Se pagou com Pix ou boleto, pode levar alguns minutos. Avisamos quando liberar.
          </p>
        )}

        <button
          type="button"
          onClick={volta.dispensar}
          className="mt-3 min-h-[48px] w-full rounded-xl bg-noite-900 px-4 py-2 text-lg font-semibold text-white"
        >
          {volta.estado === 'esperando' ? 'Agora não' : 'Entendi'}
        </button>
      </div>
    </div>
  );
}
