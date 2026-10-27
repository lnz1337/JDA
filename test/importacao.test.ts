import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  emailValido,
  planejar,
  produtoDaVenda,
  provedorDoEmail,
  sqlDaImportacao,
  type Venda,
} from '../scripts/lib/importacao';
import { prepararBanco } from './ajuda';

/**
 * A importação da base (lançamento, etapa 5). O SQL roda aqui num D1 de verdade:
 * é onde um erro de sintaxe ou de conflito aparece antes de produção.
 */
const AGORA = '2026-10-27T18:00:00.000Z';

let contador = 0;
const novoId = () => `id-${++contador}`;

function venda(parcial: Partial<Venda> & { produto: string }): Venda & { produto: string } {
  return {
    email: 'maria@exemplo.com.br',
    nome: 'Maria Souza',
    telefone: '11987654321',
    transacao: 'TRX1',
    sku: '',
    produtoCodigo: '',
    produtoNome: '',
    status: 'pagamento aprovado',
    data: '2026-10-20T12:00:00.000Z',
    ...parcial,
  };
}

async function aplicar(vendas: Array<Venda & { produto: string }>) {
  for (const comando of sqlDaImportacao(planejar(vendas, AGORA), AGORA, novoId)) {
    await env.DB.prepare(comando).run();
  }
}

async function concessoes(): Promise<Array<{ email: string; product_id: string; status: string; granted_at: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT u.email, e.product_id, e.status, e.granted_at
       FROM entitlements e JOIN users u ON u.id = e.user_id
      ORDER BY u.email, e.product_id`,
  ).all<{ email: string; product_id: string; status: string; granted_at: string }>();
  return results;
}

beforeEach(prepararBanco);

describe('produto da venda', () => {
  const mapas = {
    porSku: new Map([['853b4781f48478', 'jornada-meu-anjo']]),
    porCodigo: new Map([['RAO7YD', 'jornada-cura-padre-pio']]),
  };

  it('pelo sku do relatório, com prefixo', () => {
    expect(produtoDaVenda(venda({ produto: '', sku: '6a44473d38700-853b4781f48478' }), mapas)).toBe(
      'jornada-meu-anjo',
    );
  });

  it('sem sku conhecido, pelo code', () => {
    expect(produtoDaVenda(venda({ produto: '', sku: 'x-desconhecido', produtoCodigo: 'RAO7YD' }), mapas)).toBe(
      'jornada-cura-padre-pio',
    );
  });

  it('sem nenhum dos dois, null', () => {
    expect(produtoDaVenda(venda({ produto: '', sku: '69e8aef5921d9-5b7ad449bacac8' }), mapas)).toBeNull();
  });
});

describe('e-mail e provedor', () => {
  it('recusa vazio, sem domínio e o @fake da Payt', () => {
    expect(emailValido('maria@exemplo.com.br')).toBe(true);
    for (const e of ['', 'maria', 'maria@', 'maria@exemplo', 'a b@exemplo.com', '123@fake.payt.com']) {
      expect(emailValido(e)).toBe(false);
    }
  });

  it('agrupa pelos domínios da campanha', () => {
    expect(provedorDoEmail('a@gmail.com')).toBe('gmail');
    expect(provedorDoEmail('a@hotmail.com')).toBe('outlook');
    expect(provedorDoEmail('a@empresa.com.br')).toBe('outros');
  });
});

describe('planejar', () => {
  it('um usuário por e-mail, uma concessão por compra', () => {
    const plano = planejar(
      [
        venda({ produto: 'jornada-meu-anjo', transacao: 'A' }),
        venda({ produto: 'oracao-sao-miguel', transacao: 'B', nome: '' }),
        venda({ produto: 'jornada-meu-anjo', transacao: 'A' }),
      ],
      AGORA,
    );
    expect(plano.usuarios).toHaveLength(1);
    expect(plano.usuarios[0]?.nome).toBe('Maria Souza');
    expect(plano.concessoes).toHaveLength(2);
  });

  it('sem data, a concessão leva o horário da importação', () => {
    const plano = planejar([venda({ produto: 'jornada-meu-anjo', data: null })], AGORA);
    expect(plano.concessoes[0]?.quando).toBe(AGORA);
  });
});

describe('SQL da importação', () => {
  it('cria usuários e concessões com a data da venda', async () => {
    await aplicar([
      venda({ produto: 'jornada-meu-anjo', transacao: 'A' }),
      venda({ produto: 'oracao-sao-miguel', transacao: 'B', data: '2026-10-21T12:00:00.000Z' }),
      venda({ email: 'jose@exemplo.com.br', produto: 'jornada-meu-anjo', transacao: 'C' }),
    ]);

    expect(await concessoes()).toEqual([
      { email: 'jose@exemplo.com.br', product_id: 'jornada-meu-anjo', status: 'active', granted_at: '2026-10-20T12:00:00.000Z' },
      { email: 'maria@exemplo.com.br', product_id: 'jornada-meu-anjo', status: 'active', granted_at: '2026-10-20T12:00:00.000Z' },
      { email: 'maria@exemplo.com.br', product_id: 'oracao-sao-miguel', status: 'active', granted_at: '2026-10-21T12:00:00.000Z' },
    ]);
  });

  it('rodar de novo não duplica nada', async () => {
    const vendas = [venda({ produto: 'jornada-meu-anjo', transacao: 'A' })];
    await aplicar(vendas);
    await aplicar(vendas);

    const n = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM users) AS u, (SELECT COUNT(*) FROM entitlements) AS e',
    ).first<{ u: number; e: number }>();
    expect(n).toEqual({ u: 1, e: 1 });
  });

  it('não reativa acesso que o postback revogou depois da exportação', async () => {
    await aplicar([venda({ produto: 'jornada-meu-anjo', transacao: 'A' })]);
    await env.DB.prepare("UPDATE entitlements SET status = 'revoked', revoked_at = ?").bind(AGORA).run();

    // Relatório velho ainda diz "aprovado".
    await aplicar([venda({ produto: 'jornada-meu-anjo', transacao: 'A' })]);
    expect((await concessoes())[0]?.status).toBe('revoked');
  });

  it('usuário existente mantém id, nome e telefone', async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, phone, name, created_at) VALUES ('u-leo', 'maria@exemplo.com.br', NULL, 'Maria Antiga', ?)",
    )
      .bind(AGORA)
      .run();

    await aplicar([venda({ produto: 'jornada-meu-anjo', transacao: 'A' })]);

    const u = await env.DB.prepare('SELECT id, name, phone FROM users').first<{ id: string; name: string; phone: string }>();
    // Nome que já existia fica; telefone vazio é preenchido.
    expect(u).toEqual({ id: 'u-leo', name: 'Maria Antiga', phone: '11987654321' });
    expect(await concessoes()).toHaveLength(1);
  });

  it('nome com aspas não quebra o SQL', async () => {
    await aplicar([venda({ produto: 'jornada-meu-anjo', nome: "Joana D'Arc" })]);
    const u = await env.DB.prepare('SELECT name FROM users').first<{ name: string }>();
    expect(u?.name).toBe("Joana D'Arc");
  });

  it('em lotes: mais de cem vendas', async () => {
    const vendas = Array.from({ length: 250 }, (_, i) =>
      venda({ email: `p${i}@exemplo.com.br`, produto: 'jornada-meu-anjo', transacao: `T${i}` }),
    );
    const comandos = sqlDaImportacao(planejar(vendas, AGORA), AGORA, novoId);
    expect(comandos).toHaveLength(6);

    await aplicar(vendas);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM entitlements').first<{ n: number }>();
    expect(n?.n).toBe(250);
  });
});
