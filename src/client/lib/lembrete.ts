/**
 * Ligar e manter o lembrete deste aparelho (CLAUDE.md §11).
 *
 * A permissão é pedida **só no toque do botão**, nunca ao abrir a tela: negada
 * no impulso, ela não volta mais — o navegador não pergunta de novo, e a pessoa
 * teria que achar o ajuste no sistema.
 */
import { api, registrarEvento } from './api';
import {
  assinarPush,
  assinaturaAtual,
  assinaturaParaEnviar,
  permissaoDeNotificacao,
  suportaPush,
} from './dispositivo';

export type ResultadoLembrete = 'ligado' | 'negado' | 'indisponivel' | 'erro';

async function enviarAssinatura(assinatura: PushSubscription): Promise<void> {
  await api('/api/push/assinatura', {
    method: 'POST',
    body: JSON.stringify(assinaturaParaEnviar(assinatura)),
  });
}

/** Pede a permissão e assina. Chamar **dentro** do clique. */
export async function ligarLembrete(): Promise<ResultadoLembrete> {
  if (!suportaPush()) return 'indisponivel';

  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      registrarEvento('push_negado');
      return 'negado';
    }

    const { chave } = await api<{ chave: string }>('/api/push/chave');
    const assinatura = (await assinaturaAtual()) ?? (await assinarPush(chave));
    await enviarAssinatura(assinatura);

    registrarEvento('push_ativado');
    return 'ligado';
  } catch {
    return 'erro';
  }
}

/**
 * Permissão já concedida mas sem assinatura neste aparelho — reinstalou, limpou
 * os dados do site, ou o navegador expirou a assinatura. Refaz em silêncio: a
 * pessoa já disse sim uma vez, e perguntar de novo seria só atrito.
 */
export async function garantirAssinatura(): Promise<void> {
  if (!suportaPush() || permissaoDeNotificacao() !== 'granted') return;

  try {
    const existente = await assinaturaAtual();
    if (existente) {
      // Mesmo existindo, reenvia: o banco pode ter perdido a linha (conta nova
      // neste aparelho, por exemplo), e gravar de novo é barato.
      await enviarAssinatura(existente);
      return;
    }

    const { chave } = await api<{ chave: string }>('/api/push/chave');
    await enviarAssinatura(await assinarPush(chave));
  } catch {
    /* sem rede ou sem chave: tenta de novo na próxima abertura */
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
