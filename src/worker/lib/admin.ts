/**
 * Autenticação das rotas administrativas.
 *
 * `ADMIN_API_KEY` é separada da `PAYT_INTEGRATION_KEY` de propósito: a chave da
 * Payt é conhecida por terceiro (a própria Payt a envia em todo postback) e vive
 * no corpo das requisições dela. Usar a mesma coisa para reprocessar evento,
 * disparar campanha e conceder acesso daria a quem tem o segredo do postback o
 * poder de liberar produto e mandar e-mail para a base.
 *
 * Interino: na fase 11 o admin fica atrás do Cloudflare Access (§13).
 */
import { igualdadeSegura } from './cripto';
import { segredo } from './segredos';
import type { AppBindings } from './types';

export function chaveAdminConfere(
  recebida: string | undefined,
  env: AppBindings['Bindings'],
): boolean {
  // Pelo leitor único: a ADMIN_API_KEY de produção foi gravada por pipe, e
  // segredo com BOM não bate com a chave que o script manda no header.
  const chave = segredo(env, 'ADMIN_API_KEY');
  return Boolean(chave) && igualdadeSegura(recebida ?? '', chave);
}
