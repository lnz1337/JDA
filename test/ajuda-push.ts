/**
 * Decifrador de Web Push (RFC 8291 + RFC 8188), lado do **navegador**.
 *
 * Existe só para o teste: é o que permite conferir que o que a biblioteca cifra
 * é mesmo decifrável por quem recebe. Sem isto, um teste de push só provaria que
 * a função não explodiu — e payload cifrado errado só apareceria no celular de
 * alguém, sem mensagem de erro nenhuma.
 */

export function b64urlParaBytes(texto: string): Uint8Array {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const cru = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(cru, (c) => c.charCodeAt(0));
}

export function bytesParaB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function juntar(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    saida.set(p, i);
    i += p.length;
  }
  return saida;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bruto = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    chave,
    bits,
  );
  return new Uint8Array(bruto);
}

export interface ChavesDoNavegador {
  /** Chave pública do navegador, 65 bytes (formato não comprimido). */
  p256dh: Uint8Array;
  /** `d` da chave privada, em base64url. */
  privadaD: string;
  /** Segredo de autenticação da assinatura, 16 bytes. */
  auth: Uint8Array;
}

/**
 * Desfaz o `aes128gcm` de um corpo de push e devolve o texto.
 *
 * Cabeçalho (RFC 8188 §2.1): salt(16) | rs(4) | idlen(1) | keyid(idlen), e aqui
 * o `keyid` é a chave pública efêmera de quem enviou (RFC 8291 §4).
 */
export async function decifrarPush(
  corpo: Uint8Array,
  chaves: ChavesDoNavegador,
): Promise<string> {
  const salt = corpo.slice(0, 16);
  const idlen = corpo[20] ?? 0;
  const remetente = corpo.slice(21, 21 + idlen);
  const cifrado = corpo.slice(21 + idlen);

  const privada = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesParaB64url(chaves.p256dh.slice(1, 33)),
      y: bytesParaB64url(chaves.p256dh.slice(33, 65)),
      d: chaves.privadaD,
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

  const publicaRemetente = await crypto.subtle.importKey(
    'raw',
    remetente as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const segredo = new Uint8Array(
    // O tipo do workerd chama o campo de `$public`; o algoritmo é o mesmo.
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: publicaRemetente } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      privada,
      256,
    ),
  );

  // RFC 8291 §3.4: o segredo de autenticação é o sal desta primeira derivação.
  const ikm = await hkdf(
    segredo,
    chaves.auth,
    juntar(utf8('WebPush: info'), new Uint8Array([0]), chaves.p256dh, remetente),
    256,
  );

  // RFC 8188 §2.2: daqui saem a chave e o nonce do registro.
  const cek = await hkdf(ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(ikm, salt, utf8('Content-Encoding: nonce\0'), 96);

  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'decrypt',
  ]);
  const claro = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      aes,
      cifrado as BufferSource,
    ),
  );

  // O texto termina em 0x02 (último registro) seguido de zeros de enchimento.
  let fim = claro.length - 1;
  while (fim >= 0 && claro[fim] === 0) fim -= 1;
  if (claro[fim] !== 2) throw new Error(`delimitador inesperado: ${claro[fim]}`);

  return new TextDecoder().decode(claro.slice(0, fim));
}

/** Par de chaves VAPID novo, no formato que a biblioteca espera (base64url). */
export async function gerarVapid(): Promise<{ publicKey: string; privateKey: string }> {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  const publica = new Uint8Array(
    (await crypto.subtle.exportKey('raw', par.publicKey)) as ArrayBuffer,
  );
  const jwk = (await crypto.subtle.exportKey('jwk', par.privateKey)) as JsonWebKey;

  return { publicKey: bytesParaB64url(publica), privateKey: jwk.d ?? '' };
}
