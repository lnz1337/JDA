/**
 * Alerta para o suporte quando um postback **pago** falha no processamento.
 *
 * Pedido pago que não vira acesso é cliente que pagou e ficou de fora. Em 28/10
 * o upsell KY5W52D falhou assim e só apareceu porque alguém foi olhar o
 * `payt_events`; com o alerta, quem avisa é o próprio sistema.
 *
 * **Sem dado pessoal**: vai a transação, os status e o erro. O erro passa por
 * uma limpeza de e-mail e de sequência longa de dígitos (telefone, documento),
 * porque a mensagem é montada a partir do payload e não dá para garantir o que
 * uma mensagem futura vai citar.
 */
import { APP_NAME } from '../../shared/constants';
import type { AppBindings } from '../lib/types';
import type { ResumoPostback } from './payt';
import { enviarEmail } from './mail';

type Ambiente = AppBindings['Bindings'];

const EMAIL = /[^\s@<>()"',;]+@[^\s@<>()"',;]+/g;
const DIGITOS = /\d{8,}/g;

export function erroSemDadoPessoal(erro: string): string {
  return erro.replace(EMAIL, '[e-mail]').replace(DIGITOS, '[número]').slice(0, 500);
}

export function ehPostbackPago(resumo: ResumoPostback): boolean {
  return resumo.status === 'paid' || resumo.paymentStatus === 'paid';
}

export async function alertarPostbackPagoComFalha(
  env: Ambiente,
  resumo: ResumoPostback,
  eventoId: string,
  erro: string,
): Promise<void> {
  const para = env.SUPPORT_EMAIL;
  if (!para) return;

  const transacao = resumo.transactionId ?? '(sem transaction_id)';
  const ambiente = env.ENV ?? 'desconhecido';
  const linhas = [
    `Um postback de venda paga falhou no processamento e o cliente pode estar sem acesso.`,
    '',
    `Transação: ${transacao}`,
    `Status: ${resumo.status ?? '-'} / ${resumo.paymentStatus ?? '-'}`,
    `Evento: ${eventoId}`,
    `Ambiente: ${ambiente}`,
    `Erro: ${erroSemDadoPessoal(erro)}`,
    '',
    'O que fazer:',
    `1. Ver o evento: npm run payt:last:${ambiente === 'production' ? 'production' : 'staging'}`,
    `2. Corrigida a causa, reprocessar: node scripts/payt-reprocess.ts ${transacao} ${ambiente} --confirmo-revisado`,
  ];

  await enviarEmail(env, 'alerta_postback', {
    para,
    assunto: `[${APP_NAME}] Venda paga sem acesso: ${transacao}`,
    texto: linhas.join('\n'),
  });
}
