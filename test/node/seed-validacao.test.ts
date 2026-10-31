import { describe, expect, it } from 'vitest';
import {
  type Catalogo,
  conferirFontes,
  gerarSeedSql,
  type SeedJornada,
  type SeedProdutos,
} from '../../scripts/seed-sql.ts';

/** Três fontes mínimas e coerentes; cada teste quebra uma coisa só. */
function fontes(): { jornada: SeedJornada; produtos: SeedProdutos; catalogo: Catalogo } {
  return {
    jornada: {
      product: { id: 'jornada-meu-anjo', name: 'Jornada', kind: 'program', listed: 0 },
      program: {
        id: 'jornada-19',
        product_id: 'jornada-meu-anjo',
        title: 'Jornada',
        unlock_rule: 'daily',
        total_days: 1,
      },
      lessons: [
        {
          id: 'jornada-19-d01',
          program_id: 'jornada-19',
          day: 1,
          title: 'Dia 1',
          body_md: 'texto',
          push_text: 'push',
          audio_key: 'jornada/d01.mp3',
        },
      ],
    },
    produtos: {
      products: [
        {
          id: 'oracao-gargano',
          name: 'Oração de Gargano',
          kind: 'program',
          description_md: 'descrição',
          notice: null,
          listed: 0,
          bundle_id: 'oracao-sao-miguel',
        },
      ],
      programs: [
        {
          id: 'oracao-gargano',
          product_id: 'oracao-gargano',
          title: 'Oração de Gargano',
          unlock_rule: 'all',
          total_days: 1,
        },
      ],
      lessons: [
        {
          id: 'oracao-gargano-l01',
          program_id: 'oracao-gargano',
          day: 1,
          title: 'Lição 1',
          summary: 'resumo',
          body_md: 'texto',
          audio_key: null,
        },
      ],
    },
    catalogo: {
      products: [
        { id: 'jornada-meu-anjo', price_cents: 9700, sort: 10 },
        { id: 'oracao-gargano', price_cents: null, sort: 90 },
        {
          id: 'oracao-sao-miguel',
          name: 'Oração de São Miguel',
          kind: 'bundle',
          listed: 1,
          price_cents: 19700,
          sort: 20,
        },
      ],
    },
  };
}

describe('conferirFontes', () => {
  it('aceita as três fontes coerentes', () => {
    const { jornada, produtos, catalogo } = fontes();
    const conteudo = conferirFontes(jornada, produtos, catalogo);

    expect([...conteudo.keys()].sort()).toEqual(['jornada-meu-anjo', 'oracao-gargano']);
    expect(conteudo.get('oracao-gargano')?.origem).toBe('seed/produtos.json');
  });

  it('recusa o mesmo campo em duas fontes', () => {
    const { jornada, produtos, catalogo } = fontes();
    // 'name' é do produtos.json; repetir no catálogo é o erro que queremos pegar.
    catalogo.products[1]!.name = 'Oração de Gargano';

    expect(() => conferirFontes(jornada, produtos, catalogo)).toThrow(
      /campo 'name' de 'oracao-gargano' está em duas fontes/,
    );
  });

  it('recusa campo de conteúdo repetido também para a jornada', () => {
    const { jornada, produtos, catalogo } = fontes();
    catalogo.products[0]!.listed = 1;

    expect(() => conferirFontes(jornada, produtos, catalogo)).toThrow(
      /campo 'listed' de 'jornada-meu-anjo' está em duas fontes/,
    );
  });

  it('recusa bundle_id que não existe no catálogo', () => {
    const { jornada, produtos, catalogo } = fontes();
    produtos.products[0]!.bundle_id = 'bundle-que-nao-existe';

    expect(() => conferirFontes(jornada, produtos, catalogo)).toThrow(
      /bundle_id 'bundle-que-nao-existe' \(de 'oracao-gargano'\) não existe em seed\/catalogo\.json/,
    );
  });

  /*
   * Produto avulso, fora de bundle (o bônus `presentes-sao-miguel`, 30/10). O
   * `bundle_id: null` virava a string 'null' na busca do catálogo e derrubava o
   * seed inteiro — e com ele o `npm test`, que monta o seed na config.
   */
  it('aceita produto avulso, com bundle_id null', () => {
    const { jornada, produtos, catalogo } = fontes();
    produtos.products[0]!.bundle_id = null;

    expect(() => conferirFontes(jornada, produtos, catalogo)).not.toThrow();
  });

  it('produto avulso ainda precisa estar no catálogo', () => {
    const { jornada, produtos, catalogo } = fontes();
    produtos.products[0]!.bundle_id = null;
    catalogo.products.splice(1, 1);

    expect(() => conferirFontes(jornada, produtos, catalogo)).toThrow(
      /produto 'oracao-gargano' tem conteúdo mas não está em seed\/catalogo\.json/,
    );
  });

  it('o seed de verdade gera produto avulso sem linha em bundle_items', () => {
    const { sql } = gerarSeedSql();
    const itens = sql.slice(sql.indexOf('INSERT INTO bundle_items'));
    const fimItens = itens.indexOf(';');

    expect(sql).toContain("'presentes-sao-miguel'");
    expect(itens.slice(0, fimItens)).not.toContain('presentes-sao-miguel');
    expect(itens.slice(0, fimItens)).not.toMatch(/\bNULL\b/);
  });

  it('recusa bundle_id que aponta para algo que não é bundle', () => {
    const { jornada, produtos, catalogo } = fontes();
    produtos.products[0]!.bundle_id = 'jornada-meu-anjo';

    expect(() => conferirFontes(jornada, produtos, catalogo)).toThrow(
      /aponta para um produto kind='program'/,
    );
  });

  it('recusa produto com conteúdo que ficou de fora do catálogo', () => {
    const { jornada, produtos, catalogo } = fontes();
    catalogo.products = catalogo.products.filter((p) => p.id !== 'oracao-gargano');

    expect(() => conferirFontes(jornada, produtos, catalogo)).toThrow(
      /produto 'oracao-gargano' tem conteúdo mas não está em seed\/catalogo\.json/,
    );
  });

  it('exige nome e tipo para bundle, que não tem arquivo de conteúdo', () => {
    const { jornada, produtos, catalogo } = fontes();
    delete catalogo.products[2]!.name;

    expect(() => conferirFontes(jornada, produtos, catalogo)).toThrow(
      /'oracao-sao-miguel' não tem conteúdo, então precisa de 'name'/,
    );
  });

  it('recusa lição duplicada entre as fontes', () => {
    const { jornada, produtos, catalogo } = fontes();
    produtos.lessons[0]!.id = 'jornada-19-d01';

    expect(() => conferirFontes(jornada, produtos, catalogo)).toThrow(/lição 'jornada-19-d01' duplicada/);
  });

  it('junta todos os erros numa mensagem só', () => {
    const { jornada, produtos, catalogo } = fontes();
    catalogo.products[1]!.name = 'repetido';
    produtos.products[0]!.bundle_id = 'inexistente';

    try {
      conferirFontes(jornada, produtos, catalogo);
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      const msg = (erro as Error).message;
      expect(msg).toContain('seed inconsistente:');
      expect(msg).toContain("campo 'name'");
      expect(msg).toContain('bundle_id');
    }
  });
});
