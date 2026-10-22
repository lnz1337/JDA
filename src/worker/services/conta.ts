/**
 * Operações da própria conta: excluir e trocar o e-mail (CLAUDE.md §14).
 *
 * As duas pedem código mesmo com sessão aberta — a autorização fica em
 * `services/auth.ts`; aqui é só o efeito no banco.
 */
import { agoraIso } from '../lib/datas';
import { novoId } from '../lib/ids';
import { normalizarEmail } from './auth';

async function registrar(
  db: D1Database,
  userId: string,
  nome: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO events (id, user_id, name, props_json, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(novoId(), userId, nome, JSON.stringify(props), agoraIso())
    .run();
}

/**
 * Anonimiza, não apaga: `entitlements`, `payt_events` e o histórico de compra
 * precisam continuar existindo para conferência contábil e para o caso de a
 * pessoa voltar. O que sai é o dado pessoal.
 */
export async function excluirConta(db: D1Database, userId: string): Promise<void> {
  const agora = agoraIso();

  await db.batch([
    db
      .prepare(
        `UPDATE users
            SET deleted_at = ?, email = NULL, phone = NULL, name = NULL,
                payt_customer_code = NULL, marketing_opt_out_at = ?
          WHERE id = ?`,
      )
      .bind(agora, agora, userId),
    // As intenções já publicadas somem do mural, sem apagar o contador de quem rezou.
    db.prepare("UPDATE intentions SET status = 'hidden' WHERE user_id = ?").bind(userId),
    // Sessão e push não sobrevivem à conta: nada que continue falando com o aparelho.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM login_codes WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM access_links WHERE user_id = ?').bind(userId),
  ]);

  // Prefixo `conta_`: `email_*` em events é do log de envio (services/mail.ts),
  // e um evento de conta ali dentro sujaria a contagem de e-mail enviado.
  await registrar(db, userId, 'conta_excluida');
}

export type ResultadoTroca = { ok: true } | { ok: false; motivo: 'email_em_uso' };

export async function trocarEmail(
  db: D1Database,
  userId: string,
  novoEmail: string,
): Promise<ResultadoTroca> {
  const email = normalizarEmail(novoEmail);

  const ocupado = await db
    .prepare('SELECT id FROM users WHERE email = ? AND id <> ? AND deleted_at IS NULL')
    .bind(email, userId)
    .first<{ id: string }>();

  if (ocupado) return { ok: false, motivo: 'email_em_uso' };

  await db.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, userId).run();
  // Sem o endereço, nem antigo nem novo: o evento é para auditoria, não cadastro.
  await registrar(db, userId, 'conta_email_trocado');

  return { ok: true };
}
