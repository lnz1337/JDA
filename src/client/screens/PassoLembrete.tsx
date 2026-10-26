import { useRef, useState } from 'react';
import { suportaPush } from '../lib/dispositivo';
import {
  ligarLembrete,
  prepararLembrete,
  type PreparoPush,
  type ResultadoLembrete,
} from '../lib/lembrete';

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
  aoSeguir,
}: {
  aoLigar: () => void;
  /** A pessoa disse "Agora não": o convite some por uma semana. */
  aoPular: () => void;
  /**
   * Não deu para ligar. Só encerra a tela, **sem** dispensar: falha não é
   * recusa, e esconder o convite de quem acabou de falhar era o que não deixava
   * tentar de novo.
   */
  aoSeguir: () => void;
}) {
  const [pedindo, setPedindo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLembrete | null>(null);

  /*
   * O preparo começa quando a tela aparece, não no toque: no Safari do iPhone a
   * assinatura pode precisar nascer dentro do gesto, e ir à rede entre o
   * "Permitir" e o `subscribe` gastaria esse gesto. Quando a pessoa termina de
   * responder o alerta do sistema, isto aqui já resolveu.
   *
   * No `useRef` e não no `useState`: o preparo é um efeito que acompanha a tela,
   * e o botão não depende dele para aparecer.
   */
  const preparo = useRef<Promise<PreparoPush | null> | null>(null);
  if (!preparo.current) preparo.current = prepararLembrete();

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
          onClick={aoSeguir}
          className="min-h-[64px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white"
        >
          Continuar
        </button>
      </main>
    );
  }

  async function ligar() {
    setPedindo(true);
    const r = await ligarLembrete(preparo.current ?? prepararLembrete());
    setResultado(r);
    setPedindo(false);
    if (r.estado === 'ligado') aoLigar();
  }

  if (resultado && resultado.estado !== 'ligado') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
        <h1 className="text-3xl font-semibold leading-tight text-noite-900">Tudo bem.</h1>
        <p className="text-lg leading-relaxed text-noite-700">
          {resultado.estado === 'negado'
            ? 'Se mudar de ideia, dá para ligar o lembrete nas configurações do celular.'
            : 'Não consegui ligar o lembrete agora. Você pode tentar de novo mais tarde, pela tela inicial do app.'}
        </p>

        {/*
         * Só em staging (§15, `define` do vite.config.ts): sem Mac não há como
         * abrir o inspetor do Safari do iPhone, e a etapa com o `name` da
         * exceção é a única pista de qual passo arrebentou.
         */}
        {resultado.estado === 'erro' && __DIAGNOSTICO__ && (
          <p className="rounded-xl bg-noite-100 px-4 py-3 font-mono text-sm leading-snug text-noite-700">
            {resultado.falha.etapa} · {resultado.falha.erro}
            {resultado.falha.status !== undefined && ` · HTTP ${resultado.falha.status}`}
          </p>
        )}
        <button
          type="button"
          onClick={resultado.estado === 'negado' ? aoPular : aoSeguir}
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
