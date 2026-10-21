import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assinaturaValida,
  concederEntitlement,
  hasAccess,
  revogarPorTransacao,
} from '../src/worker/services/entitlements';
import { prepararBanco } from './ajuda';

const USUARIO = 'usuario-de-teste';

async function criarUsuario(): Promise<void> {
  await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
    .bind(USUARIO, 'teste@exemplo.com.br', new Date().toISOString())
    .run();
}

beforeEach(async () => {
  await prepararBanco();
  await criarUsuario();
});

describe('hasAccess', () => {
  it('nega quem não comprou', async () => {
    expect(await hasAccess(env.DB, USUARIO, 'jornada-meu-anjo')).toBe(false);
  });

  it('libera com entitlement do próprio produto', async () => {
    await concederEntitlement(env.DB, {
      userId: USUARIO,
      productId: 'jornada-meu-anjo',
      source: 'payt',
      transactionId: 'TRX-1',
    });

    expect(await hasAccess(env.DB, USUARIO, 'jornada-meu-anjo')).toBe(true);
  });

  it('libera o item pelo bundle que o contém', async () => {
    await concederEntitlement(env.DB, {
      userId: USUARIO,
      productId: 'oracao-sao-miguel',
      source: 'payt',
      transactionId: 'TRX-2',
    });

    expect(await hasAccess(env.DB, USUARIO, 'oracao-gargano')).toBe(true);
    expect(await hasAccess(env.DB, USUARIO, 'manual-purificacao')).toBe(true);
    // Item de outro bundle continua bloqueado.
    expect(await hasAccess(env.DB, USUARIO, 'jornada-cura')).toBe(false);
  });

  it('libera conteúdo do Círculo com assinatura válida', async () => {
    await env.DB.prepare(
      "UPDATE products SET requires_subscription = 1 WHERE id = 'limpeza-anjos'",
    ).run();

    expect(await hasAccess(env.DB, USUARIO, 'limpeza-anjos')).toBe(false);

    await env.DB.prepare(
      `INSERT INTO subscriptions (code, user_id, plan, status, next_charge_at, updated_at)
       VALUES ('SUB-1', ?, 'mensal', 'active', '2099-01-01T00:00:00Z', ?)`,
    )
      .bind(USUARIO, new Date().toISOString())
      .run();

    expect(await hasAccess(env.DB, USUARIO, 'limpeza-anjos')).toBe(true);
  });

  it('não libera produto fora do Círculo só por ter assinatura', async () => {
    await env.DB.prepare(
      `INSERT INTO subscriptions (code, user_id, plan, status, next_charge_at, updated_at)
       VALUES ('SUB-1', ?, 'mensal', 'active', '2099-01-01T00:00:00Z', ?)`,
    )
      .bind(USUARIO, new Date().toISOString())
      .run();

    expect(await hasAccess(env.DB, USUARIO, 'jornada-meu-anjo')).toBe(false);
  });

  it('para de liberar depois da revogação', async () => {
    await concederEntitlement(env.DB, {
      userId: USUARIO,
      productId: 'jornada-meu-anjo',
      source: 'payt',
      transactionId: 'TRX-3',
    });

    expect(await revogarPorTransacao(env.DB, 'TRX-3')).toBe(1);
    expect(await hasAccess(env.DB, USUARIO, 'jornada-meu-anjo')).toBe(false);
  });

  it('concede duas vezes sem duplicar linha', async () => {
    const params = {
      userId: USUARIO,
      productId: 'jornada-meu-anjo',
      source: 'payt' as const,
      transactionId: 'TRX-4',
    };
    await concederEntitlement(env.DB, params);
    await concederEntitlement(env.DB, params);

    const { results } = await env.DB.prepare(
      'SELECT id FROM entitlements WHERE transaction_id = ?',
    )
      .bind('TRX-4')
      .all();
    expect(results).toHaveLength(1);
  });

  it('recompra depois de reembolso devolve o acesso', async () => {
    const params = {
      userId: USUARIO,
      productId: 'jornada-meu-anjo',
      source: 'payt' as const,
      transactionId: 'TRX-5',
    };
    await concederEntitlement(env.DB, params);
    await revogarPorTransacao(env.DB, 'TRX-5');
    await concederEntitlement(env.DB, params);

    expect(await hasAccess(env.DB, USUARIO, 'jornada-meu-anjo')).toBe(true);
  });
});

describe('assinaturaValida', () => {
  const agora = '2026-10-21T12:00:00Z';

  it('vale em active e pending', () => {
    expect(assinaturaValida({ status: 'active', next_charge_at: null }, agora)).toBe(true);
    expect(assinaturaValida({ status: 'pending', next_charge_at: null }, agora)).toBe(true);
  });

  it('em atraso, vale por 3 dias depois do vencimento', () => {
    const dentro = { status: 'overdue', next_charge_at: '2026-10-19T12:00:00Z' }; // +2 dias
    const fora = { status: 'overdue', next_charge_at: '2026-10-17T11:00:00Z' }; // +4 dias

    expect(assinaturaValida(dentro, agora)).toBe(true);
    expect(assinaturaValida(fora, agora)).toBe(false);
  });

  it('cancelada vale até o fim do período já pago', () => {
    expect(
      assinaturaValida({ status: 'canceled_by_customer', next_charge_at: '2026-11-01T00:00:00Z' }, agora),
    ).toBe(true);
    expect(
      assinaturaValida({ status: 'canceled_by_customer', next_charge_at: '2026-10-01T00:00:00Z' }, agora),
    ).toBe(false);
  });

  it('sem assinatura, não vale', () => {
    expect(assinaturaValida(null, agora)).toBe(false);
  });

  it('status desconhecido não vale', () => {
    expect(assinaturaValida({ status: 'whatever', next_charge_at: '2099-01-01T00:00:00Z' }, agora)).toBe(
      false,
    );
  });
});
