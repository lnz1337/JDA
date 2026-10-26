/**
 * Ligar e manter o lembrete deste aparelho (CLAUDE.md §11).
 *
 * A permissão é pedida **só no toque do botão**, nunca ao abrir a tela: negada
 * no impulso, ela não volta mais — o navegador não pergunta de novo, e a pessoa
 * teria que achar o ajuste no sistema.
 *
 * Cada passo é marcado numa variável antes de rodar, e o `catch` relata **qual**
 * deles falhou. Antes o erro virava só "não consegui ligar o lembrete agora", e
 * no iPhone isso não dava para investigar: não há como abrir o inspetor do
 * Safari sem um Mac.
 */
import { api, registrarEvento } from './api';
import { descreverErro, type EtapaPush, type FalhaPush } from './diagnostico';
import {
  assinarPush,
  assinaturaDoRegistro,
  assinaturaParaEnviar,
  permissaoDeNotificacao,
  registroPronto,
  suportaPush,
} from './dispositivo';
import { comLimite } from './limite';

export type ResultadoLembrete =
  | { estado: 'ligado' }
  | { estado: 'negado' }
  | { estado: 'indisponivel' }
  | { estado: 'erro'; falha: FalhaPush };

async function enviarAssinatura(assinatura: PushSubscription): Promise<void> {
  await api('/api/push/assinatura', {
    method: 'POST',
    body: JSON.stringify(assinaturaParaEnviar(assinatura)),
  });
}

/** Grava a falha no funil e devolve o que a tela mostra em staging. */
function relatar(etapa: EtapaPush, e: unknown): FalhaPush {
  const falha: FalhaPush = { etapa, ...descreverErro(e) };
  registrarEvento('push_erro_cliente', falha);
  return falha;
}

/**
 * O que o `subscribe` precisa, carregado **antes** do toque.
 *
 * No Safari do iPhone a assinatura pode ter de nascer ainda dentro do gesto, e
 * buscar a chave entre o `requestPermission` e o `subscribe` gasta esse gesto.
 * Então service worker, assinatura existente e chave vêm na abertura da tela.
 */
export interface PreparoPush {
  registro: ServiceWorkerRegistration;
  chave: string;
  /** Assinatura que este aparelho já tem, se houver. */
  existente: PushSubscription | null;
}

/**
 * Oito segundos por passo. É folgado para celular antigo em rede ruim e curto o
 * bastante para a tela não ficar presa num `serviceWorker.ready` que não volta.
 */
const LIMITE_MS = 8_000;

/**
 * Carrega o preparo. **Nunca rejeita**: devolve `null` e relata a falha, porque
 * quem chama é o `useEffect` da tela, que não tem onde tratar exceção.
 */
export async function prepararLembrete(limiteMs = LIMITE_MS): Promise<PreparoPush | null> {
  if (!suportaPush()) return null;

  let etapa: EtapaPush = 'service_worker';
  try {
    const registro = await comLimite(registroPronto(), limiteMs, etapa);

    etapa = 'assinar';
    const existente = await comLimite(assinaturaDoRegistro(registro), limiteMs, etapa);

    etapa = 'chave';
    const { chave } = await comLimite(
      api<{ chave: string }>('/api/push/chave'),
      limiteMs,
      etapa,
    );

    return { registro, chave, existente };
  } catch (e) {
    relatar(etapa, e);
    return null;
  }
}

/**
 * Pede a permissão e assina. Chamar **dentro** do clique.
 *
 * Recebe o preparo como **promessa**, não como valor: quando a pessoa toca, o
 * preparo da abertura normalmente já terminou — e esperar uma promessa que já
 * resolveu custa um microtask, não uma ida à rede. Entre a permissão e o
 * `subscribe` não há nenhuma chamada nova.
 */
export async function ligarLembrete(
  preparo: Promise<PreparoPush | null>,
): Promise<ResultadoLembrete> {
  if (!suportaPush()) return { estado: 'indisponivel' };

  let etapa: EtapaPush = 'permissao';
  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      registrarEvento('push_negado');
      return { estado: 'negado' };
    }

    const pronto = await preparo;
    if (!pronto) {
      // O preparo falhou e já se relatou. Insistir aqui seria repetir o passo
      // que acabou de falhar, agora sem o gesto para gastar.
      return { estado: 'erro', falha: { etapa: 'chave', erro: 'TempoEsgotado: preparo' } };
    }

    etapa = 'assinar';
    const assinatura = pronto.existente ?? (await assinarPush(pronto.registro, pronto.chave));

    etapa = 'gravar';
    await enviarAssinatura(assinatura);

    registrarEvento('push_ativado');
    return { estado: 'ligado' };
  } catch (e) {
    return { estado: 'erro', falha: relatar(etapa, e) };
  }
}

/**
 * Permissão já concedida mas sem assinatura neste aparelho — reinstalou, limpou
 * os dados do site, ou o navegador expirou a assinatura. Refaz em silêncio: a
 * pessoa já disse sim uma vez, e perguntar de novo seria só atrito.
 *
 * Silêncio para a pessoa, não para o funil: a falha vira `push_erro_cliente`,
 * senão um aparelho que nunca consegue assinar fica invisível.
 */
export async function garantirAssinatura(): Promise<void> {
  if (!suportaPush() || permissaoDeNotificacao() !== 'granted') return;

  const pronto = await prepararLembrete();
  if (!pronto) return;

  let etapa: EtapaPush = 'gravar';
  try {
    if (pronto.existente) {
      // Mesmo existindo, reenvia: o banco pode ter perdido a linha (conta nova
      // neste aparelho, por exemplo), e gravar de novo é barato.
      await enviarAssinatura(pronto.existente);
      return;
    }

    etapa = 'assinar';
    const nova = await assinarPush(pronto.registro, pronto.chave);

    etapa = 'gravar';
    await enviarAssinatura(nova);
  } catch (e) {
    relatar(etapa, e);
  }
}

export async function salvarHorario(hora: number, timezone: string): Promise<void> {
  await api('/api/me/lembrete', {
    method: 'PATCH',
    body: JSON.stringify({ prayer_hour: hora, timezone }),
  });
}

/** O fuso que este aparelho está usando agora. */
export function fusoDoAparelho(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}
