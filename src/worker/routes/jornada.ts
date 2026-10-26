/**
 * Jornada e lições (fase 5).
 *
 * `GET  /api/programas`            o que a pessoa tem, com o dia atual de cada um
 * `GET  /api/programas/:id`        lista de dias (matricula na primeira visita)
 * `GET  /api/licoes/:id`           a lição para tocar
 * `POST /api/licoes/:id/concluir`  marca o dia como feito
 * `POST /api/eventos`              eventos do funil que só o client sabe
 */
import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppBindings } from '../lib/types';
import { COOKIE_SESSAO, usuarioDaSessao } from '../services/auth';
import {
  abrirLicao,
  abrirPrograma,
  concluirLicao,
  programasDaHome,
  registrarEvento,
} from '../services/jornada';

/** Eventos que o client pode registrar. Lista fechada: `events` vira relatório. */
const EVENTOS_DO_CLIENT = [
  'lesson_started',
  'audio_completed',
  /** Fase 8: instalação e lembrete, que só o aparelho sabe se aconteceram. */
  'push_aberto',
  'app_instalado',
  'push_ativado',
  'push_negado',
  /**
   * Falha ao ligar o lembrete, com a etapa em que parou. O `catch` do client
   * engolia o erro e a tela só dizia "não consegui" — sem Mac para inspecionar
   * o Safari do iPhone, é por aqui que a causa aparece.
   */
  'push_erro_cliente',
  /** Fase 6: o funil da loja, até o clique que leva para o checkout. */
  'store_viewed',
  'product_viewed',
  'checkout_clicked',
] as const;

/**
 * De onde veio a ativação do lembrete.
 *
 * 'botao' é o toque em "Quero o lembrete"; 'automatico' é o
 * `garantirAssinatura`, que reassina em silêncio quem já tinha dito sim e
 * perdeu a assinatura (reinstalou, limpou os dados do site). Sem separar as
 * duas, o funil não distingue quem escolheu de quem foi recuperado.
 */
const ORIGENS_DE_ATIVACAO = ['botao', 'automatico'] as const;

/** Os passos do `ligarLembrete`, na ordem em que ele tenta cada um. */
const ETAPAS_DE_PUSH = ['permissao', 'service_worker', 'chave', 'assinar', 'gravar'] as const;

const EventoSchema = z.object({
  nome: z.enum(EVENTOS_DO_CLIENT),
  lesson_id: z.string().trim().max(120).optional(),
  dia: z.number().int().min(1).max(99).optional(),
  programa: z.string().trim().max(120).optional(),
  /** Fase 6: qual produto da loja o evento é. */
  produto: z.string().trim().max(120).optional(),
  /** Fase 8: só o `push_ativado` usa este. */
  origem: z.enum(ORIGENS_DE_ATIVACAO).optional(),
  /** Fase 8: só o `push_erro_cliente` usa os três de baixo. */
  etapa: z.enum(ETAPAS_DE_PUSH).optional(),
  erro: z.string().trim().max(300).optional(),
  status: z.number().int().min(0).max(599).optional(),
});

async function userIdDaSessao(c: Context<AppBindings>): Promise<string | null> {
  const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
  return sessao?.userId ?? null;
}

export const jornada = new Hono<AppBindings>()
  .get('/', async (c) => {
    const userId = await userIdDaSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    return c.json({ programas: await programasDaHome(c.env.DB, userId) });
  })

  .get('/:id', async (c) => {
    const userId = await userIdDaSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const r = await abrirPrograma(c.env.DB, userId, c.req.param('id'));
    if (!r.ok) return c.json({ error: r.motivo }, r.motivo === 'nao_encontrado' ? 404 : 403);

    return c.json({ programa: r.programa, licoes: r.licoes });
  });

export const licoes = new Hono<AppBindings>()
  .get('/:id', async (c) => {
    const userId = await userIdDaSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const r = await abrirLicao(c.env.DB, userId, c.req.param('id'));
    if (!r.ok) {
      const status = r.motivo === 'nao_encontrado' ? 404 : 403;
      return c.json(
        {
          error: r.motivo,
          ...(r.dias_para_liberar !== undefined
            ? { dias_para_liberar: r.dias_para_liberar }
            : {}),
        },
        status,
      );
    }

    return c.json({ licao: r.licao });
  })

  .post('/:id/concluir', async (c) => {
    const userId = await userIdDaSessao(c);
    if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

    const r = await concluirLicao(c.env.DB, userId, c.req.param('id'));
    if (!r.ok) return c.json({ error: 'sem_acesso' }, 403);

    return c.json({ ok: true, concluidos: r.concluidos, total: r.total });
  });

export const eventos = new Hono<AppBindings>().post('/', async (c) => {
  const userId = await userIdDaSessao(c);
  if (!userId) return c.json({ error: 'nao_autenticado' }, 401);

  const corpo = EventoSchema.safeParse(await c.req.json().catch(() => null));
  if (!corpo.success) return c.json({ error: 'evento_invalido' }, 400);

  const { nome, ...props } = corpo.data;
  await registrarEvento(c.env.DB, userId, nome, props);

  return c.json({ ok: true });
});
