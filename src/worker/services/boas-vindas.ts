/**
 * O e-mail de boas-vindas com o link que já entra (CLAUDE.md §8).
 *
 * Sai de dois lugares: da primeira compra pelo postback e da concessão manual
 * do suporte. O texto é o mesmo; muda só o motivo do rodapé (§14).
 */
import { APP_NAME, LINK_ACESSO_DIAS } from '../../shared/constants';
import modeloBoasVindas from '../emails/boas-vindas.md?raw';
import { renderizarEmail } from '../emails/render';
import type { AppBindings } from '../lib/types';
import { criarLinkDeAcesso } from './auth';
import { enviarEmail, type ResultadoEnvio } from './mail';

export async function enviarBoasVindas(
  env: AppBindings['Bindings'],
  d: { userId: string; email: string; nome?: string | null; motivo: string },
): Promise<ResultadoEnvio> {
  const primeiro = d.nome?.trim().split(' ')[0] ?? '';
  // Link que já entra: quem acabou de comprar não digita código nenhum (§8).
  const token = await criarLinkDeAcesso(env.DB, d.userId);
  const corpo = renderizarEmail(
    modeloBoasVindas,
    {
      app: APP_NAME,
      nome: primeiro ? `, ${primeiro}` : '',
      nome_ou_ola: primeiro || 'Olá',
      link_acesso: `${env.APP_URL}/acesso?t=${token}`,
      validade_link: String(LINK_ACESSO_DIAS),
      suporte: env.SUPPORT_EMAIL ?? '',
    },
    { motivo: d.motivo },
  );

  return enviarEmail(
    env,
    'boas_vindas',
    {
      para: d.email,
      assunto: corpo.assunto,
      texto: corpo.texto,
      html: corpo.html,
      ...(env.SUPPORT_EMAIL ? { responderPara: env.SUPPORT_EMAIL } : {}),
    },
    d.userId,
  );
}
