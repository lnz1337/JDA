/**
 * Onda de campanha em lotes.
 *
 * O Worker envia um e-mail depois do outro dentro de **uma** requisição, a uns
 * 20 por minuto. O `fetch` do Node desiste de esperar a resposta em 300 s
 * (`UND_ERR_HEADERS_TIMEOUT`) e, quando o cliente cai, a Cloudflare corta o
 * Worker junto: em 30/10 a chamada de 200 parou em 108, sem resposta. Por isso
 * o script manda a onda em pedaços que terminam com folga dentro desse prazo.
 *
 * Separado do script para dar para testar sem rede: quem fala com o Worker é a
 * função `chamar`.
 */

/** ~2 min por lote no ritmo observado: longe dos 300 s. */
export const TAMANHO_LOTE = 40;

/*
 * Os mesmos números do Worker (`services/campanhas.ts`). O Worker aplica o
 * corte dentro de cada lote; aqui ele vale para a onda somada, senão 1 falha
 * por lote passaria sempre abaixo da amostra mínima.
 */
const TETO_FALHA = 0.05;
const AMOSTRA_MINIMA = 10;

/** O que o `POST /api/campanha/enviar` devolve (só o que o script usa). */
export type RespostaCampanha = {
  ok?: boolean;
  error?: string;
  enviados?: number;
  falhas?: number;
  parouPorFalha?: boolean;
  enviadosHoje?: number;
  cotaRestante?: number;
  erros?: string[];
};

export type Chamar = (limite: number, dryRun: boolean) => Promise<RespostaCampanha>;

export type MotivoParada =
  | 'completa'
  | 'fila_vazia'
  | 'recusada'
  | 'taxa_de_falha'
  | 'erro_de_rede';

export type ResultadoLotes = {
  motivo: MotivoParada;
  /** Quantos a conferência inicial achou na fila (até o limite pedido). */
  selecionados: number;
  enviados: number;
  falhas: number;
  lotes: number;
  erros: string[];
  /** Mensagem do Worker (recusa) ou da rede (timeout), quando houver. */
  detalhe?: string;
  ultima?: RespostaCampanha;
};

/**
 * Manda `total` em lotes de até `tamanho`.
 *
 * **Antes do primeiro envio, um dry-run com o total inteiro.** É o Worker que
 * recusa onda maior que o dobro da anterior e que passa da cota do dia, e ele
 * só enxerga o `limite` de cada chamada: sem essa conferência, lotes de 40
 * driblariam a trava de onda. O dry-run não grava token nem envio.
 *
 * Erro de rede no meio **para tudo** e não tenta de novo: a chamada pode ter
 * enviado parte do lote antes de cair, e quem sabe quanto é o `campaign_sends`.
 */
export async function enviarEmLotes(
  total: number,
  chamar: Chamar,
  aoTerminarLote: (n: number, r: RespostaCampanha) => void = () => {},
  tamanho = TAMANHO_LOTE,
): Promise<ResultadoLotes> {
  const res: ResultadoLotes = {
    motivo: 'completa',
    selecionados: 0,
    enviados: 0,
    falhas: 0,
    lotes: 0,
    erros: [],
  };

  let conferencia: RespostaCampanha;
  try {
    conferencia = await chamar(total, true);
  } catch (erro) {
    return { ...res, motivo: 'erro_de_rede', detalhe: mensagem(erro) };
  }
  if (conferencia.ok !== true) {
    return { ...res, motivo: 'recusada', detalhe: conferencia.error, ultima: conferencia };
  }

  res.selecionados = Math.min(total, conferencia.enviados ?? 0);
  if (res.selecionados === 0) return { ...res, motivo: 'fila_vazia', ultima: conferencia };

  while (res.enviados + res.falhas < res.selecionados) {
    const lote = Math.min(tamanho, res.selecionados - res.enviados - res.falhas);

    let r: RespostaCampanha;
    try {
      r = await chamar(lote, false);
    } catch (erro) {
      return { ...res, motivo: 'erro_de_rede', detalhe: mensagem(erro) };
    }
    res.ultima = r;
    if (r.ok !== true) return { ...res, motivo: 'recusada', detalhe: r.error };

    res.lotes += 1;
    res.enviados += r.enviados ?? 0;
    res.falhas += r.falhas ?? 0;
    res.erros.push(...(r.erros ?? []));
    aoTerminarLote(res.lotes, r);

    const feitos = res.enviados + res.falhas;
    if (r.parouPorFalha === true || (feitos >= AMOSTRA_MINIMA && res.falhas / feitos > TETO_FALHA)) {
      return { ...res, motivo: 'taxa_de_falha' };
    }
    // Lote que não fez nada: a fila acabou antes do previsto (alguém optou por
    // sair, ou outra chamada levou os mesmos). Insistir seria laço infinito.
    if ((r.enviados ?? 0) + (r.falhas ?? 0) === 0) return { ...res, motivo: 'fila_vazia' };
  }

  return res;
}

function mensagem(erro: unknown): string {
  if (!(erro instanceof Error)) return String(erro);
  const causa = (erro as { cause?: { code?: string } }).cause?.code;
  return causa ? `${erro.message} (${causa})` : erro.message;
}
