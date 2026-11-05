import { useEffect, useMemo, useState } from 'react';
import { horaNoFuso, passosFeitosDoDia, saudacao } from '../../shared/hoje';
import { minutosDe } from '../../shared/licao';
import type { LicaoNaLista, Oferta, Programa } from '../../shared/types';
import { Arte, ChipDuracao } from '../components/Visual';
import { api, registrarEvento, type Me } from '../lib/api';
import type { Convite } from '../lib/convite';
import { permissaoDeNotificacao } from '../lib/dispositivo';
import { passosFeitos } from '../lib/passos';
import { irPara } from '../lib/rota';
import { CHAVES, conviteAtual, dispensar, precisaAssinarDeNovo } from './Onboarding';

/**
 * A Home "Hoje" (docs/estilo-visual.md): o que fazer agora, de cima para baixo.
 * A saudação, o cartão do dia com o botão de começar, os três passos do dia,
 * e só depois a oferta (§9) e o resto. O público é 55+, então o caminho para a
 * oração do dia é **um toque**, e todo botão tem texto.
 *
 * A Home **não matricula** (§6): sem matrícula, o servidor devolve o dia 1 como
 * o de hoje, e o cartão convida para ele.
 */
export function Home({ me, aoSair }: { me: Me; aoSair: () => void }) {
  const [programas, setProgramas] = useState<Programa[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    api<{ programas: Programa[] }>('/api/programas')
      .then((r) => setProgramas(r.programas))
      .catch(() => setErro(true));
  }, []);

  const jornada = programas?.find((p) => p.unlock_rule === 'daily');
  const outros = programas?.filter((p) => p.unlock_rule !== 'daily') ?? [];
  // A hora é lida uma vez por abertura da Home: a saudação não muda com a tela aberta.
  const ola = useMemo(
    () => saudacao(horaNoFuso(me.usuario.timezone), me.usuario.nome),
    [me.usuario.timezone, me.usuario.nome],
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col">
      <FaixaDoConvite />

      <div className="flex flex-1 flex-col gap-7 px-5 pt-6 pb-10">
        <header className="space-y-1">
          <h1 className="text-4xl font-bold leading-tight text-titulo">{ola}</h1>
          {jornada?.atual && (
            <p className="text-lg text-texto2">
              {jornada.concluidos >= jornada.total_days
                ? `Jornada concluída · ${jornada.total_days} de ${jornada.total_days}`
                : `Dia ${jornada.atual.dia} de ${jornada.total_days}`}
            </p>
          )}
        </header>

        {erro && (
          <p className="cartao px-5 py-4 text-lg text-texto">
            Não consegui carregar agora. Confira a internet e puxe a tela para atualizar.
          </p>
        )}

        {programas === null && !erro && <p className="text-lg text-texto2">carregando…</p>}

        {jornada && <CartaoDeHoje programa={jornada} />}

        {jornada?.atual && <ListaDoDia dia={jornada.atual} />}

        {/* Abaixo da lista do dia, nunca acima: a oração vem antes da venda (§9). */}
        {jornada && <CartaoDeOferta />}

        {outros.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-titulo">Também liberado para você</h2>
            <ul className="space-y-3">
              {outros.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => irPara(`/programa/${p.id}`)}
                    className="flex min-h-[64px] w-full items-center gap-3 cartao px-5 py-4 text-left"
                  >
                    <span className="flex-1">
                      <span className="block text-lg font-semibold leading-snug text-texto">
                        {p.titulo}
                      </span>
                      <span className="block text-base text-texto2">
                        {p.concluidos > 0
                          ? `${p.concluidos} de ${p.total_days} concluídos`
                          : `${p.total_days} ${p.total_days === 1 ? 'parte' : 'partes'}`}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-2xl text-ouro">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {programas !== null && programas.length === 0 && !erro && (
          <section className="space-y-3 cartao px-5 py-4">
            <p className="text-lg text-texto2">
              Seu acesso está ativo, mas ainda não há conteúdo liberado nesta conta.
            </p>
            {me.suporte && (
              <p className="text-lg text-texto2">
                Escreva para{' '}
                <a
                  className="font-semibold text-ouro-forte underline"
                  href={`mailto:${me.suporte}`}
                >
                  {me.suporte}
                </a>{' '}
                que a gente resolve.
              </p>
            )}
          </section>
        )}

        <LinhaDoLembrete hora={me.usuario.prayer_hour ?? null} />

        <button type="button" onClick={aoSair} className="link mt-auto self-center text-lg">
          Sair do app
        </button>
      </div>
    </main>
  );
}

/**
 * O convite do aparelho (instalar ou lembrete), como faixa fina sob o
 * cabeçalho. Um por vez, dispensável por 7 dias (§11): lembra sem prender.
 */
function FaixaDoConvite() {
  const [passo, setPasso] = useState<Convite>(() => conviteAtual());

  /*
   * O `conviteAtual` é síncrono e não consulta o `pushManager`, então ele não vê
   * o caso de quem permitiu a notificação e **não conseguiu assinar**. A
   * checagem é assíncrona, por isso vem depois da primeira renderização. O
   * lembrete passa na frente do de instalar, como no `conviteAtual`.
   */
  useEffect(() => {
    if (passo === 'lembrete') return;

    let vivo = true;
    void precisaAssinarDeNovo().then((precisa) => {
      if (vivo && precisa) setPasso('lembrete');
    });
    return () => {
      vivo = false;
    };
  }, [passo]);

  if (passo === null) return null;

  const instalar = passo === 'instalar';

  return (
    <div className="flex items-center gap-1 border-b border-linha bg-cartao pl-5 pr-2">
      <button
        type="button"
        onClick={() => irPara(instalar ? '/instalar' : '/lembrete')}
        className="min-h-[52px] flex-1 py-2 text-left text-base font-bold leading-snug text-ouro-forte"
      >
        <span aria-hidden="true">{instalar ? '📲' : '🔔'}</span>{' '}
        {instalar ? 'Coloque o app na tela do celular' : 'Ligue o lembrete da oração'} ›
      </button>
      <button
        type="button"
        onClick={() => {
          dispensar(instalar ? CHAVES.instalarDispensado : CHAVES.lembreteDispensado);
          setPasso(conviteAtual());
        }}
        className="min-h-[52px] shrink-0 px-3 text-base font-semibold text-texto2 underline underline-offset-4"
      >
        Agora não
      </button>
    </div>
  );
}

/** Os três passos da lição, como a Home os mostra. */
const PASSOS_DO_DIA = [
  { n: 1, icone: '🙏', texto: 'Ouvir a oração' },
  { n: 2, icone: '✝️', texto: 'A prática de hoje' },
  { n: 3, icone: '🕯️', texto: 'Entregar a intenção' },
] as const;

function caminhoDoPasso(licaoId: string, n: number): string {
  return n > 1 ? `/licao/${licaoId}?passo=${n}` : `/licao/${licaoId}`;
}

function feitosDe(dia: LicaoNaLista): Set<1 | 2 | 3> {
  return passosFeitosDoDia(dia.estado === 'concluido', passosFeitos(dia.id));
}

/**
 * O cartão do dia, com a arte no topo. O botão dourado é o de começar; quem já
 * fez parte continua do primeiro passo que falta, e quem concluiu vê o
 * "✓ Concluído" e pode ouvir de novo.
 */
function CartaoDeHoje({ programa }: { programa: Programa }) {
  const dia = programa.atual;
  const concluiuTudo = programa.concluidos >= programa.total_days;
  const feitos = useMemo(() => (dia ? feitosDe(dia) : new Set<number>()), [dia]);
  const proximo = PASSOS_DO_DIA.find((p) => !feitos.has(p.n))?.n ?? 1;

  return (
    <section className="cartao overflow-hidden">
      {/*
       * Recorte 4:3 cortado embaixo: o rosto fica no alto e o resto sai. Baixo de
       * propósito: o "Começar" tem que aparecer sem rolar num celular de 812px.
       */}
      <Arte recorte="cartao" prioridade desbotar={false} className="max-h-[150px]" />
      <div className="space-y-4 px-5 pt-5 pb-6">
        {dia ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="rotulo">Agora · Dia {dia.dia}</p>
              <ChipDuracao segundos={dia.duracao_s} />
            </div>
            <h2 className="font-serif text-3xl font-bold leading-snug text-titulo">
              {dia.titulo}
            </h2>
            {dia.frase && <p className="text-lg leading-relaxed text-texto2">{dia.frase}</p>}

            {dia.estado === 'concluido' ? (
              <>
                <p className="text-lg font-bold text-verde">✓ Concluído</p>
                <button
                  type="button"
                  onClick={() => irPara(`/licao/${dia.id}`)}
                  className="botao botao-secundario"
                >
                  Ouvir de novo
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => irPara(caminhoDoPasso(dia.id, proximo))}
                className="botao botao-dourado"
              >
                {feitos.size === 0 ? 'Começar ›' : 'Continuar ›'}
              </button>
            )}
          </>
        ) : (
          <p className="text-lg text-texto2">A jornada vai começar.</p>
        )}

        <button
          type="button"
          onClick={() => irPara(`/programa/${programa.id}`)}
          className="link w-full justify-center text-lg"
        >
          Ver os {programa.total_days} dias
        </button>

        {concluiuTudo && (
          <p className="text-lg font-medium text-texto">
            Você concluiu a jornada inteira. Que São Miguel continue à sua frente.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * "A sua jornada de hoje · 1 de 3": os três passos numerados, cada um abrindo a
 * lição naquele passo. O 1 e o 2 marcam pelo que o aparelho guardou; o 3, e os
 * três de uma vez, quando o servidor diz que a lição está concluída.
 */
function ListaDoDia({ dia }: { dia: LicaoNaLista }) {
  const feitos = useMemo(() => feitosDe(dia), [dia]);
  const minutos = minutosDe(dia.duracao_s);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-titulo">
        A sua jornada de hoje · {feitos.size} de {PASSOS_DO_DIA.length}
      </h2>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={PASSOS_DO_DIA.length}
        aria-valuenow={feitos.size}
        aria-label={`${feitos.size} de ${PASSOS_DO_DIA.length} passos feitos`}
        className="flex gap-2"
      >
        {PASSOS_DO_DIA.map((p) => (
          <span
            key={p.n}
            className={`h-2 flex-1 rounded-full ${feitos.has(p.n) ? 'bg-ouro' : 'bg-linha'}`}
          />
        ))}
      </div>
      <ol className="space-y-3">
        {PASSOS_DO_DIA.map((p) => {
          const feito = feitos.has(p.n);
          return (
            <li key={p.n}>
              <button
                type="button"
                onClick={() => irPara(caminhoDoPasso(dia.id, p.n))}
                className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${
                  feito ? 'border-linha bg-verde-fundo' : 'border-linha bg-cartao'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-extrabold ${
                    feito ? 'bg-verde text-cartao' : 'border-2 border-ouro text-ouro-forte'
                  }`}
                >
                  {feito ? '✓' : p.n}
                </span>
                <span className="flex-1 text-lg font-semibold leading-snug text-texto">
                  <span aria-hidden="true">{p.icone}</span> {p.texto}
                  {p.n === 1 && dia.tem_audio && minutos ? (
                    <span className="font-normal text-texto2"> · {minutos} min</span>
                  ) : null}
                  {feito && <span className="sr-only"> (feito)</span>}
                </span>
                <span aria-hidden="true" className="text-2xl text-ouro">
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * O card de oferta da Home (§9): no máximo um, só quando o servidor diz que é
 * hora (janela da jornada, sem o pacote, não dispensado). Sem push de oferta —
 * só este card.
 *
 * "Agora não" some na hora e avisa o servidor, que esconde o pacote por 7 dias
 * em qualquer aparelho da pessoa.
 */
function CartaoDeOferta() {
  const [oferta, setOferta] = useState<Oferta | null>(null);

  useEffect(() => {
    api<{ oferta: Oferta | null }>('/api/oferta')
      .then((r) => setOferta(r.oferta))
      .catch(() => setOferta(null));
  }, []);

  if (!oferta) return null;

  return (
    <section className="space-y-3 cartao px-5 py-5">
      <h2 className="font-serif text-2xl font-bold leading-snug text-titulo">{oferta.titulo}</h2>
      <p className="text-lg leading-relaxed text-texto2">{oferta.texto}</p>
      {oferta.aviso && (
        <p className="caixa-destaque text-base leading-relaxed text-texto">{oferta.aviso}</p>
      )}
      <button
        type="button"
        onClick={() => {
          registrarEvento('offer_clicked', {
            produto: oferta.produto,
            dia: oferta.dia,
            canal: 'home',
          });
          irPara(`/produto/${oferta.produto}?origem=home`);
        }}
        className="botao botao-secundario"
      >
        Conhecer
      </button>
      <button
        type="button"
        onClick={() => {
          setOferta(null);
          void api('/api/oferta/dispensar', {
            method: 'POST',
            body: JSON.stringify({ produto: oferta.produto }),
          }).catch(() => undefined);
        }}
        className="link w-full justify-center text-base"
      >
        Agora não
      </button>
    </section>
  );
}

/**
 * Até o Perfil existir (fase 7), é por aqui que se troca o horário. Discreta de
 * propósito: quem já escolheu não precisa ver isso todo dia.
 */
function LinhaDoLembrete({ hora }: { hora: number | null }) {
  if (hora === null || permissaoDeNotificacao() !== 'granted') return null;

  return (
    <p className="text-base text-texto2">
      Lembrete às {hora}h ·{' '}
      <button
        type="button"
        onClick={() => irPara('/lembrete')}
        className="font-semibold text-ouro-forte underline"
      >
        mudar
      </button>
    </p>
  );
}
