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
import { chaveAdminConfere } from '../lib/admin';
import { igualdadeSegura, sha256Hex } from '../lib/cripto';
import { agoraIso } from '../lib/datas';
import { novoId } from '../lib/ids';
import { segredo } from '../lib/segredos';
import type { AppBindings } from '../lib/types';
import { alertarPostbackPagoComFalha, ehPostbackPago } from '../services/alerta-postback';
import { extrairResumo, processarPostback, registrarEvento, textoDedupe } from '../services/payt';

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

/** Compara o que chegou com o segredo, sempre em tempo constante. */
function chaveBate(recebida: string | undefined, cadastrada: string): boolean {
  return Boolean(cadastrada) && igualdadeSegura(recebida ?? '', cadastrada);
}

/**
 * O postback aceita a chave no corpo (é como a Payt manda) ou no header.
 * O reprocesso aceita **só** no header: é rota administrativa, e segredo em
 * corpo de requisição acaba em log, em replay de formulário e em histórico.
 */
function chaveDoPostback(
  dados: unknown,
  headerChave: string | undefined,
  cadastrada: string,
): boolean {
  const noCorpo =
    typeof dados === 'object' && dados !== null
      ? (dados as Record<string, unknown>).integration_key
      : undefined;
  return chaveBate(typeof noCorpo === 'string' ? noCorpo : headerChave, cadastrada);
}

/**
 * Campos pessoais que a Payt manda dentro do cliente e que o app **não usa**.
 *
 * A Política de Privacidade diz, com todas as letras, que o app não pede CPF,
 * endereço nem data de nascimento, e lista o que vem da compra: nome, e-mail,
 * telefone, produto, valor, forma e situação do pagamento e número do pedido.
 * Guardar CPF no `payload_json` contrariaria o que está publicado — e guardar o
 * que não se usa é só aumentar o estrago de um vazamento.
 *
 * O formato real traz `customer.doc` (visto no primeiro postback). Os nomes de
 * endereço são previsão: produto físico ainda não passou por aqui, e é melhor a
 * lista já cobrir do que descobrir depois do primeiro pedido com entrega.
 */
const CAMPOS_PESSOAIS = new Set([
  'doc', 'document', 'documento', 'cpf', 'cnpj', 'rg', 'ie',
  'birth', 'birthday', 'birthdate', 'birth_date', 'nascimento', 'data_nascimento',
  'address', 'endereco', 'street', 'rua', 'logradouro', 'number', 'numero',
  'complement', 'complemento', 'neighborhood', 'bairro', 'city', 'cidade',
  'state', 'estado', 'uf', 'zipcode', 'zip_code', 'zip', 'cep', 'postal_code',
  'country', 'pais',
]);

/** Blocos onde esses campos aparecem. Fora deles, `number` é outra coisa. */
const BLOCOS_DE_PESSOA = ['customer', 'buyer', 'cliente', 'address', 'shipping', 'delivery'];

function mascararPessoais(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(mascararPessoais);
  if (valor === null || typeof valor !== 'object') return valor;

  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    if (CAMPOS_PESSOAIS.has(chave.toLowerCase())) {
      // Vazio continua vazio: mascarar "" faria parecer que havia dado ali.
      saida[chave] = v === '' || v === null || v === undefined ? v : '***';
    } else {
      saida[chave] = mascararPessoais(v);
    }
  }
  return saida;
}

/**
 * O payload como ele vai para o banco. O processamento continua usando o
 * original — o que é mascarado aqui é exatamente o que o app não lê.
 */
export function paraGuardar(dados: Record<string, unknown>): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...dados };

  // A chave nunca vai para o banco: o payload fica inspecionável, o segredo não
  // fica guardado nem aparece no `npm run payt:last:staging`.
  if ('integration_key' in copia) copia.integration_key = '***';

  for (const bloco of BLOCOS_DE_PESSOA) {
    const v = copia[bloco];
    if (v && typeof v === 'object') copia[bloco] = mascararPessoais(v);
  }

  return copia;
}

export const payt = new Hono<AppBindings>().post('/postback', async (c) => {
  const cru = await c.req.text();
  const dados = entender(cru, c.req.header('content-type') ?? '');

  if (dados === null || typeof dados !== 'object') {
    return c.json({ error: 'payload_ilegivel' }, 400);
  }

  const cadastrada = segredo(c.env, 'PAYT_INTEGRATION_KEY');
  if (!chaveDoPostback(dados, c.req.header('x-integration-key'), cadastrada)) {
    return c.json({ error: 'integration_key_invalida' }, 401);
  }

  const payloadJson = JSON.stringify(paraGuardar(dados as Record<string, unknown>));

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
      const r = await processarPostback(c.env, dados);
      await marcarProcessado(db, id, null, r.precisaRevisao);
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      console.error('[payt] falha ao processar', id, msg);
      await marcarProcessado(db, id, msg, true);
      // Venda paga que não virou acesso: avisa o suporte em vez de esperar
      // alguém ir olhar a fila. Falha do alerta não pode esconder a do postback.
      if (ehPostbackPago(resumo)) {
        await alertarPostbackPagoComFalha(c.env, resumo, id, msg).catch((e) =>
          console.error('[payt] alerta não saiu', id, e instanceof Error ? e.message : String(e)),
        );
      }
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
 * Autenticação pelo header `x-admin-key`, em tempo constante.
 *
 * **Em produção, só com revisão humana declarada**: uma transação por vez, pelo
 * `transaction_id` (não pelo id interno), e `confirmo_revisado: true` no
 * pedido. Reprocessar sem olhar pode conceder acesso a partir de um payload que
 * foi recusado por um motivo legítimo; foi liberado em 28/10 para o upsell
 * KY5W52D, recusado por um defeito do schema e não do pedido.
 *
 * Todo reprocesso fica em `events` (`payt_reprocessado`): qual transação, o
 * resultado e, pelo `created_at`, quando.
 */
payt.post('/reprocess', async (c) => {
  // Chave de admin, não a da Payt: quem recebe postback não administra o app.
  if (!chaveAdminConfere(c.req.header('x-admin-key'), c.env)) {
    return c.json({ error: 'nao_autorizado' }, 401);
  }

  const corpo = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;

  const transactionId =
    typeof corpo?.transaction_id === 'string' && corpo.transaction_id.trim() ? corpo.transaction_id.trim() : null;
  const id = typeof corpo?.id === 'string' ? corpo.id : null;

  if (c.env.ENV === 'production' && (!transactionId || id || corpo?.confirmo_revisado !== true)) {
    return c.json(
      {
        error: 'reprocesso_em_producao_exige_revisao',
        detalhe: 'informe só o transaction_id e confirmo_revisado: true, depois de revisar o evento',
      },
      403,
    );
  }
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

  const registro = {
    transaction_id: transactionId,
    evento: evento.id,
    ambiente: c.env.ENV ?? null,
    confirmo_revisado: corpo?.confirmo_revisado === true,
  };

  try {
    const r = await processarPostback(c.env, dados);
    await marcarProcessado(c.env.DB, evento.id, null, r.precisaRevisao);
    await registrarEvento(c.env.DB, null, 'payt_reprocessado', { ...registro, ok: true, acao: r.acao });
    return c.json({ ok: true, id: evento.id, ...r });
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    await marcarProcessado(c.env.DB, evento.id, msg, true);
    await registrarEvento(c.env.DB, null, 'payt_reprocessado', { ...registro, ok: false, erro: msg.slice(0, 300) });
    return c.json({ ok: false, id: evento.id, error: msg }, 200);
  }
});
