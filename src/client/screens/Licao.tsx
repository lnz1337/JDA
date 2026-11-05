import { useEffect, useMemo, useState } from 'react';
import { type Passos, textoDeLiberacao, TOTAL_DE_PASSOS } from '../../shared/licao';
import type { LicaoCompleta, LicaoNaLista } from '../../shared/types';
import { type Faixa, MiniPlayer, PlayerGrande, type Tocador, useTocador } from '../components/Player';
import { TextoMd } from '../components/TextoMd';
import { BarraDePassos, ControleLetra, Ornamento, Velas } from '../components/Visual';
import { api, ErroApi } from '../lib/api';
import { marcarPasso, passosFeitos } from '../lib/passos';
import { irPara, substituirPor } from '../lib/rota';

/** Uma frase curta ao concluir uma parte avulsa. Sem promessa de resultado (§14). */
const INCENTIVOS = [
  'Que São Miguel guarde o seu dia.',
  'Mais um dia de oração guardado.',
  'Feito. Volte amanhã, no seu horário.',
  'A sua intenção foi entregue mais uma vez.',
];

function mensagemDeIncentivo(dia: number, total: number, concluidos: number): string {
  if (concluidos >= total) return 'Você concluiu tudo. Que caminhada!';
  return INCENTIVOS[dia % INCENTIVOS.length] ?? INCENTIVOS[0] ?? '';
}

/** A tela curta depois do "Concluí o dia N": as velas e quando abre o próximo. */
interface Fechamento {
  acesas: Set<number>;
  /** `null` enquanto a lista de dias não chegou. */
  proximo: string | null;
}

/** O que dizer sobre o dia seguinte, a partir da lista de dias do programa. */
function textoDoProximo(dia: number, total: number, licoes: LicaoNaLista[]): string {
  const concluidos = licoes.filter((l) => l.estado === 'concluido').length;
  if (concluidos >= total) {
    return `Você acendeu as ${total} velas e concluiu a jornada. Que São Miguel continue à sua frente.`;
  }
  const seguinte = licoes.find((l) => l.dia === dia + 1);
  if (!seguinte) {
    const faltam = total - concluidos;
    return `Este foi o último dia. ${faltam === 1 ? 'Falta 1 vela' : `Faltam ${faltam} velas`}: os dias que ficaram para trás continuam abertos.`;
  }
  if (seguinte.estado === 'bloqueado') {
    return `O dia ${seguinte.dia} ${textoDeLiberacao(seguinte.dias_para_liberar).replace('Libera', 'libera')}.`;
  }
  if (seguinte.estado === 'concluido') return `O dia ${seguinte.dia} você já fez.`;
  return `O dia ${seguinte.dia} já está liberado. Quando quiser, é só abrir.`;
}

function montarFaixas(licao: LicaoCompleta | null): Faixa[] {
  if (!licao) return [];
  const contexto = `${licao.unlock_rule === 'daily' ? 'Dia' : 'Parte'} ${licao.dia} de ${licao.total_days}`;
  const faixas: Faixa[] = [];
  if (licao.audio_url) {
    faixas.push({
      src: licao.audio_url,
      titulo: licao.unlock_rule === 'daily' ? 'Oração do dia' : licao.titulo,
      contexto,
      lessonId: licao.id,
      dia: licao.dia,
      duracaoConhecida: licao.duracao_s,
    });
  }
  if (licao.bonus_audio_url) {
    faixas.push({
      src: licao.bonus_audio_url,
      titulo: licao.bonus_title ?? 'Faixa extra',
      contexto,
      lessonId: licao.id,
      dia: licao.dia,
    });
  }
  return faixas;
}

/**
 * A lição. A da jornada é **em passos** (docs/estilo-visual.md): a oração, a
 * prática e a intenção, uma por tela, com o passo na URL (`?passo=2`) — o push
 * abre no 1, e voltar pelo navegador volta um passo. Lição fora desse formato
 * (Presentes, pacotes) fica numa tela só.
 *
 * O `<audio>` é montado **aqui**, uma vez, fora dos passos: trocar de passo
 * redesenha os controles, não o áudio. A tela é montada de novo a cada lição
 * (`key` no App), então os eventos do funil contam por lição.
 */
export function Licao({ id, passo }: { id: string; passo: number }) {
  const [licao, setLicao] = useState<LicaoCompleta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [concluindo, setConcluindo] = useState(false);
  const [incentivo, setIncentivo] = useState<string | null>(null);
  const [fechamento, setFechamento] = useState<Fechamento | null>(null);
  // Já ouviu a oração (neste aparelho)? Decide qual botão do passo 1 é o dourado.
  const [ouvida, setOuvida] = useState(() => passosFeitos(id).has(1));

  useEffect(() => {
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

  const faixas = useMemo(() => montarFaixas(licao), [licao]);
  const t = useTocador(faixas, (_faixa, indice) => {
    if (indice !== 0) return;
    marcarPasso(id, 1);
    setOuvida(true);
  });

  const passos = licao?.passos ?? null;
  const diario = licao?.unlock_rule === 'daily';

  async function concluir() {
    if (!licao) return;
    setConcluindo(true);
    setErro(null);
    try {
      const r = await api<{ concluidos: number; total: number }>(`/api/licoes/${id}/concluir`, {
        method: 'POST',
      });
      setLicao({ ...licao, estado: 'concluido' });

      if (!passos) {
        setIncentivo(mensagemDeIncentivo(licao.dia, r.total, r.concluidos));
        return;
      }

      setFechamento({ acesas: new Set([licao.dia]), proximo: null });
      scrollTo(0, 0);
      // A lista de dias diz quais velas acender e quando abre o próximo. Não
      // matricula nada: a matrícula já existe, a lição acabou de abrir.
      api<{ licoes: LicaoNaLista[] }>(`/api/programas/${licao.programa_id}`)
        .then(({ licoes }) =>
          setFechamento({
            acesas: new Set(licoes.filter((l) => l.estado === 'concluido').map((l) => l.dia)),
            proximo: textoDoProximo(licao.dia, licao.total_days, licoes),
          }),
        )
        .catch(() => undefined);
    } catch {
      setErro('Não consegui marcar agora. Tente de novo em instantes.');
    } finally {
      setConcluindo(false);
    }
  }

  function irParaPasso(n: number) {
    if (passo === 2 && n === 3) marcarPasso(id, 2);
    // A marca diz que a entrada anterior do histórico é o passo de antes.
    irPara(`/licao/${id}?passo=${n}`, { passoDaLicao: id });
  }

  function voltarUmPasso() {
    const estado = history.state as { passoDaLicao?: string } | null;
    if (estado?.passoDaLicao === id) {
      history.back();
      return;
    }
    // Entrou direto num passo (pela Home): troca a entrada em vez de empilhar,
    // senão o "voltar" do navegador levaria de novo para o passo de onde saiu.
    substituirPor(passo - 1 > 1 ? `/licao/${id}?passo=${passo - 1}` : `/licao/${id}`);
  }

  const emPassos = Boolean(licao && passos);
  const passoNaTela = emPassos ? passo : 1;
  // O player grande está na tela no passo 1 e na lição de tela única; nos outros
  // casos, quem controla o áudio que continua tocando é o mini player.
  const playerGrandeNaTela = Boolean(licao) && !fechamento && passoNaTela === 1;

  return (
    <>
      {t.elemento}
      <main
        className={`mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pt-4 ${
          playerGrandeNaTela || !t.comecou || (fechamento && !t.tocando) ? 'pb-10' : 'pb-36'
        }`}
      >
        {/* Na letra maior o A− / A+ desce para a linha de baixo em vez de quebrar o link. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => irPara(licao ? `/programa/${licao.programa_id}` : '/')}
            className="link whitespace-nowrap text-lg"
          >
            ‹ {diario ? 'Lista de dias' : 'Voltar para a lista'}
          </button>
          <ControleLetra />
        </div>

        {emPassos && !fechamento && <BarraDePassos atual={passoNaTela} total={TOTAL_DE_PASSOS} />}

        {erro && !licao && (
          <div className="space-y-4">
            <p className="text-xl leading-relaxed text-texto">{erro}</p>
            <button type="button" onClick={() => irPara('/')} className="botao botao-secundario">
              Voltar para o início
            </button>
          </div>
        )}

        {!licao && !erro && <p className="text-lg text-texto2">carregando…</p>}

        {licao && fechamento && (
          <TelaDaVela licao={licao} fechamento={fechamento} />
        )}

        {licao && !fechamento && passos && passoNaTela === 1 && (
          <PassoOracao licao={licao} passos={passos} t={t} ouvida={ouvida} aoContinuar={() => irParaPasso(2)} />
        )}

        {licao && !fechamento && passos && passoNaTela === 2 && (
          <PassoPratica
            passos={passos}
            aoContinuar={() => irParaPasso(3)}
            aoVoltar={voltarUmPasso}
          />
        )}

        {licao && !fechamento && passos && passoNaTela === 3 && (
          <PassoIntencao
            licao={licao}
            passos={passos}
            concluindo={concluindo}
            aoConcluir={() => void concluir()}
            aoVoltar={voltarUmPasso}
          />
        )}

        {licao && !passos && (
          <TelaUnica
            licao={licao}
            t={t}
            concluindo={concluindo}
            incentivo={incentivo}
            aoConcluir={() => void concluir()}
          />
        )}

        {erro && licao && <p className="text-lg font-medium text-red-700">{erro}</p>}
      </main>
      {/* Na tela da vela, só se a oração ainda estiver tocando: pausada, ali, é ruído. */}
      {!playerGrandeNaTela && (!fechamento || t.tocando) && <MiniPlayer t={t} />}
    </>
  );
}

function rotuloDoDia(licao: LicaoCompleta): string {
  return `${licao.unlock_rule === 'daily' ? 'Dia' : 'Parte'} ${licao.dia} de ${licao.total_days}`;
}

/** Passo 1: a oração. O dourado é o de ouvir, até a oração passar de 90%. */
function PassoOracao({
  licao,
  passos,
  t,
  ouvida,
  aoContinuar,
}: {
  licao: LicaoCompleta;
  passos: Passos;
  t: Tocador;
  ouvida: boolean;
  aoContinuar: () => void;
}) {
  const temAudio = t.faixas.length > 0;
  // "Continuar" nunca é travado: só deixa de ser o dourado enquanto há o que ouvir.
  const continuarDourado = ouvida || !temAudio || licao.estado === 'concluido';

  return (
    <>
      <header className="space-y-2">
        <p className="rotulo">{rotuloDoDia(licao)}</p>
        <h1 className="text-3xl font-bold leading-tight text-titulo">{licao.titulo}</h1>
        {licao.frase && <p className="text-lg leading-relaxed text-texto2">{licao.frase}</p>}
        <p className="text-lg font-semibold text-texto">
          <span aria-hidden="true">📖</span> {passos.leitura}
        </p>
      </header>

      {licao.notice && (
        <p className="caixa-destaque text-base leading-relaxed text-texto">{licao.notice}</p>
      )}

      {temAudio ? (
        <PlayerGrande t={t} destaque={!continuarDourado} rotuloOuvir="Ouvir a oração" />
      ) : (
        <p className="text-base text-texto2">Este dia é de leitura, sem áudio.</p>
      )}

      <section className="caixa-destaque space-y-2">
        <p className="rotulo">Por que hoje</p>
        <p className="text-lg leading-relaxed text-texto">{passos.reflexao}</p>
      </section>

      <button
        type="button"
        onClick={aoContinuar}
        className={`botao ${continuarDourado ? 'botao-dourado' : 'botao-secundario'}`}
      >
        Continuar ›
      </button>
    </>
  );
}

/** Passo 2: a prática, grande, e o "Continuar" dourado. */
function PassoPratica({
  passos,
  aoContinuar,
  aoVoltar,
}: {
  passos: Passos;
  aoContinuar: () => void;
  aoVoltar: () => void;
}) {
  return (
    <>
      <section className="space-y-4">
        <p className="rotulo">Para fazer hoje</p>
        <p className="text-xl font-medium leading-relaxed text-texto">{passos.pratica}</p>
      </section>
      <button type="button" onClick={aoContinuar} className="botao botao-dourado">
        Continuar ›
      </button>
      <button type="button" onClick={aoVoltar} className="botao botao-secundario">
        ‹ Voltar um passo
      </button>
    </>
  );
}

/** Passo 3: a intenção em serifa, centralizada, e o verde "Concluí o dia N". */
function PassoIntencao({
  licao,
  passos,
  concluindo,
  aoConcluir,
  aoVoltar,
}: {
  licao: LicaoCompleta;
  passos: Passos;
  concluindo: boolean;
  aoConcluir: () => void;
  aoVoltar: () => void;
}) {
  return (
    <>
      <section className="space-y-5 pt-2 text-center">
        <p className="rotulo">A sua intenção</p>
        <Ornamento />
        <p className="font-serif text-3xl font-semibold leading-snug text-titulo">
          {passos.intencao}
        </p>
      </section>

      {licao.estado === 'concluido' ? (
        <>
          <p className="text-center text-lg font-bold text-verde">✓ Este dia já está concluído</p>
          <button type="button" onClick={() => irPara('/')} className="botao botao-secundario">
            Voltar para o início
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={aoConcluir}
          disabled={concluindo}
          className="botao botao-verde"
        >
          {concluindo ? 'Marcando…' : `Concluí o dia ${licao.dia}`}
        </button>
      )}

      <button type="button" onClick={aoVoltar} className="botao botao-secundario">
        ‹ Voltar um passo
      </button>
    </>
  );
}

/** Depois do "Concluí": a vela do dia acesa e quando abre o próximo. */
function TelaDaVela({ licao, fechamento }: { licao: LicaoCompleta; fechamento: Fechamento }) {
  return (
    <section className="space-y-6 pt-4 text-center">
      <p className="rotulo">Dia {licao.dia} concluído</p>
      <h1 className="text-3xl font-bold leading-tight text-titulo">
        A vela do dia {licao.dia} está acesa
      </h1>
      <Velas acesas={fechamento.acesas} total={licao.total_days} centro />
      {fechamento.proximo && (
        <p className="text-lg leading-relaxed text-texto">{fechamento.proximo}</p>
      )}
      <button type="button" onClick={() => irPara('/')} className="botao botao-secundario">
        Voltar para o início
      </button>
    </section>
  );
}

/** Lição fora do formato da jornada (Presentes, pacotes): tudo numa tela. */
function TelaUnica({
  licao,
  t,
  concluindo,
  incentivo,
  aoConcluir,
}: {
  licao: LicaoCompleta;
  t: Tocador;
  concluindo: boolean;
  incentivo: string | null;
  aoConcluir: () => void;
}) {
  const diario = licao.unlock_rule === 'daily';
  return (
    <>
      <header className="space-y-2">
        <p className="rotulo">{rotuloDoDia(licao)}</p>
        <h1 className="text-3xl font-bold leading-tight text-titulo">{licao.titulo}</h1>
        {licao.frase && <p className="text-lg leading-relaxed text-texto2">{licao.frase}</p>}
      </header>

      {licao.notice && (
        <p className="caixa-destaque text-base leading-relaxed text-texto">{licao.notice}</p>
      )}

      {t.faixas.length > 0 ? (
        <PlayerGrande t={t} destaque rotuloOuvir="Ouvir" />
      ) : (
        <p className="text-base text-texto2">
          {diario ? 'Este dia' : 'Esta parte'} é de leitura, sem áudio.
        </p>
      )}

      {licao.body_md && <TextoMd md={licao.body_md} />}

      {incentivo ? (
        <p className="caixa-destaque py-5 text-xl font-semibold leading-relaxed text-texto">
          Concluído ✓ {incentivo}
        </p>
      ) : licao.estado === 'concluido' ? (
        <p className="text-xl font-semibold text-verde">Concluído ✓</p>
      ) : (
        <button
          type="button"
          onClick={aoConcluir}
          disabled={concluindo}
          className="botao botao-verde"
        >
          {concluindo ? 'Marcando…' : diario ? `Concluí o dia ${licao.dia}` : 'Concluí esta parte'}
        </button>
      )}
    </>
  );
}
