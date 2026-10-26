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

/** Pede a permissão e assina. Chamar **dentro** do clique. */
export async function ligarLembrete(): Promise<ResultadoLembrete> {
  if (!suportaPush()) return { estado: 'indisponivel' };

  let etapa: EtapaPush = 'permissao';
  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      registrarEvento('push_negado');
      return { estado: 'negado' };
    }

    etapa = 'service_worker';
    const registro = await registroPronto();

    etapa = 'chave';
    const { chave } = await api<{ chave: string }>('/api/push/chave');

    etapa = 'assinar';
    const assinatura =
      (await assinaturaDoRegistro(registro)) ?? (await assinarPush(registro, chave));

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

  let etapa: EtapaPush = 'service_worker';
  try {
    const registro = await registroPronto();

    etapa = 'assinar';
    const existente = await assinaturaDoRegistro(registro);
    if (existente) {
      // Mesmo existindo, reenvia: o banco pode ter perdido a linha (conta nova
      // neste aparelho, por exemplo), e gravar de novo é barato.
      etapa = 'gravar';
      await enviarAssinatura(existente);
      return;
    }

    etapa = 'chave';
    const { chave } = await api<{ chave: string }>('/api/push/chave');

    etapa = 'assinar';
    const nova = await assinarPush(registro, chave);

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
