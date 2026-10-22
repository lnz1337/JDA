import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { aplicarSeed, comandosDoSeed, limparBanco } from './ajuda';
import { envTeste } from './env-de-teste';

async function contagens(): Promise<Record<string, number>> {
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM products) AS products,
       (SELECT COUNT(*) FROM programs) AS programs,
       (SELECT COUNT(*) FROM lessons) AS lessons,
       (SELECT COUNT(*) FROM bundle_items) AS bundle_items,
       (SELECT COUNT(*) FROM product_payt_map) AS payt_map`,
  ).first<Record<string, number>>();
  return r ?? {};
}

beforeEach(limparBanco);

describe('seed', () => {
  it('gera sete comandos: products, programs, limpa+insere lessons e bundle_items, payt_map', () => {
    expect(comandosDoSeed(envTeste.TEST_SEED_SQL)).toHaveLength(7);
  });

  it('rodado duas vezes não duplica nada', async () => {
    await aplicarSeed();
    const primeira = await contagens();

    expect(primeira).toEqual({
      products: 10,
      programs: 6,
      lessons: 41,
      bundle_items: 5,
      payt_map: 1,
    });

    await aplicarSeed();
    const segunda = await contagens();

    expect(segunda).toEqual(primeira);
  });

  it('atualiza em vez de duplicar quando o conteúdo muda', async () => {
    await aplicarSeed();
    await env.DB.prepare("UPDATE lessons SET title = 'rascunho' WHERE id = 'jornada-19-d01'").run();

    await aplicarSeed();

    const linhas = await env.DB.prepare(
      "SELECT title FROM lessons WHERE id = 'jornada-19-d01'",
    ).all<{ title: string }>();

    expect(linhas.results).toHaveLength(1);
    expect(linhas.results[0]?.title).not.toBe('rascunho');
  });

  it('cria as 19 lições da jornada com push_text preenchido', async () => {
    await aplicarSeed();

    const { results } = await env.DB.prepare(
      `SELECT day, push_text, audio_key, duration_s
         FROM lessons WHERE program_id = 'jornada-19' ORDER BY day`,
    ).all<{ day: number; push_text: string | null; audio_key: string; duration_s: number | null }>();

    expect(results).toHaveLength(19);
    expect(results.map((l) => l.day)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));

    for (const licao of results) {
      expect(licao.push_text, `dia ${licao.day} sem push_text`).toBeTruthy();
      expect(licao.audio_key).toBe(`jornada/d${String(licao.day).padStart(2, '0')}.mp3`);
    }
  });

  it('põe o hino como faixa extra só no dia 19', async () => {
    await aplicarSeed();

    const { results } = await env.DB.prepare(
      `SELECT day, bonus_audio_key, bonus_title
         FROM lessons WHERE program_id = 'jornada-19' AND bonus_audio_key IS NOT NULL`,
    ).all<{ day: number; bonus_audio_key: string; bonus_title: string }>();

    expect(results).toEqual([
      { day: 19, bonus_audio_key: 'jornada/hino-sao-miguel.mp3', bonus_title: 'Hino de São Miguel' },
    ]);
  });

  it('monta os bundles do funil com itens que existem', async () => {
    await aplicarSeed();

    const { results } = await env.DB.prepare(
      `SELECT b.bundle_id, b.product_id, p.kind, p.listed
         FROM bundle_items b JOIN products p ON p.id = b.product_id
        ORDER BY b.bundle_id, b.product_id`,
    ).all<{ bundle_id: string; product_id: string; kind: string; listed: number }>();

    expect(results.map((r) => `${r.bundle_id}/${r.product_id}`)).toEqual([
      'jornada-cura-padre-pio/jornada-cura',
      'jornada-cura-padre-pio/limpeza-anjos',
      'oracao-sao-miguel/manual-purificacao',
      'oracao-sao-miguel/mapa-prosperidade',
      'oracao-sao-miguel/oracao-gargano',
    ]);

    // Item de bundle é sempre program e nunca aparece solto na loja.
    for (const item of results) {
      expect(item.kind).toBe('program');
      expect(item.listed).toBe(0);
    }
  });

  it('traz as 22 lições dos itens de bundle com resumo', async () => {
    await aplicarSeed();

    const { results } = await env.DB.prepare(
      `SELECT program_id, COUNT(*) AS total, SUM(summary IS NOT NULL) AS com_resumo
         FROM lessons WHERE program_id != 'jornada-19'
        GROUP BY program_id ORDER BY program_id`,
    ).all<{ program_id: string; total: number; com_resumo: number }>();

    expect(results).toEqual([
      { program_id: 'jornada-cura', total: 7, com_resumo: 7 },
      { program_id: 'limpeza-anjos', total: 4, com_resumo: 4 },
      { program_id: 'manual-purificacao', total: 4, com_resumo: 4 },
      { program_id: 'mapa-prosperidade', total: 4, com_resumo: 4 },
      { program_id: 'oracao-gargano', total: 3, com_resumo: 3 },
    ]);
  });

  it('guarda o aviso obrigatório dos produtos de saúde', async () => {
    await aplicarSeed();

    const { results } = await env.DB.prepare(
      'SELECT id FROM products WHERE notice IS NOT NULL ORDER BY id',
    ).all<{ id: string }>();

    expect(results.map((r) => r.id)).toEqual([
      'jornada-cura',
      'manual-purificacao',
      'mapa-prosperidade',
    ]);
  });

  it('tira nome e descrição dos itens do pipeline de conteúdo', async () => {
    await aplicarSeed();

    const item = await env.DB.prepare(
      "SELECT name, description_md, listed, price_cents, sort FROM products WHERE id = 'manual-purificacao'",
    ).first<{ name: string; description_md: string; listed: number; price_cents: number | null; sort: number }>();

    // name/description/listed vêm do produtos.json; price/sort vêm do catalogo.json.
    expect(item?.name).toBe('Manual de Purificação e Autocuidado');
    expect(item?.description_md).toContain('purificar a casa');
    expect(item?.listed).toBe(0);
    expect(item?.price_cents).toBeNull();
    expect(item?.sort).toBe(91);
  });

  it('mapeia o product.code real da Payt para a jornada', async () => {
    await aplicarSeed();

    const linha = await env.DB.prepare(
      "SELECT product_id FROM product_payt_map WHERE payt_code = 'RVEEJ8'",
    ).first<{ product_id: string }>();

    expect(linha?.product_id).toBe('jornada-meu-anjo');
  });

  it('não apaga mapeamento cadastrado à mão fora do seed', async () => {
    // Staging tem o código de um produto de teste mapeado à mão. Uma limpeza de
    // "o que não está declarado" apagaria isso a cada seed — por isso não existe.
    await aplicarSeed();
    await env.DB.prepare(
      "INSERT INTO product_payt_map (payt_code, product_id) VALUES ('LJ7KEP', 'jornada-meu-anjo')",
    ).run();

    await aplicarSeed();

    const { results } = await env.DB.prepare(
      'SELECT payt_code FROM product_payt_map ORDER BY payt_code',
    ).all<{ payt_code: string }>();
    expect(results.map((r) => r.payt_code)).toEqual(['LJ7KEP', 'RVEEJ8']);
  });

  it('cadastra os preços do funil em centavos', async () => {
    await aplicarSeed();

    const { results } = await env.DB.prepare(
      `SELECT id, kind, price_cents, listed FROM products WHERE price_cents IS NOT NULL ORDER BY sort`,
    ).all<{ id: string; kind: string; price_cents: number; listed: number }>();

    expect(results).toEqual([
      { id: 'jornada-meu-anjo', kind: 'program', price_cents: 9700, listed: 0 },
      { id: 'oracao-sao-miguel', kind: 'bundle', price_cents: 19700, listed: 1 },
      { id: 'jornada-cura-padre-pio', kind: 'bundle', price_cents: 9700, listed: 1 },
      { id: 'circulo-mensal', kind: 'subscription', price_cents: 2990, listed: 1 },
      { id: 'circulo-anual', kind: 'subscription', price_cents: 14700, listed: 1 },
    ]);
  });
});
