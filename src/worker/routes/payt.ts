/**
 * POST /api/payt/postback — CLAUDE.md §7.
 *
 * Ordem (importa):
 *   1. lê o corpo cru e tenta entender (JSON ou form)
 *   2. confere a integration_key — sem ela, 401 e nada é gravado
 *   3. GRAVA o payload em payt_events (com a integration_key mascarada),
 *      antes de qualquer validação de conteúdo
 *   4. responde 200 rápido e processa em waitUntil
 *
 * O passo 3 vir antes da validação é de propósito: o formato V1 real ainda não
 * foi visto, e o primeiro postback de verdade precisa ficar inspecionável mesmo
 * que o processamento quebre.
 */
import { Hono } from 'hono';
import { igualdadeSegura, sha256Hex } from '../lib/cripto';
import { agoraIso } from '../lib/datas';
import { novoId } from '../lib/ids';
import type { AppBindings } from '../lib/types';
import { extrairResumo, processarPostback, textoDedupe } from '../services/payt';

/** JSON, ou form-encoded (alguns postbacks mandam assim). Null = ilegível. */
function entender(cru: string, contentType: string): unknown | null {
  const tipo = contentType.toLowerCase();

  if (!tipo.includes('x-www-form-urlencoded')) {
    try {
      return JSON.parse(cru) as unknown;
    } catch {
      // Cai para o form abaixo: content-type errado é mais comum que corpo inválido.
    }
  }

  // Sem '=' não é form-encoded: texto solto não deve virar um objeto de uma chave.
  if (!cru.includes('=')) return null;

  try {
    const params = new URLSearchParams(cru);
    const obj: Record<string, unknown> = {};
    let algum = false;
    for (const [chave, valor] of params) {
      algum = true;
      try {
        obj[chave] = JSON.parse(valor) as unknown;
      } catch {
        obj[chave] = valor;
      }
    }
    return algum ? obj : null;
  } catch {
    return null;
  }
}

async function marcarProcessado(
  db: D1Database,
  id: string,
  erro: string | null,
  precisaRevisao: boolean,
): Promise<void> {
  await db
    .prepare('UPDATE payt_events SET processed_at = ?, error = ?, needs_review = ? WHERE id = ?')
    .bind(agoraIso(), erro, precisaRevisao ? 1 : 0, id)
    .run();
}

/** Confere o segredo no corpo ou no header. Vale para o postback e o reprocesso. */
function chaveConfere(dados: unknown, headerChave: string | undefined, segredo?: string): boolean {
  const noCorpo =
    typeof dados === 'object' && dados !== null
      ? (dados as Record<string, unknown>).integration_key
      : undefined;
  const recebida = typeof noCorpo === 'string' ? noCorpo : (headerChave ?? '');
  return Boolean(segredo) && igualdadeSegura(recebida, segredo ?? '');
}

export const payt = new Hono<AppBindings>().post('/postback', async (c) => {
  const cru = await c.req.text();
  const dados = entender(cru, c.req.header('content-type') ?? '');

  if (dados === null || typeof dados !== 'object') {
    return c.json({ error: 'payload_ilegivel' }, 400);
  }

  if (!chaveConfere(dados, c.req.header('x-integration-key'), c.env.PAYT_INTEGRATION_KEY)) {
    return c.json({ error: 'integration_key_invalida' }, 401);
  }

  // A chave nunca vai para o banco: o payload fica inspecionável, o segredo não
  // fica guardado nem aparece no `npm run payt:last:staging`.
  const paraGravar: Record<string, unknown> = { ...(dados as Record<string, unknown>) };
  if ('integration_key' in paraGravar) paraGravar.integration_key = '***';
  const payloadJson = JSON.stringify(paraGravar);

  const resumo = extrairResumo(dados);
  const dedupeKey = await sha256Hex(textoDedupe(resumo));
  const id = novoId();

  // ON CONFLICT DO NOTHING: postback repetido não vira linha nova (§7 passo 3).
  const gravado = await c.env.DB.prepare(
    `INSERT INTO payt_events
       (id, dedupe_key, transaction_id, status, payment_status, payload_json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (dedupe_key) DO NOTHING`,
  )
    .bind(
      id,
      dedupeKey,
      resumo.transactionId,
      resumo.status,
      resumo.paymentStatus,
      payloadJson,
      agoraIso(),
    )
    .run();

  if ((gravado.meta.changes ?? 0) === 0) {
    return c.json({ ok: true, duplicado: true });
  }

  // test=true em produção: fica gravado para conferência e não roda nada (§7 passo 2).
  if ((dados as Record<string, unknown>).test === true && c.env.ENV === 'production') {
    await marcarProcessado(c.env.DB, id, null, false);
    return c.json({ ok: true, ignorado: 'teste_em_producao' });
  }

  const db = c.env.DB;
  const processar = async () => {
    try {
      const r = await processarPostback(db, dados);
      await marcarProcessado(db, id, null, r.precisaRevisao);
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      console.error('[payt] falha ao processar', id, msg);
      await marcarProcessado(db, id, msg, true);
    }
  };

  // Responde 200 rápido; o processamento segue depois da resposta (§7 passo 4).
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(processar());
  } else {
    await processar();
  }

  return c.json({ ok: true });
});

/**
 * POST /api/payt/reprocess — roda de novo o processamento de um evento já gravado.
 *
 * Existe porque o dedupe (§7 passo 3) impede que a Payt reenvie o mesmo postback:
 * evento que falhou — produto ainda não mapeado, por exemplo — não teria como ser
 * retomado pela origem. É o motor do botão "reprocessar" do admin (§13); quando o
 * admin existir, atrás do Cloudflare Access, esta rota sai daqui.
 *
 * Fora de produção, só: em produção, reprocessar sem revisão humana pode conceder
 * acesso a partir de um payload que já foi recusado por um motivo legítimo.
 */
payt.post('/reprocess', async (c) => {
  const corpo = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!chaveConfere(corpo, c.req.header('x-integration-key'), c.env.PAYT_INTEGRATION_KEY)) {
    return c.json({ error: 'integration_key_invalida' }, 401);
  }

  if (c.env.ENV === 'production') {
    return c.json({ error: 'reprocesso_indisponivel_em_producao' }, 403);
  }

  const transactionId = typeof corpo?.transaction_id === 'string' ? corpo.transaction_id : null;
  const id = typeof corpo?.id === 'string' ? corpo.id : null;
  if (!transactionId && !id) {
    return c.json({ error: 'informe id ou transaction_id' }, 400);
  }

  const evento = await c.env.DB.prepare(
    `SELECT id, payload_json FROM payt_events
      WHERE ${id ? 'id = ?' : 'transaction_id = ?'}
      ORDER BY received_at DESC LIMIT 1`,
  )
    .bind(id ?? transactionId)
    .first<{ id: string; payload_json: string }>();

  if (!evento) {
    return c.json({ error: 'evento_nao_encontrado' }, 404);
  }

  let dados: unknown;
  try {
    dados = JSON.parse(evento.payload_json);
  } catch {
    return c.json({ error: 'payload_gravado_nao_e_json' }, 422);
  }

  try {
    const r = await processarPostback(c.env.DB, dados);
    await marcarProcessado(c.env.DB, evento.id, null, r.precisaRevisao);
    return c.json({ ok: true, id: evento.id, ...r });
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    await marcarProcessado(c.env.DB, evento.id, msg, true);
    return c.json({ ok: false, id: evento.id, error: msg }, 200);
  }
});
