/**
 * A jornada: quais programas a pessoa tem, que dia está liberado e o progresso
 * (CLAUDE.md §6 e fase 5 da §16).
 *
 * Quem decide acesso continua sendo `hasAccess` — aqui só se decide **qual dia**
 * está liberado dentro de um programa que a pessoa já pode ver.
 */
import type { LicaoCompleta, LicaoNaLista, Programa } from '../../shared/types';
import { agoraIso, diasDesde } from '../lib/datas';
import { novoId } from '../lib/ids';
import { hasAccess } from './entitlements';

// Os formatos de resposta moram no `shared`: o client consome os mesmos (§3).
export type { EstadoLicao, LicaoCompleta, LicaoNaLista, Programa } from '../../shared/types';

interface LinhaLicao {
  id: string;
  day: number;
  title: string;
  summary: string | null;
  body_md: string | null;
  audio_key: string | null;
  duration_s: number | null;
}

/**
 * A frase curta do dia, para o cartão da Home e a lista.
 *
 * O certo é o `summary` do seed, mas hoje ele vem vazio na jornada (o campo é do
 * pipeline de conteúdo, §3). Enquanto não vier, a linha de **Intenção** do corpo
 * serve bem: ela já é uma frase só, e diz o que o dia pede. Último recurso é o
 * primeiro parágrafo de texto corrido.
 */
export function fraseDaLicao(summary: string | null, bodyMd: string | null): string | null {
  const resumo = summary?.trim();
  if (resumo) return resumo;

  const corpo = bodyMd ?? '';

  const intencao = /\*\*Inten[çc][ãa]o:?\*\*\s*(.+)/i.exec(corpo);
  if (intencao?.[1]?.trim()) return intencao[1].trim();

  // Linha que não começa por rótulo em negrito é texto corrido de verdade.
  const paragrafo = corpo
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 40 && !l.startsWith('**'));

  if (!paragrafo) return null;
  if (paragrafo.length <= 160) return paragrafo;
  return `${paragrafo.slice(0, 157).replace(/\s+\S*$/, '')}…`;
}

/**
 * O aviso obrigatório do produto (§14) aparece numa faixa no topo da tela. Alguns
 * textos do conteúdo repetem o mesmo aviso como citação na primeira linha, e aí a
 * pessoa lê duas vezes a mesma frase. Quando o primeiro bloco é exatamente o
 * aviso, ele sai do corpo — a faixa continua lá, que é o que a regra exige.
 */
export function semAvisoRepetido(bodyMd: string | null, notice: string | null): string | null {
  if (!bodyMd || !notice) return bodyMd;

  const normal = (s: string) => s.replace(/[\s>*_]+/g, ' ').trim().toLowerCase();
  const blocos = bodyMd.split(/\n{2,}/);
  const primeiro = blocos[0] ?? '';

  if (primeiro.trimStart().startsWith('>') && normal(primeiro) === normal(notice)) {
    return blocos.slice(1).join('\n\n').trim();
  }
  return bodyMd;
}

/** Matrícula do usuário no programa; cria na primeira visita (§6). */
export async function matricular(
  db: D1Database,
  userId: string,
  programId: string,
): Promise<string> {
  const existente = await db
    .prepare('SELECT started_at FROM enrollments WHERE user_id = ? AND program_id = ?')
    .bind(userId, programId)
    .first<{ started_at: string }>();

  if (existente) return existente.started_at;

  const agora = agoraIso();
  await db
    .prepare(
      `INSERT INTO enrollments (user_id, program_id, started_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id, program_id) DO NOTHING`,
    )
    .bind(userId, programId, agora)
    .run();

  // Releitura: duas abas abrindo juntas não podem gerar duas datas de início.
  const linha = await db
    .prepare('SELECT started_at FROM enrollments WHERE user_id = ? AND program_id = ?')
    .bind(userId, programId)
    .first<{ started_at: string }>();

  return linha?.started_at ?? agora;
}

interface ContextoDeEstado {
  unlockRule: 'daily' | 'all';
  totalDays: number;
  /** null quando ainda não há matrícula: nada começou, então só o dia 1 abre. */
  diasCorridos: number | null;
  concluidas: Set<string>;
}

function estadoDaLicao(licao: LinhaLicao, ctx: ContextoDeEstado): LicaoNaLista {
  const base: LicaoNaLista = {
    id: licao.id,
    dia: licao.day,
    titulo: licao.title,
    frase: fraseDaLicao(licao.summary, licao.body_md),
    estado: 'liberado',
    tem_audio: Boolean(licao.audio_key),
    duracao_s: licao.duration_s,
  };

  if (ctx.concluidas.has(licao.id)) return { ...base, estado: 'concluido' };

  // `all`: tudo aberto desde o primeiro acesso (produto avulso, não é jornada).
  if (ctx.unlockRule === 'all') return base;

  const corridos = ctx.diasCorridos ?? 0;
  const diaDeHoje = Math.min(corridos + 1, ctx.totalDays);

  if (licao.day > corridos + 1) {
    return { ...base, estado: 'bloqueado', dias_para_liberar: licao.day - 1 - corridos };
  }
  return { ...base, estado: licao.day === diaDeHoje ? 'hoje' : 'liberado' };
}

async function concluidasDoPrograma(
  db: D1Database,
  userId: string,
  programId: string,
): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT p.lesson_id FROM progress p
         JOIN lessons l ON l.id = p.lesson_id
        WHERE p.user_id = ? AND l.program_id = ?`,
    )
    .bind(userId, programId)
    .all<{ lesson_id: string }>();

  return new Set(results.map((r) => r.lesson_id));
}

async function licoesDoPrograma(db: D1Database, programId: string): Promise<LinhaLicao[]> {
  const { results } = await db
    .prepare(
      `SELECT id, day, title, summary, body_md, audio_key, duration_s
         FROM lessons WHERE program_id = ? ORDER BY day`,
    )
    .bind(programId)
    .all<LinhaLicao>();

  return results;
}

interface LinhaPrograma {
  id: string;
  title: string;
  product_id: string;
  produto_nome: string;
  notice: string | null;
  unlock_rule: 'daily' | 'all';
  total_days: number;
  available_from: string | null;
}

async function programasVisiveis(db: D1Database, userId: string): Promise<LinhaPrograma[]> {
  const { results } = await db
    .prepare(
      `SELECT pr.id, pr.title, pr.product_id, pr.unlock_rule, pr.total_days, pr.available_from,
              p.name AS produto_nome, p.notice
         FROM programs pr
         JOIN products p ON p.id = pr.product_id
        ORDER BY p.sort, pr.id`,
    )
    .all<LinhaPrograma>();

  const agora = agoraIso();
  const visiveis: LinhaPrograma[] = [];

  for (const programa of results) {
    // Novena do mês do Círculo: só aparece a partir da data marcada (§5).
    if (programa.available_from && agora < programa.available_from) continue;
    if (await hasAccess(db, userId, programa.product_id)) visiveis.push(programa);
  }

  return visiveis;
}

/** O "dia atual": hoje, se existir; senão o primeiro não concluído. */
function licaoAtual(lista: LicaoNaLista[]): LicaoNaLista | null {
  return (
    lista.find((l) => l.estado === 'hoje') ??
    lista.find((l) => l.estado === 'liberado') ??
    lista[lista.length - 1] ??
    null
  );
}

async function montarPrograma(
  db: D1Database,
  userId: string,
  linha: LinhaPrograma,
  diasCorridos: number | null,
): Promise<{ programa: Programa; licoes: LicaoNaLista[] }> {
  const [licoes, concluidas] = await Promise.all([
    licoesDoPrograma(db, linha.id),
    concluidasDoPrograma(db, userId, linha.id),
  ]);

  const lista = licoes.map((l) =>
    estadoDaLicao(l, {
      unlockRule: linha.unlock_rule,
      totalDays: linha.total_days,
      diasCorridos,
      concluidas,
    }),
  );

  return {
    programa: {
      id: linha.id,
      titulo: linha.title,
      produto_id: linha.product_id,
      produto_nome: linha.produto_nome,
      notice: linha.notice,
      unlock_rule: linha.unlock_rule,
      total_days: linha.total_days,
      concluidos: concluidas.size,
      atual: licaoAtual(lista),
    },
    licoes: lista,
  };
}

async function fusoDoUsuario(db: D1Database, userId: string): Promise<string> {
  const u = await db
    .prepare('SELECT timezone FROM users WHERE id = ?')
    .bind(userId)
    .first<{ timezone: string }>();
  return u?.timezone ?? 'America/Sao_Paulo';
}

/**
 * Programas da Home. **Não matricula**: a matrícula nasce quando a pessoa abre o
 * programa (§6), não quando a Home é desenhada.
 */
export async function programasDaHome(db: D1Database, userId: string): Promise<Programa[]> {
  const linhas = await programasVisiveis(db, userId);
  if (linhas.length === 0) return [];

  const fuso = await fusoDoUsuario(db, userId);
  const { results: matriculas } = await db
    .prepare('SELECT program_id, started_at FROM enrollments WHERE user_id = ?')
    .bind(userId)
    .all<{ program_id: string; started_at: string }>();

  const inicio = new Map(matriculas.map((m) => [m.program_id, m.started_at]));
  const programas: Programa[] = [];

  for (const linha of linhas) {
    const comecou = inicio.get(linha.id);
    const { programa } = await montarPrograma(
      db,
      userId,
      linha,
      comecou ? diasDesde(comecou, fuso) : null,
    );
    programas.push(programa);
  }

  return programas;
}

export type ResultadoPrograma =
  | { ok: true; programa: Programa; licoes: LicaoNaLista[] }
  | { ok: false; motivo: 'sem_acesso' | 'nao_encontrado' };

/** Lista de dias de um programa. Matricula na primeira visita. */
export async function abrirPrograma(
  db: D1Database,
  userId: string,
  programId: string,
): Promise<ResultadoPrograma> {
  const linhas = await programasVisiveis(db, userId);
  const linha = linhas.find((p) => p.id === programId);

  if (!linha) {
    const existe = await db
      .prepare('SELECT 1 FROM programs WHERE id = ?')
      .bind(programId)
      .first();
    return { ok: false, motivo: existe ? 'sem_acesso' : 'nao_encontrado' };
  }

  const inicio = await matricular(db, userId, linha.id);
  const fuso = await fusoDoUsuario(db, userId);
  const { programa, licoes } = await montarPrograma(db, userId, linha, diasDesde(inicio, fuso));

  return { ok: true, programa, licoes };
}

export type ResultadoLicao =
  | { ok: true; licao: LicaoCompleta }
  | { ok: false; motivo: 'sem_acesso' | 'nao_encontrado' | 'bloqueada'; dias_para_liberar?: number };

/**
 * Uma lição para tocar. Confere acesso ao produto **e** se o dia já liberou:
 * sem a segunda checagem, bastaria adivinhar a URL para ler o dia 19 no dia 1.
 */
export async function abrirLicao(
  db: D1Database,
  userId: string,
  lessonId: string,
): Promise<ResultadoLicao> {
  const licao = await db
    .prepare(
      `SELECT l.id, l.day, l.title, l.summary, l.body_md, l.audio_key, l.duration_s,
              l.bonus_audio_key, l.bonus_title, l.program_id,
              pr.title AS programa_titulo, pr.unlock_rule, pr.total_days, pr.product_id,
              p.notice
         FROM lessons l
         JOIN programs pr ON pr.id = l.program_id
         JOIN products p ON p.id = pr.product_id
        WHERE l.id = ?`,
    )
    .bind(lessonId)
    .first<
      LinhaLicao & {
        bonus_audio_key: string | null;
        bonus_title: string | null;
        program_id: string;
        programa_titulo: string;
        unlock_rule: 'daily' | 'all';
        total_days: number;
        product_id: string;
        notice: string | null;
      }
    >();

  if (!licao) return { ok: false, motivo: 'nao_encontrado' };
  if (!(await hasAccess(db, userId, licao.product_id))) return { ok: false, motivo: 'sem_acesso' };

  const inicio = await matricular(db, userId, licao.program_id);
  const fuso = await fusoDoUsuario(db, userId);
  const concluidas = await concluidasDoPrograma(db, userId, licao.program_id);

  const estado = estadoDaLicao(licao, {
    unlockRule: licao.unlock_rule,
    totalDays: licao.total_days,
    diasCorridos: diasDesde(inicio, fuso),
    concluidas,
  });

  if (estado.estado === 'bloqueado') {
    return {
      ok: false,
      motivo: 'bloqueada',
      ...(estado.dias_para_liberar !== undefined
        ? { dias_para_liberar: estado.dias_para_liberar }
        : {}),
    };
  }

  return {
    ok: true,
    licao: {
      ...estado,
      programa_id: licao.program_id,
      programa_titulo: licao.programa_titulo,
      unlock_rule: licao.unlock_rule,
      total_days: licao.total_days,
      notice: licao.notice,
      body_md: semAvisoRepetido(licao.body_md, licao.notice),
      // A chave do R2 nunca vai para o client: o caminho é sempre pelo Worker.
      audio_url: licao.audio_key ? `/media/${licao.audio_key}` : null,
      bonus_audio_url: licao.bonus_audio_key ? `/media/${licao.bonus_audio_key}` : null,
      bonus_title: licao.bonus_title,
    },
  };
}

/** Marca a lição como concluída. Idempotente: tocar duas vezes não duplica. */
export async function concluirLicao(
  db: D1Database,
  userId: string,
  lessonId: string,
): Promise<{ ok: boolean; concluidos: number; total: number }> {
  const aberta = await abrirLicao(db, userId, lessonId);
  if (!aberta.ok) return { ok: false, concluidos: 0, total: 0 };

  const gravou = await db
    .prepare(
      `INSERT INTO progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id, lesson_id) DO NOTHING`,
    )
    .bind(userId, lessonId, agoraIso())
    .run();

  /*
   * O evento sai só quando o progresso é novo. Tocar "concluí" de novo — ou o
   * botão disparar duas vezes — não pode virar duas linhas no funil D1 → D19,
   * senão a taxa de conclusão passa a contar insistência, não gente.
   */
  if ((gravou.meta.changes ?? 0) > 0) {
    await registrarEvento(db, userId, 'lesson_completed', {
      lesson_id: lessonId,
      programa: aberta.licao.programa_id,
      dia: aberta.licao.dia,
    });
  }

  const concluidas = await concluidasDoPrograma(db, userId, aberta.licao.programa_id);

  // Jornada inteira concluída fecha a matrícula: é o gatilho da oferta do §9.
  if (concluidas.size >= aberta.licao.total_days) {
    await db
      .prepare(
        `UPDATE enrollments SET completed_at = ?
          WHERE user_id = ? AND program_id = ? AND completed_at IS NULL`,
      )
      .bind(agoraIso(), userId, aberta.licao.programa_id)
      .run();
  }

  return { ok: true, concluidos: concluidas.size, total: aberta.licao.total_days };
}

/** Eventos do funil D1 → D19 (§13). */
export async function registrarEvento(
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
