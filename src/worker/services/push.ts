/**
 * Envio de Web Push (CLAUDE.md §11).
 *
 * A criptografia é do `@block65/webcrypto-web-push`, que roda com WebCrypto e
 * funciona no workerd — validado em `test/push-cripto.test.ts`, que cifra aqui e
 * decifra do outro lado com o vetor do RFC 8291. O pacote `web-push` não serve:
 * depende de módulos do Node.
 */
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { agoraIso } from '../lib/datas';
import { novoId } from '../lib/ids';
import type { AppBindings } from '../lib/types';

type Ambiente = AppBindings['Bindings'];

/**
 * Para onde o Worker aceita mandar push.
 *
 * Sem esta lista, qualquer um que consiga gravar uma assinatura transforma o
 * Worker num disparador de POST para a URL que quiser — com a nossa origem e a
 * nossa cota. O endpoint vem do navegador, mas quem o envia é um cliente.
 */
const SERVICOS = [
  { sufixo: 'fcm.googleapis.com', exato: true, nome: 'fcm' },
  { sufixo: '.push.apple.com', exato: false, nome: 'apple' },
  { sufixo: 'updates.push.services.mozilla.com', exato: true, nome: 'mozilla' },
  { sufixo: '.notify.windows.com', exato: false, nome: 'windows' },
] as const;

/** O serviço de push daquele endpoint, ou null se não for um que aceitamos. */
export function servicoDoEndpoint(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }

  // RFC 8030 §2: recurso de push é https. E http vazaria o payload cifrado para
  // um intermediário conseguir ao menos ver o tamanho e o destino.
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  for (const s of SERVICOS) {
    // O ponto na frente é o que impede `malpush.apple.com` de passar.
    if (s.exato ? host === s.sufixo : host.endsWith(s.sufixo)) return s.nome;
  }
  return null;
}

export interface AssinaturaPush {
  id?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface MensagemPush {
  titulo: string;
  corpo: string;
  /** Caminho no app que o toque na notificação abre. */
  url: string;
  /** Notificação com a mesma tag substitui a anterior em vez de empilhar. */
  tag?: string;
}

export type ResultadoPush =
  | { ok: true; servico: string }
  | { ok: false; servico: string; status?: number; removerAssinatura: boolean; erro: string };

function vapidDe(env: Ambiente) {
  return {
    subject: env.VAPID_SUBJECT ?? '',
    publicKey: env.VAPID_PUBLIC_KEY ?? '',
    privateKey: env.VAPID_PRIVATE_KEY ?? '',
  };
}

export function vapidConfigurado(env: Ambiente): boolean {
  const v = vapidDe(env);
  return Boolean(v.subject && v.publicKey && v.privateKey);
}

/** Cifra e entrega. Não mexe no banco: quem chama decide o que fazer com o erro. */
export async function enviarPush(
  env: Ambiente,
  assinatura: AssinaturaPush,
  mensagem: MensagemPush,
): Promise<ResultadoPush> {
  const servico = servicoDoEndpoint(assinatura.endpoint) ?? 'desconhecido';

  if (servico === 'desconhecido') {
    return {
      ok: false,
      servico,
      removerAssinatura: true,
      erro: 'endpoint de serviço não reconhecido',
    };
  }

  if (!vapidConfigurado(env)) {
    return { ok: false, servico, removerAssinatura: false, erro: 'VAPID não configurado' };
  }

  try {
    const payload = await buildPushPayload(
      // A biblioteca pede um tipo "jsonificável" aberto; a mensagem é um objeto
      // de campos simples, e é isso que vai cifrado para o aparelho.
      { data: { ...mensagem }, options: { ttl: 6 * 60 * 60, urgency: 'normal' } },
      {
        endpoint: assinatura.endpoint,
        expirationTime: null,
        keys: { auth: assinatura.auth, p256dh: assinatura.p256dh },
      },
      vapidDe(env),
    );

    const res = await fetch(assinatura.endpoint, {
      method: payload.method,
      headers: payload.headers,
      body: payload.body,
    });

    if (res.ok) return { ok: true, servico };

    /*
     * 404/410 é o serviço dizendo que aquele aparelho não existe mais — app
     * desinstalado, dados limpos. Insistir só queima cota, então a assinatura
     * sai do banco (§11).
     */
    return {
      ok: false,
      servico,
      status: res.status,
      removerAssinatura: res.status === 404 || res.status === 410,
      erro: `HTTP ${res.status}`,
    };
  } catch (erro) {
    return {
      ok: false,
      servico,
      removerAssinatura: false,
      erro: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

/**
 * Envia e cuida do banco: apaga assinatura morta, marca sucesso e registra o
 * evento. O evento guarda **só o serviço**, nunca o endpoint — endpoint é
 * credencial de entrega, e `events` é tabela de relatório.
 */
export async function enviarERegistrar(
  env: Ambiente,
  userId: string,
  assinatura: AssinaturaPush & { id: string },
  mensagem: MensagemPush,
  props: Record<string, unknown> = {},
): Promise<ResultadoPush> {
  const r = await enviarPush(env, assinatura, mensagem);

  if (r.ok) {
    await env.DB.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?')
      .bind(agoraIso(), assinatura.id)
      .run();
  } else if (r.removerAssinatura) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?')
      .bind(assinatura.id)
      .run();
  }

  await env.DB.prepare(
    'INSERT INTO events (id, user_id, name, props_json, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      novoId(),
      userId,
      r.ok ? 'push_enviado' : 'push_falhou',
      JSON.stringify({
        servico: r.servico,
        ...(r.ok ? {} : { status: r.status ?? null, erro: r.erro, removida: r.removerAssinatura }),
        ...props,
      }),
      agoraIso(),
    )
    .run();

  return r;
}

/** As assinaturas de um usuário. */
export async function assinaturasDoUsuario(
  db: D1Database,
  userId: string,
): Promise<Array<AssinaturaPush & { id: string }>> {
  const { results } = await db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all<AssinaturaPush & { id: string }>();
  return results;
}
