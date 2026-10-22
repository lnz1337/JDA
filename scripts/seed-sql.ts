/**
 * Converte os JSON de seed em SQL idempotente (INSERT ... ON CONFLICT DO UPDATE).
 *
 *   node scripts/seed-sql.ts [saida.sql]        (padrão: seed/seed.sql)
 *
 * Três fontes, uma dona por campo (CLAUDE.md §3):
 *
 *   seed/jornada-19-dias.json  GERADO por conteudo/gerar_seed.py
 *                              → a jornada: produto, programa e as 19 lições
 *   seed/produtos.json         GERADO por conteudo/gerar_seed_produtos.py
 *                              → os itens de bundle: nome, descrição, aviso, lições
 *                                e a que bundle cada um pertence (bundle_id)
 *   seed/catalogo.json         À MÃO
 *                              → preço, checkout, ordem, assinatura; e o nome dos
 *                                bundles/assinaturas, que não têm arquivo de conteúdo
 *
 * Se o mesmo campo aparecer em duas fontes, ou se um bundle_id apontar para um
 * produto que não está no catálogo, o script falha com o motivo.
 *
 * A duração de cada lição sai do MP3 local, quando ele existe na máquina. Sem o
 * arquivo, duration_s fica NULL e o ON CONFLICT preserva o que já estiver no banco.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mp3DurationSeconds } from './lib/mp3.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Faixa extra do último dia da jornada (CLAUDE.md §5, coluna bonus_audio_key). */
export const BONUS = {
  day: 19,
  audio_key: 'jornada/hino-sao-miguel.mp3',
  title: 'Hino de São Miguel',
} as const;

/** Campos que pertencem a uma fonte de conteúdo e não podem ser repetidos no catálogo. */
const CAMPOS_DE_CONTEUDO = ['name', 'kind', 'description_md', 'notice', 'listed'] as const;

type Scalar = string | number | null;

export interface SeedJornada {
  product: { id: string; name: string; kind: string; listed: number };
  program: {
    id: string;
    product_id: string;
    title: string;
    unlock_rule: string;
    total_days: number;
  };
  lessons: Array<{
    id: string;
    program_id: string;
    day: number;
    title: string;
    body_md: string;
    push_text: string;
    audio_key: string;
  }>;
}

export interface SeedProdutos {
  products: Array<{
    id: string;
    name: string;
    kind: string;
    description_md: string | null;
    notice: string | null;
    listed: number;
    bundle_id: string;
  }>;
  programs: Array<{
    id: string;
    product_id: string;
    title: string;
    unlock_rule: string;
    total_days: number;
  }>;
  lessons: Array<{
    id: string;
    program_id: string;
    day: number;
    title: string;
    summary: string | null;
    body_md: string;
    audio_key: string | null;
  }>;
}

export interface ItemCatalogo {
  id: string;
  name?: string;
  kind?: string;
  description_md?: string;
  notice?: string;
  listed?: number;
  price_cents?: number | null;
  checkout_url?: string | null;
  requires_subscription?: number;
  sort?: number;
}

export interface Catalogo {
  products: ItemCatalogo[];
  /** product.code da Payt -> nosso produto. Vale em todos os ambientes. */
  payt_map?: Record<string, string>;
}

/** Campos de um produto que vêm de uma fonte de conteúdo. */
interface Conteudo {
  origem: string;
  name: string;
  kind: string;
  description_md: string | null;
  notice: string | null;
  listed: number;
}

function lerJson<T>(caminho: string): T {
  return JSON.parse(readFileSync(resolve(RAIZ, caminho), 'utf8')) as T;
}

function sql(valor: Scalar | undefined): string {
  if (valor === undefined || valor === null) return 'NULL';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error(`número inválido: ${valor}`);
    return String(valor);
  }
  return `'${valor.replace(/'/g, "''")}'`;
}

function linha(valores: Array<Scalar | undefined>): string {
  return `  (${valores.map(sql).join(', ')})`;
}

/**
 * INSERT multi-linha com UPSERT. `preservar` lista colunas que não devem ser
 * sobrescritas por NULL (o banco pode ter um valor melhor, vindo do admin).
 */
function upsert(
  tabela: string,
  colunas: string[],
  linhas: string[],
  conflito: string,
  preservar: string[] = [],
): string {
  const chave = conflito.split(',').map((c) => c.trim());
  const sets = colunas
    .filter((c) => !chave.includes(c))
    .map((c) =>
      preservar.includes(c)
        ? `  ${c} = COALESCE(excluded.${c}, ${tabela}.${c})`
        : `  ${c} = excluded.${c}`,
    );

  const acao = sets.length === 0 ? 'DO NOTHING' : `DO UPDATE SET\n${sets.join(',\n')}`;
  return (
    `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES\n` +
    `${linhas.join(',\n')}\n` +
    `ON CONFLICT (${conflito}) ${acao};`
  );
}

/** audio/saida/<audio_key> ou audio/saida/<arquivo>, o que existir. */
function duracaoLocal(audioKey: string | null): number | null {
  if (!audioKey) return null;
  for (const candidato of [audioKey, basename(audioKey)]) {
    const caminho = resolve(RAIZ, 'audio', 'saida', candidato);
    if (existsSync(caminho)) return mp3DurationSeconds(caminho);
  }
  return null;
}

/** Monta o índice de conteúdo e checa as três fontes. Lança com todos os erros juntos. */
export function conferirFontes(
  jornada: SeedJornada,
  produtos: SeedProdutos,
  catalogo: Catalogo,
): Map<string, Conteudo> {
  const erros: string[] = [];
  const conteudo = new Map<string, Conteudo>();

  const registrar = (id: string, origem: string, dados: Omit<Conteudo, 'origem'>) => {
    if (conteudo.has(id)) {
      erros.push(`produto '${id}' aparece em ${conteudo.get(id)?.origem} e em ${origem}`);
      return;
    }
    conteudo.set(id, { origem, ...dados });
  };

  registrar(jornada.product.id, 'seed/jornada-19-dias.json', {
    name: jornada.product.name,
    kind: jornada.product.kind,
    description_md: null,
    notice: null,
    listed: jornada.product.listed,
  });

  for (const p of produtos.products) {
    registrar(p.id, 'seed/produtos.json', {
      name: p.name,
      kind: p.kind,
      description_md: p.description_md,
      notice: p.notice,
      listed: p.listed,
    });
  }

  const dias = jornada.lessons.map((l) => l.day);
  const esperado = Array.from({ length: jornada.program.total_days }, (_, i) => i + 1);
  if (dias.join(',') !== esperado.join(',')) {
    erros.push(`dias da jornada fora de ordem ou incompletos: ${dias.join(',')}`);
  }

  const noCatalogo = new Map<string, ItemCatalogo>();
  for (const item of catalogo.products) {
    if (noCatalogo.has(item.id)) {
      erros.push(`produto '${item.id}' duplicado em seed/catalogo.json`);
      continue;
    }
    noCatalogo.set(item.id, item);

    const dono = conteudo.get(item.id);
    if (dono) {
      // Tem conteúdo: o catálogo só pode trazer os campos comerciais.
      for (const campo of CAMPOS_DE_CONTEUDO) {
        if (item[campo] !== undefined) {
          erros.push(
            `campo '${campo}' de '${item.id}' está em duas fontes ` +
              `(${dono.origem} e seed/catalogo.json)`,
          );
        }
      }
    } else {
      // Sem conteúdo (bundle/assinatura): o catálogo é a única fonte, precisa do básico.
      for (const campo of ['name', 'kind', 'listed'] as const) {
        if (item[campo] === undefined) {
          erros.push(`'${item.id}' não tem conteúdo, então precisa de '${campo}' em seed/catalogo.json`);
        }
      }
    }
  }

  for (const id of conteudo.keys()) {
    if (!noCatalogo.has(id)) {
      erros.push(`produto '${id}' tem conteúdo mas não está em seed/catalogo.json (sem preço nem ordem)`);
    }
  }

  for (const [paytCode, productId] of Object.entries(catalogo.payt_map ?? {})) {
    if (!noCatalogo.has(productId)) {
      erros.push(`payt_map '${paytCode}' aponta para '${productId}', que não está no catálogo`);
    }
  }

  for (const p of produtos.products) {
    const bundle = noCatalogo.get(p.bundle_id);
    if (!bundle) {
      erros.push(`bundle_id '${p.bundle_id}' (de '${p.id}') não existe em seed/catalogo.json`);
      continue;
    }
    // O kind pode vir do conteúdo (produto com arquivo) ou do catálogo (bundle/assinatura).
    const kind = conteudo.get(p.bundle_id)?.kind ?? bundle.kind;
    if (kind !== 'bundle') {
      erros.push(`bundle_id '${p.bundle_id}' (de '${p.id}') aponta para um produto kind='${kind}'`);
    }
  }

  const programas = [jornada.program, ...produtos.programs];
  for (const p of programas) {
    if (!noCatalogo.has(p.product_id)) {
      erros.push(`program '${p.id}' aponta para o produto '${p.product_id}', que não está no catálogo`);
    }
  }

  const licoes = [...jornada.lessons, ...produtos.lessons];
  const vistos = new Set<string>();
  for (const l of licoes) {
    if (vistos.has(l.id)) erros.push(`lição '${l.id}' duplicada`);
    vistos.add(l.id);
  }

  if (erros.length > 0) {
    throw new Error(`seed inconsistente:\n- ${erros.join('\n- ')}`);
  }

  return conteudo;
}

export function gerarSeedSql(): { sql: string; comDuracao: number; semDuracao: string[] } {
  const jornada = lerJson<SeedJornada>('seed/jornada-19-dias.json');
  const produtos = lerJson<SeedProdutos>('seed/produtos.json');
  const catalogo = lerJson<Catalogo>('seed/catalogo.json');

  const conteudo = conferirFontes(jornada, produtos, catalogo);

  const ordenados = [...catalogo.products].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const linhasProdutos = ordenados.map((item) => {
    const dono = conteudo.get(item.id);
    return linha([
      item.id,
      dono?.name ?? item.name ?? null,
      dono?.kind ?? item.kind ?? null,
      dono?.description_md ?? item.description_md ?? null,
      dono?.notice ?? item.notice ?? null,
      item.price_cents ?? null,
      item.checkout_url ?? null,
      item.requires_subscription ?? 0,
      dono?.listed ?? item.listed ?? 1,
      item.sort ?? 0,
    ]);
  });

  const sqlProdutos = upsert(
    'products',
    [
      'id',
      'name',
      'kind',
      'description_md',
      'notice',
      'price_cents',
      'checkout_url',
      'requires_subscription',
      'listed',
      'sort',
    ],
    linhasProdutos,
    'id',
    ['checkout_url'],
  );

  const sqlProgramas = upsert(
    'programs',
    ['id', 'product_id', 'title', 'unlock_rule', 'total_days', 'available_from'],
    [jornada.program, ...produtos.programs].map((p) =>
      linha([p.id, p.product_id, p.title, p.unlock_rule, p.total_days, null]),
    ),
    'id',
    ['available_from'],
  );

  const semDuracao: string[] = [];
  let comDuracao = 0;

  const medir = (id: string, audioKey: string | null): number | null => {
    const duracao = duracaoLocal(audioKey);
    if (duracao === null) {
      if (audioKey) semDuracao.push(id);
      return null;
    }
    comDuracao += 1;
    return duracao;
  };

  const licoesJornada = jornada.lessons.map((l) => {
    const bonus = l.day === BONUS.day;
    return linha([
      l.id,
      l.program_id,
      l.day,
      l.title,
      null, // summary: a jornada não tem resumo por dia
      l.body_md,
      l.audio_key,
      medir(l.id, l.audio_key),
      l.push_text,
      bonus ? BONUS.audio_key : null,
      bonus ? BONUS.title : null,
    ]);
  });

  const licoesProdutos = produtos.lessons.map((l) =>
    linha([
      l.id,
      l.program_id,
      l.day,
      l.title,
      l.summary,
      l.body_md,
      l.audio_key,
      medir(l.id, l.audio_key),
      null, // push_text: só a jornada tem push por dia
      null,
      null,
    ]),
  );

  const sqlLicoes = upsert(
    'lessons',
    [
      'id',
      'program_id',
      'day',
      'title',
      'summary',
      'body_md',
      'audio_key',
      'duration_s',
      'push_text',
      'bonus_audio_key',
      'bonus_title',
    ],
    [...licoesJornada, ...licoesProdutos],
    'id',
    ['duration_s'],
  );

  const sqlItens = upsert(
    'bundle_items',
    ['bundle_id', 'product_id'],
    produtos.products.map((p) => linha([p.bundle_id, p.id])),
    'bundle_id, product_id',
  );

  /*
   * Lição que sumiu do conteúdo precisa sair do banco: o UPSERT é por id, e uma
   * lição renomeada (id novo, mesmo dia) bateria na UNIQUE (program_id, day).
   * A limpeza é restrita aos programas que este seed declara e nunca encosta em
   * lição que algum usuário já concluiu — essa fica, e aí o erro de UNIQUE volta
   * de propósito, para alguém olhar.
   */
  const idsProgramas = [jornada.program.id, ...produtos.programs.map((p) => p.id)];
  const idsLicoes = [...jornada.lessons, ...produtos.lessons].map((l) => l.id);
  const sqlLimpaLicoes =
    `DELETE FROM lessons\n` +
    ` WHERE program_id IN (${idsProgramas.map(sql).join(', ')})\n` +
    `   AND id NOT IN (${idsLicoes.map(sql).join(', ')})\n` +
    `   AND id NOT IN (SELECT lesson_id FROM progress);`;

  const bundles = [...new Set(produtos.products.map((p) => p.bundle_id))];
  const pares = produtos.products.map((p) => `${p.bundle_id}|${p.id}`);
  const sqlLimpaItens =
    `DELETE FROM bundle_items\n` +
    ` WHERE bundle_id IN (${bundles.map(sql).join(', ')})\n` +
    `   AND bundle_id || '|' || product_id NOT IN (${pares.map(sql).join(', ')});`;

  /*
   * product_payt_map: só UPSERT, nunca limpeza do que não está declarado. Staging
   * tem um mapeamento cadastrado à mão (produto de teste que não é nosso) e uma
   * limpeza o apagaria a cada seed. Mapeamento que deixou de valer sai à mão.
   */
  const entradasMap = Object.entries(catalogo.payt_map ?? {});
  const sqlPaytMap = entradasMap.length
    ? upsert(
        'product_payt_map',
        ['payt_code', 'product_id'],
        entradasMap.map(([code, produto]) => linha([code, produto])),
        'payt_code',
      )
    : null;

  const cabecalho = [
    '-- GERADO por scripts/seed-sql.ts — não editar à mão.',
    '-- Fontes: seed/jornada-19-dias.json e seed/produtos.json (gerados do conteúdo)',
    '--         + seed/catalogo.json (dados comerciais, à mão).',
    '-- Idempotente: rodar quantas vezes quiser não duplica linha.',
  ].join('\n');

  // "-- @stmt" separa os comandos: o wrangler ignora o comentário e os testes
  // usam o marcador para rodar statement a statement, sem precisar de parser.
  // Ordem importa: programa antes da lição (FK) e limpeza antes do insert (UNIQUE).
  const corpo = [
    sqlProdutos,
    sqlProgramas,
    sqlLimpaLicoes,
    sqlLicoes,
    sqlLimpaItens,
    sqlItens,
    ...(sqlPaytMap ? [sqlPaytMap] : []),
  ].join('\n\n-- @stmt\n\n');

  return { sql: `${cabecalho}\n\n${corpo}\n`, comDuracao, semDuracao };
}

/** Só escreve o arquivo quando chamado pela linha de comando; o vitest importa `gerarSeedSql`. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destino = resolve(RAIZ, process.argv[2] ?? 'seed/seed.sql');
  const { sql: texto, comDuracao, semDuracao } = gerarSeedSql();
  writeFileSync(destino, texto, 'utf8');

  console.log(`OK: ${relative(RAIZ, destino)} (${texto.length} bytes)`);
  console.log(`Durações lidas dos MP3 locais: ${comDuracao}`);
  if (semDuracao.length > 0) {
    console.log(`Sem áudio local (duration_s preservado no banco): ${semDuracao.length} lição(ões)`);
    console.log(`  ${semDuracao.join(', ')}`);
  }
}
