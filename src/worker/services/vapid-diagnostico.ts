/**
 * O retrato do par VAPID de um ambiente, **sem os valores** (CLAUDE.md §11, §15).
 *
 * Segredo do wrangler não se lê de volta. O de staging nasceu com BOM pelo pipe
 * do PowerShell, e o de produção foi gravado do mesmo jeito; sem este retrato, a
 * única prova de que a leitura limpa o que precisa era um iPhone recebendo push.
 *
 * Devolve só tamanho, se havia sujeira nas pontas e se o que sobra é válido:
 * nenhum caractere da chave sai daqui.
 */
import { segredo } from '../lib/segredos';
import type { AppBindings } from '../lib/types';
import { assuntoVapidValido } from './push';

type Ambiente = AppBindings['Bindings'];

const BOM = '\uFEFF';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function bytesDe(base64url: string): Uint8Array | null {
  if (!BASE64URL.test(base64url)) return null;
  try {
    const b64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function paraBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function sujeira(bruto: string, lido: string) {
  return { bruto: bruto.length, lido: lido.length, tinha_bom: bruto.includes(BOM) };
}

/**
 * A privada é do mesmo par da pública? Assina com uma e confere com a outra.
 * Par trocado passa em todas as outras checagens e só falha no serviço de push.
 */
async function parConfere(publica: Uint8Array, privada: string): Promise<boolean> {
  try {
    const jwk: JsonWebKey = {
      kty: 'EC',
      crv: 'P-256',
      d: privada,
      x: paraBase64url(publica.slice(1, 33)),
      y: paraBase64url(publica.slice(33, 65)),
    };
    const alg = { name: 'ECDSA', namedCurve: 'P-256' };
    const assinar = await crypto.subtle.importKey('jwk', jwk, alg, false, ['sign']);
    const conferir = await crypto.subtle.importKey('raw', publica, alg, false, ['verify']);

    const dado = new TextEncoder().encode('vapid');
    const hash = { name: 'ECDSA', hash: 'SHA-256' };
    const assinatura = await crypto.subtle.sign(hash, assinar, dado);
    return await crypto.subtle.verify(hash, conferir, assinatura, dado);
  } catch {
    return false;
  }
}

export async function diagnosticoVapid(env: Ambiente) {
  const brutos = {
    publica: String(env.VAPID_PUBLIC_KEY ?? ''),
    privada: String(env.VAPID_PRIVATE_KEY ?? ''),
    assunto: String(env.VAPID_SUBJECT ?? ''),
  };
  const lidos = {
    publica: segredo(env, 'VAPID_PUBLIC_KEY'),
    privada: segredo(env, 'VAPID_PRIVATE_KEY'),
    assunto: segredo(env, 'VAPID_SUBJECT'),
  };

  const publica = bytesDe(lidos.publica);
  // Ponto P-256 sem compressão: 65 bytes começando em 0x04.
  const pontoValido = publica !== null && publica.length === 65 && publica[0] === 4;
  const privada = bytesDe(lidos.privada);
  const privadaValida = privada !== null && privada.length === 32;

  const relatorio = {
    publica: { ...sujeira(brutos.publica, lidos.publica), ponto_p256: pontoValido },
    privada: { ...sujeira(brutos.privada, lidos.privada), tamanho_ok: privadaValida },
    assunto: { ...sujeira(brutos.assunto, lidos.assunto), valido: assuntoVapidValido(lidos.assunto) },
    par_confere: pontoValido && privadaValida ? await parConfere(publica, lidos.privada) : false,
  };

  return {
    ...relatorio,
    ok:
      relatorio.publica.ponto_p256 &&
      relatorio.privada.tamanho_ok &&
      relatorio.assunto.valido &&
      relatorio.par_confere,
  };
}
