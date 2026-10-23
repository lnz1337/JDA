import { useState } from 'react';
import { api } from '../lib/api';
import { fusoDoAparelho, salvarHorario } from '../lib/lembrete';

const OPCOES = [
  { hora: 7, rotulo: '7h, ao acordar' },
  { hora: 12, rotulo: '12h, meio-dia' },
  { hora: 15, rotulo: '15h' },
  { hora: 18, rotulo: '18h, hora da Ave-Maria' },
  { hora: 21, rotulo: '21h, antes de dormir' },
];

/** As horas que sobram, para quem toca em "Outro horário". */
const OUTRAS = Array.from({ length: 24 }, (_, h) => h).filter(
  (h) => !OPCOES.some((o) => o.hora === h),
);

/**
 * Escolher a hora do lembrete (CLAUDE.md §11).
 *
 * Ao salvar, o app manda **na hora** um push de confirmação. Ele não é enfeite:
 * é o que prova a corrente inteira — permissão, assinatura, serviço de push e
 * service worker — enquanto a pessoa ainda está olhando a tela. Se só
 * descobríssemos amanhã às 7h que não funciona, ninguém estaria ali para contar.
 */
export function PassoHorario({ aoTerminar }: { aoTerminar: () => void }) {
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostrarOutras, setMostrarOutras] = useState(false);

  async function escolher(hora: number) {
    setSalvando(true);
    setAviso(null);

    try {
      await salvarHorario(hora, fusoDoAparelho());
    } catch {
      setAviso('Não consegui salvar o horário agora. Dá para escolher depois, na tela inicial.');
      setSalvando(false);
      return;
    }

    try {
      await api('/api/push/confirmacao', { method: 'POST', body: JSON.stringify({ hora }) });
    } catch {
      // O horário está salvo; o que falhou foi o aviso de teste.
      setAviso(
        'O horário está guardado, mas não consegui ligar o lembrete neste aparelho. ' +
          'Você pode tentar de novo pela tela inicial do app.',
      );
      setSalvando(false);
      return;
    }

    aoTerminar();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold leading-tight text-noite-900">
          Que horas é melhor para você rezar?
        </h1>
      </header>

      <ul className="space-y-3">
        {OPCOES.map((o) => (
          <li key={o.hora}>
            <button
              type="button"
              disabled={salvando}
              onClick={() => void escolher(o.hora)}
              className="min-h-[64px] w-full rounded-xl border-2 border-noite-900 px-4 py-4 text-xl font-semibold text-noite-900 disabled:opacity-60"
            >
              {o.rotulo}
            </button>
          </li>
        ))}
      </ul>

      {mostrarOutras ? (
        <ul className="grid grid-cols-3 gap-3">
          {OUTRAS.map((h) => (
            <li key={h}>
              <button
                type="button"
                disabled={salvando}
                onClick={() => void escolher(h)}
                className="min-h-[56px] w-full rounded-xl border-2 border-noite-100 bg-white text-lg font-semibold text-noite-900 disabled:opacity-60"
              >
                {h}h
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => setMostrarOutras(true)}
          className="min-h-[48px] w-full py-2 text-lg text-noite-700 underline"
        >
          Outro horário
        </button>
      )}

      {aviso && (
        <p className="rounded-2xl border-2 border-ouro-300 bg-ouro-300/15 px-5 py-4 text-lg leading-relaxed text-noite-900">
          {aviso}
          <button
            type="button"
            onClick={aoTerminar}
            className="mt-3 min-h-[48px] w-full rounded-xl bg-noite-900 px-4 py-3 text-lg font-semibold text-white"
          >
            Continuar
          </button>
        </p>
      )}

      {salvando && <p className="text-lg text-noite-700">guardando…</p>}
    </main>
  );
}
