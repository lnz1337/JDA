import { useState } from 'react';
import { suportaPush } from '../lib/dispositivo';
import { ligarLembrete, type ResultadoLembrete } from '../lib/lembrete';

/**
 * Pedir a permissão de notificação (CLAUDE.md §11).
 *
 * A tela explica **antes** de o sistema perguntar, e o pedido sai só no toque do
 * botão: permissão negada no impulso não volta mais — o navegador não pergunta
 * de novo, e a pessoa teria que achar o ajuste dentro do sistema.
 */
export function PassoLembrete({
  aoLigar,
  aoPular,
}: {
  aoLigar: () => void;
  aoPular: () => void;
}) {
  const [pedindo, setPedindo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLembrete | null>(null);

  // iPhone abaixo do 16.4: não há PushManager, e insistir seria prometer o que
  // o aparelho não faz.
  if (!suportaPush()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
        <h1 className="text-3xl font-semibold leading-tight text-noite-900">
          Quer um lembrete para rezar todo dia?
        </h1>
        <p className="text-lg leading-relaxed text-noite-700">
          Para receber o lembrete, o iPhone precisa estar atualizado (iOS 16.4 ou mais novo).
        </p>
        <button
          type="button"
          onClick={aoPular}
          className="min-h-[64px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white"
        >
          Continuar
        </button>
      </main>
    );
  }

  async function ligar() {
    setPedindo(true);
    const r = await ligarLembrete();
    setResultado(r);
    setPedindo(false);
    if (r === 'ligado') aoLigar();
  }

  if (resultado === 'negado' || resultado === 'erro' || resultado === 'indisponivel') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
        <h1 className="text-3xl font-semibold leading-tight text-noite-900">Tudo bem.</h1>
        <p className="text-lg leading-relaxed text-noite-700">
          {resultado === 'negado'
            ? 'Se mudar de ideia, dá para ligar o lembrete nas configurações do celular.'
            : 'Não consegui ligar o lembrete agora. Você pode tentar de novo mais tarde, pela tela inicial do app.'}
        </p>
        <button
          type="button"
          onClick={aoPular}
          className="min-h-[64px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white"
        >
          Continuar
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold leading-tight text-noite-900">
          Quer um lembrete para rezar todo dia?
        </h1>
        <p className="text-lg leading-relaxed text-noite-700">
          Uma vez por dia, no horário que você escolher, o celular avisa que a oração do dia está
          esperando.
        </p>
      </header>

      <p className="rounded-2xl border-2 border-ouro-300 bg-ouro-300/15 px-5 py-4 text-lg leading-relaxed text-noite-900">
        Na próxima tela, o celular vai perguntar se pode mostrar notificações. Toque em
        &ldquo;Permitir&rdquo;.
      </p>

      <button
        type="button"
        onClick={() => void ligar()}
        disabled={pedindo}
        className="min-h-[64px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white disabled:opacity-60"
      >
        {pedindo ? 'Um instante…' : 'Quero o lembrete'}
      </button>

      <button
        type="button"
        onClick={aoPular}
        className="mt-auto min-h-[48px] w-full py-2 text-lg text-noite-700 underline"
      >
        Agora não
      </button>
    </main>
  );
}
