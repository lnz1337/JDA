import { useEffect, useState } from 'react';
import type { LicaoCompleta } from '../../shared/types';
import { Player, type Faixa } from '../components/Player';
import { TextoMd } from '../components/TextoMd';
import { api, ErroApi } from '../lib/api';
import { irPara } from '../lib/rota';

/** Uma frase curta ao concluir. Sem promessa de resultado (§14). */
const INCENTIVOS = [
  'Que São Miguel guarde o seu dia.',
  'Mais um dia de oração guardado.',
  'Feito. Volte amanhã, no seu horário.',
  'A sua intenção foi entregue mais uma vez.',
];

function mensagemDeIncentivo(dia: number, total: number, concluidos: number): string {
  if (concluidos >= total) return 'Você concluiu a jornada inteira. Que caminhada!';
  return INCENTIVOS[dia % INCENTIVOS.length] ?? INCENTIVOS[0] ?? '';
}

export function Licao({ id }: { id: string }) {
  const [licao, setLicao] = useState<LicaoCompleta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [concluindo, setConcluindo] = useState(false);
  const [feito, setFeito] = useState<{ mensagem: string } | null>(null);

  useEffect(() => {
    setLicao(null);
    setErro(null);
    setFeito(null);
    api<{ licao: LicaoCompleta }>(`/api/licoes/${id}`)
      .then((r) => setLicao(r.licao))
      .catch((e) => {
        if (e instanceof ErroApi && e.codigo === 'bloqueada') {
          setErro('Este dia ainda não abriu. Volte amanhã, no seu horário de oração.');
        } else if (e instanceof ErroApi && e.codigo === 'sem_acesso') {
          setErro('Este conteúdo não está liberado na sua conta.');
        } else {
          setErro('Não consegui carregar agora. Confira a internet e tente de novo.');
        }
      });
  }, [id]);

  async function concluir() {
    if (!licao) return;
    setConcluindo(true);
    try {
      const r = await api<{ concluidos: number; total: number }>(`/api/licoes/${id}/concluir`, {
        method: 'POST',
      });
      setFeito({ mensagem: mensagemDeIncentivo(licao.dia, r.total, r.concluidos) });
      setLicao({ ...licao, estado: 'concluido' });
    } catch {
      setErro('Não consegui marcar agora. Tente de novo em instantes.');
    } finally {
      setConcluindo(false);
    }
  }

  const rotuloDoDia = licao
    ? `${licao.unlock_rule === 'daily' ? 'Dia' : 'Parte'} ${licao.dia} de ${licao.total_days}`
    : '';

  const faixas: Faixa[] = [];
  if (licao?.audio_url) {
    faixas.push({
      src: licao.audio_url,
      titulo: licao.unlock_rule === 'daily' ? 'Oração do dia' : licao.titulo,
      contexto: rotuloDoDia,
      lessonId: licao.id,
      dia: licao.dia,
      duracaoConhecida: licao.duracao_s,
    });
  }
  if (licao?.bonus_audio_url) {
    faixas.push({
      src: licao.bonus_audio_url,
      titulo: licao.bonus_title ?? 'Faixa extra',
      contexto: rotuloDoDia,
      lessonId: licao.id,
      dia: licao.dia,
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-8">
      <button
        type="button"
        onClick={() => irPara(licao ? `/programa/${licao.programa_id}` : '/')}
        className="min-h-[48px] self-start text-lg text-noite-700 underline"
      >
        ← Voltar para a lista
      </button>

      {erro && !licao && (
        <div className="space-y-4">
          <p className="text-xl leading-relaxed text-noite-900">{erro}</p>
          <button
            type="button"
            onClick={() => irPara('/')}
            className="min-h-[56px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white"
          >
            Voltar para o início
          </button>
        </div>
      )}

      {!licao && !erro && <p className="text-lg text-noite-700">carregando…</p>}

      {licao && (
        <>
          <header className="space-y-2">
            <p className="text-base font-semibold uppercase tracking-[0.14em] text-ouro-500">
              {licao.unlock_rule === 'daily' ? 'Dia' : 'Parte'} {licao.dia} de {licao.total_days}
            </p>
            <h1 className="text-3xl font-semibold leading-tight text-noite-900">{licao.titulo}</h1>
            {licao.frase && <p className="text-lg leading-relaxed text-noite-700">{licao.frase}</p>}
          </header>

          {licao.notice && (
            <p className="rounded-2xl border-2 border-ouro-300 bg-ouro-300/15 px-5 py-4 text-base leading-relaxed text-noite-900">
              {licao.notice}
            </p>
          )}

          {faixas.length > 0 ? (
            <Player faixas={faixas} />
          ) : (
            <p className="text-base text-noite-700">
              {licao.unlock_rule === 'daily' ? 'Este dia' : 'Esta parte'} é de leitura, sem áudio.
            </p>
          )}

          {licao.body_md && <TextoMd md={licao.body_md} />}

          {feito ? (
            <p className="rounded-2xl border-2 border-noite-900 bg-white px-5 py-5 text-xl font-semibold leading-relaxed text-noite-900">
              Concluído ✓ {feito.mensagem}
            </p>
          ) : licao.estado === 'concluido' ? (
            <p className="text-xl font-semibold text-noite-900">Concluído ✓</p>
          ) : (
            <button
              type="button"
              onClick={() => void concluir()}
              disabled={concluindo}
              className="min-h-[64px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white disabled:opacity-60"
            >
              {concluindo ? 'Marcando…' : 'Concluí o dia de hoje'}
            </button>
          )}

          {erro && licao && <p className="text-lg font-medium text-red-700">{erro}</p>}
        </>
      )}
    </main>
  );
}
