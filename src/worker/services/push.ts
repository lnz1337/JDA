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
import { segredo } from '../lib/segredos';
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

/** Os três valores VAPID, lidos pelo leitor único de segredo (lib/segredos.ts). */
function vapidDe(env: Ambiente) {
  return {
    subject: segredo(env, 'VAPID_SUBJECT'),
    publicKey: segredo(env, 'VAPID_PUBLIC_KEY'),
    privateKey: segredo(env, 'VAPID_PRIVATE_KEY'),
  };
}

/** A chave pública que vai para o `subscribe` do navegador, já limpa. */
export function chavePublicaVapid(env: Ambiente): string {
  return vapidDe(env).publicKey;
}

/**
 * O `sub` do JWT tem que ser `mailto:` ou `https`.
 *
 * A Apple recusa o envio com **403 `BadJwtToken`** quando não é, e e-mail sem o
 * `mailto:` na frente é o erro fácil de cometer no `wrangler secret put`.
 * Conferir o formato aqui é mais barato que descobrir pelo aparelho.
 */
const ASSUNTO_VALIDO = /^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/;

export function assuntoVapidValido(assunto: string): boolean {
  return ASSUNTO_VALIDO.test(assunto);
}

export function vapidConfigurado(env: Ambiente): boolean {
  const v = vapidDe(env);
  return Boolean(v.publicKey && v.privateKey) && assuntoVapidValido(v.subject);
}

/** Limite do motivo no relatório: ele é curto, o corpo da resposta pode não ser. */
const LIMITE_MOTIVO = 160;

/**
 * O motivo que o serviço de push deu, quando dá.
 *
 * A Apple responde `{"reason":"BadJwtToken"}`. Sem ler isso, o relatório
 * guardava só "HTTP 403", que não separa chave errada de assunto errado. URL
 * sai do texto: o endpoint é credencial de entrega, não dado de relatório (§11).
 */
async function motivoDaResposta(res: Response): Promise<string> {
  try {
    const texto = (await res.text()).trim();
    if (!texto) return '';

    let motivo = texto;
    try {
      const json = JSON.parse(texto) as { reason?: unknown; error?: unknown };
      const campo = json.reason ?? json.error;
      if (typeof campo === 'string' && campo) motivo = campo;
    } catch {
      /* não era JSON: fica o texto cru, cortado */
    }

    return motivo.replace(/\b(?:https?|wss?):\/\/\S*/gi, '[url]').slice(0, LIMITE_MOTIVO);
  } catch {
    // Corpo já consumido ou conexão caiu: o status sozinho ainda informa.
    return '';
  }
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
    /*
     * Dizer qual metade falta. "VAPID não configurado" mandava conferir os três
     * secrets, e o assunto torto é o que a Apple devolve como 403 genérico.
     */
    const erro = assuntoVapidValido(vapidDe(env).subject)
      ? 'VAPID sem par de chaves'
      : 'VAPID_SUBJECT precisa ser mailto: ou https';
    return { ok: false, servico, removerAssinatura: false, erro };
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
    const motivo = await motivoDaResposta(res);
    return {
      ok: false,
      servico,
      status: res.status,
      removerAssinatura: res.status === 404 || res.status === 410,
      erro: motivo ? `HTTP ${res.status}: ${motivo}` : `HTTP ${res.status}`,
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
