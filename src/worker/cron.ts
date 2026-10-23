/**
 * Lembrete diário de oração (CLAUDE.md §11).
 *
 * Roda **a cada 5 minutos**, não de hora em hora. O padrão é 7h e quase todo
 * mundo fica nele, então uma execução por hora concentraria a base inteira numa
 * só — e uma execução de Worker tem limite de tempo e de subrequisições. De
 * cinco em cinco minutos, o mesmo público sai em lotes pequenos, e quem está na
 * hora certa continua recebendo dentro da hora que escolheu.
 */
import { agoraIso, dataLocalIso, diasDesde, horaLocal } from './lib/datas';
import type { AppBindings } from './lib/types';
import { hasAccess } from './services/entitlements';
import { JOURNEY_TOTAL_DAYS } from '../shared/constants';
import {
  type AssinaturaPush,
  type MensagemPush,
  type ResultadoPush,
  enviarERegistrar,
} from './services/push';

type Ambiente = AppBindings['Bindings'];

/** Quantos usuários uma execução atende. Lote pequeno, execução curta. */
export const LOTE = 300;

/** Tipo do lembrete em `push_envios`. */
const TIPO = 'oracao_do_dia';

/**
 * Dias de tolerância depois de o dia 19 abrir. Quem some no meio continua sendo
 * lembrado por uma semana; depois disso, insistir é só incômodo. O que vem
 * depois da jornada é da fase 10.
 */
const DIAS_APOS_O_FIM = 7;

interface Candidato {
  user_id: string;
  timezone: string;
  prayer_hour: number;
}

/**
 * Quem está na hora agora, no fuso de cada um, e ainda não recebeu hoje.
 *
 * A hora é comparada em SQL por fuso, o que o SQLite não sabe fazer — então o
 * filtro fino fica no código. O SQL já corta para quem tem assinatura de push,
 * que é a maior parte do corte.
 */
export async function candidatosDoMomento(
  db: D1Database,
  agora: string,
  limite = LOTE,
): Promise<Candidato[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id AS user_id, u.timezone, u.prayer_hour
         FROM users u
        WHERE u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)
        ORDER BY u.created_at
        LIMIT ?`,
    )
    // Folga sobre o lote: o filtro de hora e de "já recebeu" derruba a maioria.
    .bind(limite * 20)
    .all<Candidato>();

  const naHora: Candidato[] = [];
  for (const c of results) {
    if (horaLocal(c.timezone, agora) !== c.prayer_hour) continue;

    const jaFoi = await db
      .prepare('SELECT 1 FROM push_envios WHERE user_id = ? AND tipo = ? AND data_local = ?')
      .bind(c.user_id, TIPO, dataLocalIso(c.timezone, agora))
      .first();

    if (!jaFoi) naHora.push(c);
    if (naHora.length >= limite) break;
  }

  return naHora;
}

export interface LicaoDoLembrete {
  id: string;
  dia: number;
  push_text: string | null;
  titulo: string;
}

/**
 * Qual dia lembrar — a mesma conta do "dia de hoje" da Home.
 *
 * Sem matrícula, o dia 1: o push convida quem comprou e ainda não abriu. **Ele
 * não matricula**: a matrícula nasce quando a pessoa entra no programa (§6),
 * senão o relógio da jornada começaria a correr sozinho e o dia 2 abriria sem
 * ninguém ter rezado o dia 1.
 */
export async function licaoDoLembrete(
  db: D1Database,
  userId: string,
  timezone: string,
  agora: string,
): Promise<LicaoDoLembrete | null> {
  const matricula = await db
    .prepare("SELECT started_at FROM enrollments WHERE user_id = ? AND program_id = 'jornada-19'")
    .bind(userId)
    .first<{ started_at: string }>();

  let dia = 1;

  if (matricula) {
    const corridos = diasDesde(matricula.started_at, timezone, agora);
    dia = Math.min(corridos + 1, JOURNEY_TOTAL_DAYS);

    // Passou uma semana do último dia: a jornada acabou, com ou sem conclusão.
    if (corridos + 1 > JOURNEY_TOTAL_DAYS + DIAS_APOS_O_FIM) return null;
  }

  const licao = await db
    .prepare(
      `SELECT l.id, l.day AS dia, l.push_text, l.title AS titulo
         FROM lessons l
        WHERE l.program_id = 'jornada-19' AND l.day = ?`,
    )
    .bind(dia)
    .first<LicaoDoLembrete>();

  if (!licao) return null;

  // Já rezou hoje: não há o que lembrar.
  const concluida = await db
    .prepare('SELECT 1 FROM progress WHERE user_id = ? AND lesson_id = ?')
    .bind(userId, licao.id)
    .first();

  return concluida ? null : licao;
}

export function montarMensagem(licao: LicaoDoLembrete): MensagemPush {
  return {
    titulo: `Oração do dia ${licao.dia}`,
    corpo: licao.push_text ?? licao.titulo,
    url: `/licao/${licao.id}?origem=push`,
    // Mesma tag: um lembrete troca o outro em vez de empilhar na tela.
    tag: 'oracao-do-dia',
  };
}

export interface RelatorioLembrete {
  candidatos: number;
  enviados: number;
  falhas: number;
  pulados: number;
}

/** O envio de verdade; trocável no teste para não sair pela internet. */
export type Enviador = (
  env: Ambiente,
  userId: string,
  assinatura: AssinaturaPush & { id: string },
  mensagem: MensagemPush,
  props?: Record<string, unknown>,
) => Promise<ResultadoPush>;

export async function enviarLembretes(
  env: Ambiente,
  opcoes: { agora?: string; limite?: number; enviar?: Enviador } = {},
): Promise<RelatorioLembrete> {
  const agora = opcoes.agora ?? agoraIso();
  const enviar = opcoes.enviar ?? enviarERegistrar;
  const relatorio: RelatorioLembrete = { candidatos: 0, enviados: 0, falhas: 0, pulados: 0 };

  const candidatos = await candidatosDoMomento(env.DB, agora, opcoes.limite ?? LOTE);
  relatorio.candidatos = candidatos.length;

  for (const c of candidatos) {
    if (!(await hasAccess(env.DB, c.user_id, 'jornada-meu-anjo'))) {
      relatorio.pulados += 1;
      continue;
    }

    const licao = await licaoDoLembrete(env.DB, c.user_id, c.timezone, agora);
    if (!licao) {
      relatorio.pulados += 1;
      continue;
    }

    /*
     * A linha entra **antes** do envio e só quem conseguiu inserir envia. Duas
     * execuções sobrepostas — uma lenta, a seguinte começando — disputam a mesma
     * chave primária, e só uma ganha. Marcar depois do envio deixaria a janela
     * aberta justamente onde o envio demora.
     */
    const reivindicado = await env.DB.prepare(
      `INSERT OR IGNORE INTO push_envios (user_id, tipo, data_local, enviado_em)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(c.user_id, TIPO, dataLocalIso(c.timezone, agora), agora)
      .run();

    if ((reivindicado.meta.changes ?? 0) === 0) {
      relatorio.pulados += 1;
      continue;
    }

    const { results: assinaturas } = await env.DB.prepare(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    )
      .bind(c.user_id)
      .all<AssinaturaPush & { id: string }>();

    const mensagem = montarMensagem(licao);
    let algumFoi = false;

    for (const assinatura of assinaturas) {
      const r = await enviar(env, c.user_id, assinatura, mensagem, {
        tipo: TIPO,
        dia: licao.dia,
      });
      if (r.ok) algumFoi = true;
    }

    if (algumFoi) relatorio.enviados += 1;
    else relatorio.falhas += 1;
  }

  return relatorio;
}
