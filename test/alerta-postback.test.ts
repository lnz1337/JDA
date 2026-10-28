import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import pedidoPago from '../fixtures/payt/pedido-pago.json';
import reembolso from '../fixtures/payt/reembolso.json';
import app from '../src/worker/index';
import { erroSemDadoPessoal } from '../src/worker/services/alerta-postback';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

/**
 * Venda paga que falha no processamento avisa o suporte (28/10). O upsell
 * KY5W52D ficou sem acesso e só apareceu porque alguém foi olhar o payt_events.
 */
async function postar(payload: object): Promise<void> {
  const ctx = createExecutionContext();
  await app.request(
    'https://exemplo.test/api/payt/postback',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, integration_key: envTeste.PAYT_INTEGRATION_KEY }),
    },
    envTeste,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

async function alertas(): Promise<Array<{ props_json: string }>> {
  const { results } = await env.DB.prepare(
    "SELECT props_json FROM events WHERE name LIKE 'email_%' AND json_extract(props_json, '$.tipo') = 'alerta_postback'",
  ).all<{ props_json: string }>();
  return results;
}

beforeEach(async () => {
  await prepararBanco();
  await env.DB.prepare(
    "INSERT INTO product_payt_map (payt_code, product_id) VALUES ('LJ7KEP', 'jornada-meu-anjo')",
  ).run();
});

describe('alerta de venda paga sem acesso', () => {
  it('pedido pago que falha manda alerta ao suporte', async () => {
    await postar({ ...pedidoPago, product: { name: 'Produto sem sku nem code' } });
    expect(await alertas()).toHaveLength(1);
  });

  it('pedido pago que dá certo não alerta', async () => {
    await postar(pedidoPago);
    expect(await alertas()).toHaveLength(0);
  });

  it('falha fora de venda paga não alerta', async () => {
    // Reembolso sem transaction_id falha, mas não deixa ninguém sem acesso pago.
    const { transaction_id: _t, ...semTransacao } = reembolso as Record<string, unknown>;
    await postar({ ...semTransacao, transaction: { payment_status: 'refunded' } });
    expect(await alertas()).toHaveLength(0);
  });
});

describe('erro sem dado pessoal', () => {
  it('tira e-mail e sequência longa de dígitos', () => {
    expect(erroSemDadoPessoal('cliente maria@exemplo.com.br, telefone 11987654321, doc 12345678901')).toBe(
      'cliente [e-mail], telefone [número], doc [número]',
    );
  });

  it('mantém código de transação e de produto', () => {
    expect(erroSemDadoPessoal('nenhum produto do pedido existe no catálogo: LPG38N')).toContain('LPG38N');
  });

  it('corta mensagem longa', () => {
    expect(erroSemDadoPessoal('x'.repeat(2000))).toHaveLength(500);
  });
});
