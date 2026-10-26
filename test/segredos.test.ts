import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { chaveAdminConfere } from '../src/worker/lib/admin';
import { segredo } from '../src/worker/lib/segredos';
import { envTeste } from './env-de-teste';

/**
 * Todo segredo passa por um leitor só (CLAUDE.md §15).
 *
 * `wrangler secret put` recebendo o valor por pipe no PowerShell grava UTF-8 com
 * BOM. Já derrubou o `VAPID_PUBLIC_KEY` do staging; a `ADMIN_API_KEY`, a
 * `CAMPAIGN_SIGNING_KEY` e o par VAPID dos dois ambientes foram gravados do
 * mesmo jeito, então a limpeza não pode ficar só no caminho do push.
 */
const BOM = '﻿';

describe('segredo()', () => {
  it('tira o BOM do começo', () => {
    expect(segredo({ ADMIN_API_KEY: `${BOM}abc123` }, 'ADMIN_API_KEY')).toBe('abc123');
  });

  it('tira espaço e quebra de linha das pontas', () => {
    expect(segredo({ ADMIN_API_KEY: '  abc123\n' }, 'ADMIN_API_KEY')).toBe('abc123');
    expect(segredo({ ADMIN_API_KEY: 'abc123\r\n' }, 'ADMIN_API_KEY')).toBe('abc123');
  });

  it('segredo ausente ou só de espaço vira string vazia', () => {
    expect(segredo({}, 'ADMIN_API_KEY')).toBe('');
    expect(segredo({ ADMIN_API_KEY: '   ' }, 'ADMIN_API_KEY')).toBe('');
    expect(segredo({ ADMIN_API_KEY: BOM }, 'ADMIN_API_KEY')).toBe('');
  });

  it('não mexe no meio do valor', () => {
    // Segredo pode ter qualquer caractere: só as pontas são sujeira de gravação.
    expect(segredo({ CAMPAIGN_SIGNING_KEY: 'a b c' }, 'CAMPAIGN_SIGNING_KEY')).toBe('a b c');
  });
});

describe('chave de admin com segredo sujo', () => {
  const limpa = envTeste.ADMIN_API_KEY ?? '';

  it('confere mesmo que o secret tenha nascido com BOM', () => {
    expect(chaveAdminConfere(limpa, { ...envTeste, ADMIN_API_KEY: `${BOM}${limpa}` })).toBe(true);
    expect(chaveAdminConfere(limpa, { ...envTeste, ADMIN_API_KEY: `${limpa}\n` })).toBe(true);
  });

  it('chave errada continua errada', () => {
    expect(chaveAdminConfere('outra', { ...envTeste, ADMIN_API_KEY: `${BOM}${limpa}` })).toBe(false);
  });

  it('sem segredo cadastrado, nada confere — nem string vazia', () => {
    expect(chaveAdminConfere('', { ...envTeste, ADMIN_API_KEY: undefined })).toBe(false);
    expect(chaveAdminConfere('', { ...envTeste, ADMIN_API_KEY: BOM })).toBe(false);
  });
});

describe('a rota administrativa aceita o segredo sujo', () => {
  it('excluir-conta responde com a chave limpa no header', async () => {
    const { default: app } = await import('../src/worker/index');
    const limpa = envTeste.ADMIN_API_KEY ?? '';

    const res = await app.request(
      'https://exemplo.test/api/admin/excluir-conta',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': limpa },
        body: JSON.stringify({ email: 'ninguem@exemplo.test' }),
      },
      { ...envTeste, DB: env.DB, ADMIN_API_KEY: `${BOM}${limpa}` },
    );

    // O que importa é não ser 403: a conta não existe, então 404 é o certo.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
