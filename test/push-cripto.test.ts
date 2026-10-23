import { buildPushPayload } from '@block65/webcrypto-web-push';
import { describe, expect, it } from 'vitest';
import {
  b64urlParaBytes,
  decifrarPush,
  gerarVapid,
  type ChavesDoNavegador,
} from './ajuda-push';

/**
 * O exemplo do RFC 8291 §5, palavra por palavra. Serve para provar que o
 * decifrador do teste está certo — sem isso, um erro meu e um erro da
 * biblioteca poderiam se cancelar e o teste passaria com payload quebrado.
 */
const RFC = {
  corpo:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  texto: 'When I grow up, I want to be a watermelon',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  navegadorPrivada: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  navegadorPublica:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
};

const chavesDoNavegador: ChavesDoNavegador = {
  p256dh: b64urlParaBytes(RFC.navegadorPublica),
  privadaD: RFC.navegadorPrivada,
  auth: b64urlParaBytes(RFC.auth),
};

describe('decifrador do teste (RFC 8291 §5)', () => {
  it('decifra o exemplo do RFC', async () => {
    const texto = await decifrarPush(b64urlParaBytes(RFC.corpo), chavesDoNavegador);
    expect(texto).toBe(RFC.texto);
  });

  it('recusa quando o segredo de autenticação é outro', async () => {
    await expect(
      decifrarPush(b64urlParaBytes(RFC.corpo), {
        ...chavesDoNavegador,
        auth: b64urlParaBytes('AAAAAAAAAAAAAAAAAAAAAA'),
      }),
    ).rejects.toThrow();
  });
});

/**
 * O que importa de verdade: a biblioteca roda **dentro do workerd** e produz
 * payload que um navegador consegue abrir. Rodar no Node não provaria nada — o
 * push sai do Worker.
 */
describe('@block65/webcrypto-web-push no workerd', () => {
  const assinatura = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/exemplo-de-endpoint',
    expirationTime: null,
    keys: { auth: RFC.auth, p256dh: RFC.navegadorPublica },
  };

  it('cifra algo que o navegador consegue decifrar', async () => {
    const vapid = await gerarVapid();
    const mensagem = {
      titulo: 'Oração do dia 3',
      corpo: 'Hoje você pede o escudo da proteção.',
      url: '/licao/jornada-19-d03?origem=push',
    };

    const payload = await buildPushPayload({ data: mensagem }, assinatura, {
      subject: 'mailto:suporte@jornadacomeuanjo.com',
      ...vapid,
    });

    expect(payload.method.toUpperCase()).toBe('POST');
    expect(payload.headers['content-encoding']).toBe('aes128gcm');

    const aberto = await decifrarPush(new Uint8Array(payload.body), chavesDoNavegador);
    expect(JSON.parse(aberto)).toEqual(mensagem);
  });

  it('assina o cabeçalho VAPID com a chave pública que o serviço vai conferir', async () => {
    const vapid = await gerarVapid();
    const payload = await buildPushPayload({ data: { a: 1 } }, assinatura, {
      subject: 'mailto:suporte@jornadacomeuanjo.com',
      ...vapid,
    });

    const auth = payload.headers.authorization;
    expect(auth).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(auth).toContain(`k=${vapid.publicKey}`);

    // O `aud` do JWT tem que ser a origem do endpoint (RFC 8292 §2).
    const [, corpoJwt] = (/t=([\w-]+\.[\w-]+)\./.exec(auth)?.[1] ?? '').split('.');
    const dados = JSON.parse(new TextDecoder().decode(b64urlParaBytes(corpoJwt ?? ''))) as {
      aud: string;
      sub: string;
      exp: number;
    };
    expect(dados.aud).toBe('https://fcm.googleapis.com');
    expect(dados.sub).toBe('mailto:suporte@jornadacomeuanjo.com');
    expect(dados.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('recusa endpoint que não é https', async () => {
    const vapid = await gerarVapid();
    await expect(
      buildPushPayload({ data: { a: 1 } }, { ...assinatura, endpoint: 'http://exemplo.test/x' }, {
        subject: 'mailto:suporte@jornadacomeuanjo.com',
        ...vapid,
      }),
    ).rejects.toThrow();
  });
});
