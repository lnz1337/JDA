import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import aguardandoPagamento from '../fixtures/payt/aguardando-pagamento.json';
import assinaturaAnual from '../fixtures/payt/assinatura-anual-ativada.json';
import assinaturaAtivada from '../fixtures/payt/assinatura-ativada.json';
import assinaturaAtrasada from '../fixtures/payt/assinatura-atrasada.json';
import assinaturaCancelada from '../fixtures/payt/assinatura-cancelada.json';
import assinaturaRenovada from '../fixtures/payt/assinatura-renovada.json';
import carrinhoAbandonado from '../fixtures/payt/real-carrinho-abandonado.json';
import chargeback from '../fixtures/payt/chargeback.json';
import chaveInvalida from '../fixtures/payt/chave-invalida.json';
import fakeEmail from '../fixtures/payt/fake-email.json';
import pedidoComBump from '../fixtures/payt/pedido-com-order-bump.json';
import pedidoPago from '../fixtures/payt/pedido-pago.json';
import pedidoSkuDesconhecido from '../fixtures/payt/pedido-sku-desconhecido.json';
import realPedidoPago from '../fixtures/payt/real-pedido-pago.json';
import reembolso from '../fixtures/payt/reembolso.json';
import reembolsoParcial from '../fixtures/payt/reembolso-parcial.json';
import upsellAgrupado from '../fixtures/payt/upsell-bundle-agrupado.json';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

const URL_POSTBACK = 'https://exemplo.test/api/payt/postback';

/**
 * As fixtures reais têm a integration_key mascarada (é assim que ela é gravada).
 * Para postá-las, o teste repõe a chave sintética do ambiente de teste.
 */
function comChave<T extends object>(fixture: T): T & { integration_key: string } {
  return { ...fixture, integration_key: envTeste.PAYT_INTEGRATION_KEY ?? '' };
}

/** Posta o payload e espera o processamento do waitUntil terminar. */
async function postar(
  payload: unknown,
  opcoes: { env?: Record<string, unknown>; corpoCru?: string; contentType?: string } = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request(
    URL_POSTBACK,
    {
      method: 'POST',
      headers: { 'content-type': opcoes.contentType ?? 'application/json' },
      body: opcoes.corpoCru ?? JSON.stringify(payload),
    },
    { ...envTeste, ...opcoes.env },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function evento(transactionId: string) {
  return env.DB.prepare(
    'SELECT id, status, payment_status, error, needs_review, processed_at, payload_json FROM payt_events WHERE transaction_id = ?',
  )
    .bind(transactionId)
    .first<{
      id: string;
      status: string;
      payment_status: string;
      error: string | null;
      needs_review: number;
      processed_at: string | null;
      payload_json: string;
    }>();
}

async function entitlementsDe(email: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.product_id
       FROM entitlements e JOIN users u ON u.id = e.user_id
      WHERE u.email = ? AND e.status = 'active'
      ORDER BY e.product_id`,
  )
    .bind(email)
    .all<{ product_id: string }>();
  return results.map((r) => r.product_id);
}

beforeEach(async () => {
  await prepararBanco();
  // A Payt gera o sku, então todo produto nosso resolve pelo code. Este é o mesmo
  // mapeamento que existe no staging para o produto de teste.
  await env.DB.prepare(
    "INSERT INTO product_payt_map (payt_code, product_id) VALUES ('LJ7KEP', 'jornada-meu-anjo')",
  ).run();
});

describe('autenticação do postback', () => {
  it('recusa integration_key errada e não grava nada', async () => {
    const res = await postar(chaveInvalida);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'integration_key_invalida' });

    const { results } = await env.DB.prepare('SELECT id FROM payt_events').all();
    expect(results).toHaveLength(0);
  });

  it('recusa quando o secret não está cadastrado', async () => {
    const res = await postar(comChave(pedidoPago), { env: { PAYT_INTEGRATION_KEY: undefined } });

    expect(res.status).toBe(401);
  });

  it('recusa corpo ilegível', async () => {
    const res = await postar(null, { corpoCru: 'isto não é json nem form' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'payload_ilegivel' });
  });

  it('aceita a chave pelo header, se não vier no corpo', async () => {
    const { integration_key: _, ...semChave } = pedidoPago;
    const ctx = createExecutionContext();
    const res = await app.request(
      URL_POSTBACK,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-integration-key': envTeste.PAYT_INTEGRATION_KEY ?? '',
        },
        body: JSON.stringify(semChave),
      },
      envTeste,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
  });
});

describe('gravação do payload', () => {
  it('grava o payload cru antes de validar o conteúdo', async () => {
    // Autenticado, mas sem nada que o processamento reconheça.
    const estranho = { integration_key: envTeste.PAYT_INTEGRATION_KEY, formato: 'inesperado' };
    const res = await postar(estranho);

    expect(res.status).toBe(200);

    const linha = await env.DB.prepare(
      'SELECT payload_json, error, needs_review FROM payt_events',
    ).first<{ payload_json: string; error: string | null; needs_review: number }>();

    expect(JSON.parse(linha?.payload_json ?? '{}')).toEqual({ ...estranho, integration_key: '***' });
    // Status que ninguém previu fica marcado para revisão, não some na fila.
    expect(linha?.needs_review).toBe(1);
  });

  it('grava dois payloads ilegíveis diferentes sem tratar o segundo como duplicado', async () => {
    const semTransacao = { integration_key: envTeste.PAYT_INTEGRATION_KEY, a: 1 };
    await postar(semTransacao);
    await postar(semTransacao);

    const { results } = await env.DB.prepare('SELECT id FROM payt_events').all();
    expect(results).toHaveLength(2);
  });

  it('trata postback repetido como duplicado', async () => {
    const primeira = await postar(comChave(pedidoPago));
    const segunda = await postar(comChave(pedidoPago));

    expect(await primeira.json()).toEqual({ ok: true });
    expect(await segunda.json()).toEqual({ ok: true, duplicado: true });

    const { results } = await env.DB.prepare('SELECT id FROM payt_events').all();
    expect(results).toHaveLength(1);
  });

  it('ignora test=true quando ENV=production, mas grava', async () => {
    const res = await postar(comChave({ ...pedidoPago, test: true }), { env: { ENV: 'production' } });

    expect(await res.json()).toEqual({ ok: true, ignorado: 'teste_em_producao' });

    const linha = await evento('X9P8DY5');
    expect(linha?.processed_at).toBeTruthy();
    expect(linha?.error).toBeNull();
    expect(await entitlementsDe('cliente.exemplo@exemplo.com.br')).toEqual([]);
  });
});

describe('integration_key não é guardada', () => {
  it('grava a chave mascarada no payload', async () => {
    await postar(comChave(pedidoPago));

    const linha = await env.DB.prepare('SELECT payload_json FROM payt_events').first<{
      payload_json: string;
    }>();
    const guardado = JSON.parse(linha?.payload_json ?? '{}') as Record<string, unknown>;

    expect(guardado.integration_key).toBe('***');
    expect(linha?.payload_json).not.toContain(envTeste.PAYT_INTEGRATION_KEY ?? 'nunca');
    // O resto do payload continua inteiro, que é o ponto de guardar.
    expect(guardado.status).toBe('paid');
  });
});

describe('postback real da Payt', () => {
  it('extrai transação, status e os 5 produtos do formato real', async () => {
    await postar(comChave(realPedidoPago));

    const linha = await evento('PAYTS2');
    expect(linha?.status).toBe('paid');
    expect(linha?.payment_status).toBe('paid');
    // Os produtos são os fictícios da Payt: não resolvem, então pede revisão.
    expect(linha?.needs_review).toBe(1);
    expect(linha?.error).toMatch(/793269e47eb75/);
  });

  it('resolve os produtos do formato real pelo product_payt_map', async () => {
    // A Payt gera o sku (hash), então o caminho de verdade é o code.
    await env.DB.prepare(
      "INSERT INTO product_payt_map (payt_code, product_id) VALUES ('4O9J39', 'jornada-meu-anjo')",
    ).run();

    await postar(comChave(realPedidoPago));

    const { results } = await env.DB.prepare(
      "SELECT product_id FROM entitlements WHERE status = 'active'",
    ).all<{ product_id: string }>();
    expect(results.map((r) => r.product_id)).toEqual(['jornada-meu-anjo']);

    const linha = await evento('PAYTS2');
    // Concedeu o que deu, e o que não resolveu ficou marcado para revisão.
    expect(linha?.error).toBeNull();
    expect(linha?.needs_review).toBe(1);
  });
});

describe('compra paga', () => {
  it('cria o usuário e concede o produto do pedido', async () => {
    await postar(comChave(pedidoPago));

    expect(await entitlementsDe('cliente.exemplo@exemplo.com.br')).toEqual(['jornada-meu-anjo']);

    const linha = await evento('X9P8DY5');
    expect(linha?.error).toBeNull();
    expect(linha?.needs_review).toBe(0);

    const usuario = await env.DB.prepare('SELECT name, phone FROM users WHERE email = ?')
      .bind('cliente.exemplo@exemplo.com.br')
      .first<{ name: string; phone: string }>();
    expect(usuario?.name).toBe('Cliente de Exemplo');
    expect(usuario?.phone).toBe('11900000000'); // só dígitos

    const registro = await env.DB.prepare(
      "SELECT name FROM events WHERE name = 'user_created_payt'",
    ).first<{ name: string }>();
    expect(registro?.name).toBe('user_created_payt');
  });

  it('concede também o order bump', async () => {
    await postar(pedidoComBump);

    expect(await entitlementsDe('joao.pereira@exemplo.com.br')).toEqual([
      'circulo-mensal',
      'jornada-meu-anjo',
    ]);
  });

  it('concede o bundle e cada item agrupado', async () => {
    await postar(upsellAgrupado);

    expect(await entitlementsDe('maria.souza@exemplo.com.br')).toEqual([
      'manual-purificacao',
      'mapa-prosperidade',
      'oracao-gargano',
      'oracao-sao-miguel',
    ]);
  });

  it('resolve pelo product_payt_map quando o sku não existe', async () => {
    await env.DB.prepare(
      "INSERT INTO product_payt_map (payt_code, product_id) VALUES ('PAYT-UP2', 'jornada-cura-padre-pio')",
    ).run();

    await postar(pedidoSkuDesconhecido);

    expect(await entitlementsDe('maria.souza@exemplo.com.br')).toEqual(['jornada-cura-padre-pio']);
  });

  it('marca para revisão quando nenhum produto resolve', async () => {
    await postar(pedidoSkuDesconhecido); // sem a linha no product_payt_map

    const linha = await evento('TRX-1004');
    expect(linha?.error).toMatch(/nenhum produto do pedido existe no catálogo/);
    expect(linha?.needs_review).toBe(1);
  });

  it('não duplica entitlement quando o mesmo pedido é reprocessado', async () => {
    await postar(comChave(pedidoPago));
    // Mesmo payload com updated_at diferente: passa pelo dedupe e processa de novo.
    await postar(comChave({ ...pedidoPago, updated_at: '2026-10-21 20:45:00.000000' }));

    const { results } = await env.DB.prepare(
      "SELECT id FROM entitlements WHERE product_id = 'jornada-meu-anjo'",
    ).all();
    expect(results).toHaveLength(1);
  });

  it('identifica pelo telefone quando o e-mail é falso', async () => {
    await postar(fakeEmail);

    const usuario = await env.DB.prepare('SELECT id, email, phone FROM users WHERE phone = ?')
      .bind('5511977776666')
      .first<{ id: string; email: string | null; phone: string }>();

    expect(usuario?.email).toBeNull();

    const { results } = await env.DB.prepare(
      "SELECT product_id FROM entitlements WHERE user_id = ? AND status = 'active'",
    )
      .bind(usuario?.id)
      .all<{ product_id: string }>();
    expect(results.map((r) => r.product_id)).toEqual(['jornada-meu-anjo']);
  });
});

describe('reembolso e chargeback', () => {
  it('revoga os entitlements da transação reembolsada', async () => {
    await postar(comChave(pedidoPago));
    expect(await entitlementsDe('cliente.exemplo@exemplo.com.br')).toEqual(['jornada-meu-anjo']);

    await postar(reembolso);

    expect(await entitlementsDe('cliente.exemplo@exemplo.com.br')).toEqual([]);
    const revogado = await env.DB.prepare(
      "SELECT status, revoked_at FROM entitlements WHERE transaction_id = 'X9P8DY5'",
    ).first<{ status: string; revoked_at: string }>();
    expect(revogado?.status).toBe('revoked');
    expect(revogado?.revoked_at).toBeTruthy();
  });

  it('revoga no chargeback', async () => {
    await postar(pedidoComBump);
    await postar(chargeback);

    expect(await entitlementsDe('joao.pereira@exemplo.com.br')).toEqual([]);
  });

  it('reembolso parcial não revoga e vai para a fila de revisão', async () => {
    await postar(comChave(pedidoPago));
    await postar(reembolsoParcial);

    expect(await entitlementsDe('cliente.exemplo@exemplo.com.br')).toEqual(['jornada-meu-anjo']);

    const linha = await env.DB.prepare(
      "SELECT needs_review, error FROM payt_events WHERE payment_status = 'refunded_partial'",
    ).first<{ needs_review: number; error: string | null }>();
    expect(linha?.needs_review).toBe(1);
    expect(linha?.error).toBeNull(); // é revisão, não erro
  });
});

describe('assinatura', () => {
  async function assinatura(code: string) {
    return env.DB.prepare(
      'SELECT plan, status, next_charge_at, started_at FROM subscriptions WHERE code = ?',
    )
      .bind(code)
      .first<{ plan: string; status: string; next_charge_at: string; started_at: string }>();
  }

  it('grava na ativação', async () => {
    await postar(assinaturaAtivada);

    expect(await assinatura('SUB-5001')).toMatchObject({
      plan: 'mensal',
      status: 'active',
      // A Payt mandou "2026-11-21 15:00:00.000000" em horário de Brasília.
      next_charge_at: '2026-11-21T18:00:00.000Z',
    });
  });

  it('traduz periodicity 1 year para anual', async () => {
    await postar(assinaturaAnual);

    expect((await assinatura('SUB-5002'))?.plan).toBe('anual');
  });

  it('renovação atualiza a mesma linha', async () => {
    await postar(assinaturaAtivada);
    await postar(assinaturaRenovada);

    const { results } = await env.DB.prepare('SELECT code FROM subscriptions').all();
    expect(results).toHaveLength(1);
  });

  it('atraso vira status overdue', async () => {
    await postar(assinaturaAtivada);
    await postar(assinaturaAtrasada);

    expect((await assinatura('SUB-5001'))?.status).toBe('overdue');
  });

  it('cancelamento espelha o status da Payt', async () => {
    await postar(assinaturaAtivada);
    await postar(assinaturaCancelada);

    expect((await assinatura('SUB-5001'))?.status).toBe('canceled_by_customer');
  });

  it('next_charge_at só com data vira o fim do dia em Brasília', async () => {
    await postar(assinaturaCancelada);

    // "2026-11-21" -> 23:59:59 -03:00; o assinante fica com o dia 21 inteiro.
    expect((await assinatura('SUB-5001'))?.next_charge_at).toBe('2026-11-22T02:59:59.000Z');
  });
});

describe('eventos que só são registrados', () => {
  it('aguardando pagamento não concede nada', async () => {
    await postar(aguardandoPagamento);

    expect(await entitlementsDe('maria.souza@exemplo.com.br')).toEqual([]);
    const linha = await evento('TRX-4001');
    expect(linha?.error).toBeNull();
    expect(linha?.needs_review).toBe(0);
  });

  it('carrinho abandonado real não concede nada e não dá erro', async () => {
    await postar(comChave(carrinhoAbandonado));

    const linha = await env.DB.prepare(
      "SELECT error, needs_review, transaction_id FROM payt_events WHERE status = 'lost_cart'",
    ).first<{ error: string | null; needs_review: number; transaction_id: string | null }>();

    expect(linha?.error).toBeNull();
    expect(linha?.needs_review).toBe(0);
    // lost_cart vem sem transaction_id: o dedupe cai no ULID, e grava mesmo assim.
    expect(linha?.transaction_id).toBeNull();

    const { results } = await env.DB.prepare('SELECT id FROM entitlements').all();
    expect(results).toHaveLength(0);
  });
});
