import { useEffect, useState } from 'react';
import type { Programa } from '../../shared/types';
import { APP_NAME } from '../../shared/constants';
import { api, type Me } from '../lib/api';
import { irPara } from '../lib/rota';

/**
 * A primeira tela de quem está dentro: o cartão do dia, grande, com o que fazer
 * hoje. O público é 55+, então o caminho para a oração do dia é **um toque**, e
 * todo botão tem texto — ícone sozinho não diz nada para quem não cresceu com
 * aplicativo.
 */
export function Home({ me, aoSair }: { me: Me; aoSair: () => void }) {
  const [programas, setProgramas] = useState<Programa[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    api<{ programas: Programa[] }>('/api/programas')
      .then((r) => setProgramas(r.programas))
      .catch(() => setErro(true));
  }, []);

  const primeiro = me.usuario.nome?.split(' ')[0];
  const jornada = programas?.find((p) => p.unlock_rule === 'daily');
  const outros = programas?.filter((p) => p.unlock_rule !== 'daily') ?? [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 py-10">
      <header className="space-y-1">
        <p className="text-base font-semibold uppercase tracking-[0.18em] text-ouro-500">
          {primeiro ? `Olá, ${primeiro}` : 'Olá'}
        </p>
        <h1 className="text-3xl font-semibold text-noite-900">{APP_NAME}</h1>
      </header>

      {erro && (
        <p className="rounded-2xl bg-white px-5 py-4 text-lg text-noite-700">
          Não consegui carregar agora. Confira a internet e puxe a tela para atualizar.
        </p>
      )}

      {programas === null && !erro && <p className="text-lg text-noite-700">carregando…</p>}

      {jornada && <CartaoDoDia programa={jornada} />}

      {outros.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-noite-900">Também liberado para você</h2>
          <ul className="space-y-3">
            {outros.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => irPara(`/programa/${p.id}`)}
                  className="min-h-[56px] w-full rounded-2xl border-2 border-noite-100 bg-white px-5 py-4 text-left"
                >
                  <span className="block text-lg font-semibold text-noite-900">{p.titulo}</span>
                  <span className="block text-base text-noite-700">
                    {p.concluidos > 0
                      ? `${p.concluidos} de ${p.total_days} concluídos`
                      : `${p.total_days} ${p.total_days === 1 ? 'parte' : 'partes'}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {programas !== null && programas.length === 0 && !erro && (
        <section className="space-y-3 rounded-2xl border-2 border-noite-100 bg-white px-5 py-4">
          <p className="text-lg text-noite-700">
            Seu acesso está ativo, mas ainda não há conteúdo liberado nesta conta.
          </p>
          {me.suporte && (
            <p className="text-lg text-noite-700">
              Escreva para{' '}
              <a className="font-medium text-noite-900 underline" href={`mailto:${me.suporte}`}>
                {me.suporte}
              </a>{' '}
              que a gente resolve.
            </p>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={aoSair}
        className="mt-auto min-h-[48px] text-lg text-noite-700 underline"
      >
        Sair do app
      </button>
    </main>
  );
}

function CartaoDoDia({ programa }: { programa: Programa }) {
  const dia = programa.atual;
  const concluiuTudo = programa.concluidos >= programa.total_days;

  return (
    <section className="space-y-4 rounded-3xl border-2 border-noite-100 bg-white px-5 py-6">
      {dia ? (
        <>
          <p className="text-base font-semibold uppercase tracking-[0.14em] text-ouro-500">
            Dia {dia.dia} de {programa.total_days}
          </p>
          <h2 className="text-2xl font-semibold leading-snug text-noite-900">{dia.titulo}</h2>
          {dia.frase && <p className="text-lg leading-relaxed text-noite-700">{dia.frase}</p>}

          {dia.estado === 'concluido' && (
            <p className="text-lg font-semibold text-noite-900">Concluído ✓</p>
          )}

          <button
            type="button"
            onClick={() => irPara(`/licao/${dia.id}`)}
            className="min-h-[56px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white"
          >
            {dia.estado === 'concluido'
              ? 'Ouvir de novo'
              : dia.tem_audio
                ? 'Ouvir a oração de hoje'
                : 'Abrir a oração de hoje'}
          </button>
        </>
      ) : (
        <p className="text-lg text-noite-700">A jornada vai começar.</p>
      )}

      <button
        type="button"
        onClick={() => irPara(`/programa/${programa.id}`)}
        className="min-h-[48px] w-full text-lg text-noite-700 underline"
      >
        Ver os {programa.total_days} dias
      </button>

      {concluiuTudo && (
        <p className="text-lg font-medium text-noite-900">
          Você concluiu a jornada inteira. Que São Miguel continue à sua frente.
        </p>
      )}
    </section>
  );
}
