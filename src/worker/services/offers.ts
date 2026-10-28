/**
 * Ofertas contextuais da Home (CLAUDE.md §9).
 *
 * `getOffer` devolve **no máximo uma** oferta, ou `null`. Por enquanto são os
 * dois pacotes do funil, cada um numa janela da jornada:
 *
 *   dias 5 a 9   → UP1, Oração de São Miguel (oracao-sao-miguel)
 *   dias 10 a 18 → UP2, Jornada de Cura com Padre Pio (jornada-cura-padre-pio)
 *
 * O dia é o mesmo "dia de hoje" do lembrete (cron.ts): `min(dias corridos + 1,
 * 19)` desde a matrícula, no fuso da pessoa. **Sem matrícula e nos dias 1 a 4
 * não há oferta**: a primeira impressão do app é a oração, não a venda.
 *
 * Quem já tem o pacote (`hasAccess` no bundle) não vê o card dele, e "Agora não"
 * esconde aquele pacote por 7 dias. A dispensa fica em `events`, no servidor,
 * para valer em qualquer aparelho da pessoa.
 */
import { JOURNEY_TOTAL_DAYS } from '../../shared/constants';
import type { Oferta, PacoteOfertado } from '../../shared/types';
import { agoraIso, dataLocalIso, diasDesde, somarDias } from '../lib/datas';
import { novoId } from '../lib/ids';
import { hasAccess } from './entitlements';

/** O mesmo §9: "uma oferta dispensada pelo usuário não volta por 7 dias". */
export const DIAS_DISPENSADA = 7;

const PROGRAMA_DA_JORNADA = 'jornada-19';

/**
 * Janela e texto de cada pacote. Texto sem promessa de resultado (§14), e o
 * pacote de saúde leva o aviso obrigatório.
 */
const PACOTES: ReadonlyArray<Omit<Oferta, 'dia'> & { de: number; ate: number }> = [
  {
    produto: 'oracao-sao-miguel',
    de: 5,
    ate: 9,
    titulo: 'Oração de São Miguel do Monte Gargano',
    texto:
      'A oração inspirada no santuário mais antigo de São Miguel, em áudio guiado, junto com o Manual de Purificação e o Mapa da Prosperidade Divina.',
    aviso: null,
  },
  {
    produto: 'jornada-cura-padre-pio',
    de: 10,
    ate: 18,
    titulo: 'Jornada de Cura com Padre Pio',
    texto:
      'Sete dias de oração com Padre Pio, pelos doentes da família e pelo que pesa no coração, com quatro orações guiadas para os dias difíceis.',
    aviso: 'Conteúdo devocional. Não substitui acompanhamento médico nem tratamento.',
  },
];

export const PACOTES_OFERTADOS = PACOTES.map((p) => p.produto) as PacoteOfertado[];

export function ehPacoteOfertado(valor: unknown): valor is PacoteOfertado {
  return typeof valor === 'string' && (PACOTES_OFERTADOS as string[]).includes(valor);
}

/** O "dia de hoje" da jornada, igual ao do lembrete; `null` sem matrícula. */
async function diaDaJornada(
  db: D1Database,
  userId: string,
  timezone: string,
  agora: string,
): Promise<number | null> {
  const matricula = await db
    .prepare('SELECT started_at FROM enrollments WHERE user_id = ? AND program_id = ?')
    .bind(userId, PROGRAMA_DA_JORNADA)
    .first<{ started_at: string }>();
  if (!matricula) return null;
  return Math.min(diasDesde(matricula.started_at, timezone, agora) + 1, JOURNEY_TOTAL_DAYS);
}

async function dispensadaRecentemente(
  db: D1Database,
  userId: string,
  produto: string,
  agora: string,
): Promise<boolean> {
  const desde = somarDias(agora, -DIAS_DISPENSADA) ?? agora;
  const r = await db
    .prepare(
      `SELECT 1 FROM events
        WHERE user_id = ? AND name = 'offer_dismissed'
          AND json_extract(props_json, '$.produto') = ? AND created_at > ?
        LIMIT 1`,
    )
    .bind(userId, produto, desde)
    .first();
  return r !== null;
}

export async function getOffer(
  db: D1Database,
  userId: string,
  timezone: string,
  agora = agoraIso(),
): Promise<Oferta | null> {
  const dia = await diaDaJornada(db, userId, timezone, agora);
  if (dia === null) return null;

  const pacote = PACOTES.find((p) => dia >= p.de && dia <= p.ate);
  if (!pacote) return null;

  // Sem checkout cadastrado, o toque levaria a uma página sem botão de compra.
  const comCheckout = await db
    .prepare('SELECT 1 FROM products WHERE id = ? AND checkout_url IS NOT NULL')
    .bind(pacote.produto)
    .first();
  if (!comCheckout) return null;

  if (await hasAccess(db, userId, pacote.produto)) return null;
  if (await dispensadaRecentemente(db, userId, pacote.produto, agora)) return null;

  const { de: _de, ate: _ate, ...oferta } = pacote;
  return { ...oferta, dia };
}

/**
 * `offer_viewed` uma vez por dia (no fuso da pessoa) e por pacote. O card é
 * desenhado a cada abertura da Home, e contar cada abertura inflaria a métrica
 * sem dizer quantas pessoas viram a oferta.
 */
export async function registrarOfertaVista(
  db: D1Database,
  userId: string,
  oferta: Oferta,
  timezone: string,
  agora = agoraIso(),
): Promise<void> {
  const dataLocal = dataLocalIso(timezone, agora);
  await db
    .prepare(
      `INSERT INTO events (id, user_id, name, props_json, created_at)
       SELECT ?, ?, 'offer_viewed', ?, ?
        WHERE NOT EXISTS (
              SELECT 1 FROM events
               WHERE user_id = ? AND name = 'offer_viewed'
                 AND json_extract(props_json, '$.produto') = ?
                 AND json_extract(props_json, '$.data_local') = ?)`,
    )
    .bind(
      novoId(),
      userId,
      JSON.stringify({ produto: oferta.produto, dia: oferta.dia, data_local: dataLocal }),
      agora,
      userId,
      oferta.produto,
      dataLocal,
    )
    .run();
}

export async function registrarOfertaDispensada(
  db: D1Database,
  userId: string,
  produto: PacoteOfertado,
  agora = agoraIso(),
): Promise<void> {
  await db
    .prepare('INSERT INTO events (id, user_id, name, props_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(novoId(), userId, 'offer_dismissed', JSON.stringify({ produto }), agora)
    .run();
}
