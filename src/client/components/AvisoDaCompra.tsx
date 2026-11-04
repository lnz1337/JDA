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
      <div className="mx-auto max-w-md caixa-destaque px-5 py-4 shadow-lg">
        {volta.estado === 'esperando' && (
          <p className="text-lg leading-relaxed text-texto">
            Conferindo sua compra… <span className="text-texto2">pode deixar o app aberto.</span>
          </p>
        )}

        {volta.estado === 'liberado' && (
          <p className="text-lg font-semibold leading-relaxed text-texto">
            Pronto! Seu conteúdo já está liberado.
          </p>
        )}

        {/*
         * Nada de "erro" aqui: Pix e boleto demoram por natureza, e o pagamento
         * pode estar perfeito. Dizer que falhou faria a pessoa pagar de novo.
         */}
        {volta.estado === 'demorando' && (
          <p className="text-lg leading-relaxed text-texto">
            Se pagou com Pix ou boleto, pode levar alguns minutos. Avisamos quando liberar.
          </p>
        )}

        <button type="button" onClick={volta.dispensar} className="botao botao-secundario mt-3">
          {volta.estado === 'esperando' ? 'Agora não' : 'Entendi'}
        </button>
      </div>
    </div>
  );
}
