import { useEffect, useState } from 'react';
import type { LicaoNaLista, Programa as DadosPrograma } from '../../shared/types';
import { api, ErroApi } from '../lib/api';
import { irPara } from '../lib/rota';

/**
 * A lista de dias. Serve tanto para a jornada (libera um por dia) quanto para os
 * produtos avulsos (tudo liberado), porque a diferença está só no estado que o
 * servidor devolve.
 *
 * Dia bloqueado **sempre diz quando abre**. Cadeado sem explicação faz a pessoa
 * achar que o acesso falhou e escrever para o suporte.
 */
export function Programa({ id }: { id: string }) {
  const [dados, setDados] = useState<{ programa: DadosPrograma; licoes: LicaoNaLista[] } | null>(
    null,
  );
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setDados(null);
    setErro(null);
    api<{ programa: DadosPrograma; licoes: LicaoNaLista[] }>(`/api/programas/${id}`)
      .then(setDados)
      .catch((e) =>
        setErro(
          e instanceof ErroApi && e.codigo === 'sem_acesso'
            ? 'Este conteúdo não está liberado na sua conta.'
            : 'Não consegui carregar agora. Confira a internet e tente de novo.',
        ),
      );
  }, [id]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 py-8">
      <button
        type="button"
        onClick={() => irPara('/')}
        className="min-h-[48px] self-start text-lg text-noite-700 underline"
      >
        ← Voltar para o início
      </button>

      {erro && <p className="text-lg text-noite-900">{erro}</p>}
      {!dados && !erro && <p className="text-lg text-noite-700">carregando…</p>}

      {dados && (
        <>
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold leading-tight text-noite-900">
              {dados.programa.titulo}
            </h1>
            <p className="text-lg text-noite-700">
              {dados.programa.concluidos} de {dados.programa.total_days} concluídos
            </p>
          </header>

          {dados.programa.notice && (
            <p className="rounded-2xl border-2 border-ouro-300 bg-ouro-300/15 px-5 py-4 text-base leading-relaxed text-noite-900">
              {dados.programa.notice}
            </p>
          )}

          <ol className="space-y-3">
            {dados.licoes.map((licao) => (
              <li key={licao.id}>
                <ItemDoDia licao={licao} diario={dados.programa.unlock_rule === 'daily'} />
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

function textoDeLiberacao(dias: number | undefined): string {
  if (dias === 1) return 'Libera amanhã';
  if (dias && dias > 1) return `Libera em ${dias} dias`;
  return 'Libera em breve';
}

function ItemDoDia({ licao, diario }: { licao: LicaoNaLista; diario: boolean }) {
  const rotulo = diario ? `Dia ${licao.dia}` : `Parte ${licao.dia}`;
  const bloqueado = licao.estado === 'bloqueado';

  const moldura = {
    hoje: 'border-noite-900 bg-white',
    concluido: 'border-noite-100 bg-white',
    liberado: 'border-noite-100 bg-white',
    bloqueado: 'border-noite-100 bg-noite-50',
  }[licao.estado];

  const conteudo = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-base font-semibold uppercase tracking-[0.12em] text-ouro-500">
          {rotulo}
          {licao.estado === 'hoje' && ' · hoje'}
        </span>
        {licao.estado === 'concluido' && (
          <span className="text-base font-semibold text-noite-900">Concluído ✓</span>
        )}
      </span>

      <span className="mt-1 block text-lg font-semibold leading-snug text-noite-900">
        {licao.titulo}
      </span>

      {licao.frase && !bloqueado && (
        <span className="mt-1 block text-base leading-relaxed text-noite-700">{licao.frase}</span>
      )}

      {bloqueado && (
        <span className="mt-1 block text-base font-medium text-noite-700">
          {textoDeLiberacao(licao.dias_para_liberar)}
        </span>
      )}
    </>
  );

  if (bloqueado) {
    // Nada de clicar: mas o motivo está escrito, não escondido atrás de cadeado.
    return (
      <div className={`block min-h-[72px] rounded-2xl border-2 px-5 py-4 ${moldura}`}>
        {conteudo}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => irPara(`/licao/${licao.id}`)}
      className={`block min-h-[72px] w-full rounded-2xl border-2 px-5 py-4 text-left ${moldura}`}
    >
      {conteudo}
    </button>
  );
}
