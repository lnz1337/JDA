import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { envTeste } from './env-de-teste';

/**
 * O retrato do par VAPID (CLAUDE.md §15). Segredo do wrangler não se lê de
 * volta: esta rota é como se confere, em produção, que o que foi gravado passa
 * pela leitura — sem que nenhum caractere da chave saia na resposta.
 */
const BOM = String.fromCharCode(0xfeff);

async function retrato(sobrescrever: Partial<typeof envTeste> = {}, chave = envTeste.ADMIN_API_KEY ?? '') {
  const ctx = createExecutionContext();
  const res = await app.request(
    'https://exemplo.test/api/admin/vapid',
    { headers: { 'x-admin-key': chave } },
    { ...envTeste, ...sobrescrever },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('GET /api/admin/vapid', () => {
  it('exige a chave administrativa', async () => {
    expect((await retrato({}, 'errada')).status).toBe(401);
  });

  it('par limpo e válido', async () => {
    const r = (await (await retrato()).json()) as Record<string, any>;
    expect(r.ok).toBe(true);
    expect(r.par_confere).toBe(true);
    expect(r.publica).toMatchObject({ bruto: 87, lido: 87, tinha_bom: false, ponto_p256: true });
    expect(r.privada).toMatchObject({ bruto: 43, lido: 43, tinha_bom: false, tamanho_ok: true });
  });

  it('acusa o BOM gravado e mostra que a leitura limpa', async () => {
    const r = (await (
      await retrato({
        VAPID_PUBLIC_KEY: `${BOM}${envTeste.VAPID_PUBLIC_KEY}`,
        VAPID_PRIVATE_KEY: `${BOM}${envTeste.VAPID_PRIVATE_KEY}`,
        VAPID_SUBJECT: `${BOM}${envTeste.VAPID_SUBJECT}`,
      })
    ).json()) as Record<string, any>;

    // Foi assim que o staging nasceu: 88 caracteres em vez de 87.
    expect(r.publica).toMatchObject({ bruto: 88, lido: 87, tinha_bom: true });
    expect(r.privada.tinha_bom).toBe(true);
    expect(r.assunto).toMatchObject({ tinha_bom: true, valido: true });
    expect(r.ok).toBe(true);
  });

  it('par trocado não passa', async () => {
    // Chave privada de outro par: passa em tamanho e alfabeto, e só o serviço
    // de push recusaria.
    const r = (await (
      await retrato({ VAPID_PRIVATE_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8' })
    ).json()) as Record<string, any>;
    expect(r.privada.tamanho_ok).toBe(true);
    expect(r.par_confere).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('assunto sem mailto: não passa', async () => {
    const r = (await (await retrato({ VAPID_SUBJECT: 'suporte@exemplo.test' })).json()) as Record<
      string,
      any
    >;
    expect(r.assunto.valido).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('a resposta não carrega a chave', async () => {
    const texto = await (await retrato()).text();
    expect(texto).not.toContain((envTeste.VAPID_PUBLIC_KEY ?? 'x').slice(0, 12));
    expect(texto).not.toContain((envTeste.VAPID_PRIVATE_KEY ?? 'x').slice(0, 12));
    expect(texto).not.toContain('exemplo.test');
  });
});
