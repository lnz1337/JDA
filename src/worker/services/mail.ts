/**
 * Envio de e-mail (CLAUDE.md §2).
 *
 * O provedor é escolhido por `MAIL_PROVIDER`, não por código: o Email Sending
 * da Cloudflare está em beta, e trocar para o Resend tem que ser uma mudança de
 * variável e um secret, sem deploy de código novo.
 *
 * Todo envio vira uma linha em `events` — tipo, provedor e sucesso ou falha.
 * O código de login **nunca** é registrado.
 */
import { agoraIso } from '../lib/datas';
import { novoId } from '../lib/ids';
import { segredo } from '../lib/segredos';
import type { AppBindings } from '../lib/types';

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
  html?: string;
  responderPara?: string;
}

export interface ResultadoEnvio {
  ok: boolean;
  provedor: string;
  erro?: string;
  /**
   * O provedor recusou o destinatário antes de enviar: ele está na lista de
   * supressão (devolução repetida ou denúncia de spam). Não é falha de entrega.
   */
  suprimido?: boolean;
}

/**
 * Recusa por supressão. O Cloudflare diz "This email address has been
 * suppressed due to repeated bounces or because it reported your emails as
 * spam" (visto em 05/11). Lido pelo texto porque o binding não dá código.
 */
export function ehSupressao(erro: string | undefined): boolean {
  return /has been suppressed/i.test(erro ?? '');
}

export interface ProvedorEmail {
  nome: string;
  enviar(msg: MensagemEmail): Promise<ResultadoEnvio>;
}

type Ambiente = AppBindings['Bindings'];

function remetente(env: Ambiente): { nome: string; email: string } {
  return {
    nome: env.MAIL_FROM_NAME || 'Jornada com Meu Anjo',
    email: env.MAIL_FROM || 'contato@mail.jornadacomeuanjo.com',
  };
}

/** Email Sending da Cloudflare, pelo binding `EMAIL`. */
function provedorCloudflare(env: Ambiente): ProvedorEmail {
  return {
    nome: 'cloudflare',
    async enviar(msg) {
      if (!env.EMAIL) {
        return { ok: false, provedor: 'cloudflare', erro: 'binding EMAIL ausente' };
      }
      const de = remetente(env);
      try {
        await env.EMAIL.send({
          from: { name: de.nome, email: de.email },
          to: msg.para,
          subject: msg.assunto,
          text: msg.texto,
          ...(msg.html ? { html: msg.html } : {}),
          ...(msg.responderPara ? { replyTo: msg.responderPara } : {}),
        });
        return { ok: true, provedor: 'cloudflare' };
      } catch (erro) {
        return {
          ok: false,
          provedor: 'cloudflare',
          erro: erro instanceof Error ? erro.message : String(erro),
        };
      }
    },
  };
}

/** Resend, como alternativa se a entrega da Cloudflare der problema. */
function provedorResend(env: Ambiente): ProvedorEmail {
  return {
    nome: 'resend',
    async enviar(msg) {
      const chave = segredo(env, 'RESEND_API_KEY');
      if (!chave) {
        return { ok: false, provedor: 'resend', erro: 'RESEND_API_KEY ausente' };
      }
      const de = remetente(env);
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: `${de.nome} <${de.email}>`,
            to: [msg.para],
            subject: msg.assunto,
            text: msg.texto,
            ...(msg.html ? { html: msg.html } : {}),
            ...(msg.responderPara ? { reply_to: msg.responderPara } : {}),
          }),
        });
        if (!res.ok) {
          return { ok: false, provedor: 'resend', erro: `HTTP ${res.status}: ${await res.text()}` };
        }
        return { ok: true, provedor: 'resend' };
      } catch (erro) {
        return {
          ok: false,
          provedor: 'resend',
          erro: erro instanceof Error ? erro.message : String(erro),
        };
      }
    },
  };
}

export function provedorDeEmail(env: Ambiente): ProvedorEmail {
  const escolhido = String(env.MAIL_PROVIDER ?? 'cloudflare').toLowerCase();
  return escolhido === 'resend' ? provedorResend(env) : provedorCloudflare(env);
}

/**
 * Envia e registra em `events`. `tipo` identifica o e-mail (boas_vindas,
 * campanha_anuncio, codigo_excluir_conta…) e vai para a análise junto do resultado.
 */
export async function enviarEmail(
  env: Ambiente,
  tipo: string,
  msg: MensagemEmail,
  userId?: string | null,
): Promise<ResultadoEnvio> {
  const provedor = provedorDeEmail(env);
  const enviado = await provedor.enviar(msg);
  const resultado: ResultadoEnvio =
    !enviado.ok && ehSupressao(enviado.erro) ? { ...enviado, suprimido: true } : enviado;

  /*
   * Endereço suprimido sai de toda campanha (`users.email_suprimido_at`). Vale
   * para qualquer envio que descubra a supressão, mas só a campanha deixa de
   * tentar: o transacional não olha a marca, porque boas-vindas e código de
   * ação sensível são o que a pessoa pediu.
   */
  if (resultado.suprimido && userId) {
    await env.DB.prepare(
      'UPDATE users SET email_suprimido_at = COALESCE(email_suprimido_at, ?) WHERE id = ?',
    )
      .bind(agoraIso(), userId)
      .run();
  }

  if (!resultado.ok) {
    // Desde a entrada sem código, nenhum e-mail tranca alguém fora do app; o
    // código de ação sensível é o que mais pesa, porque sem ele a pessoa não
    // exclui a conta nem troca o e-mail.
    const grito = tipo.startsWith('codigo_') ? '[EMAIL][FALHA CRITICA]' : '[EMAIL][falha]';
    console.error(grito, tipo, resultado.provedor, resultado.erro);
  }

  await env.DB.prepare(
    'INSERT INTO events (id, user_id, name, props_json, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      novoId(),
      userId ?? null,
      resultado.ok ? 'email_enviado' : 'email_falhou',
      // Sem o código e sem o corpo: só o suficiente para diagnosticar.
      JSON.stringify({
        tipo,
        provedor: resultado.provedor,
        erro: resultado.erro ?? null,
        ...(resultado.suprimido ? { suprimido: true } : {}),
      }),
      agoraIso(),
    )
    .run();

  return resultado;
}
