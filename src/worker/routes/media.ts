/**
 * Mídia do R2 (CLAUDE.md §6). `GET /media/<chave>`.
 *
 * Nada no R2 tem URL pública: o Worker é o único caminho, e ele confere o acesso
 * a cada pedido. Duas regras valem aqui:
 *
 * 1. **a chave precisa pertencer a uma lição.** Sem isso, bastaria pedir
 *    `/media/qualquer-coisa.mp3` para ler qualquer objeto do bucket;
 *    o dono da lição decide o produto, e o produto decide o acesso.
 * 2. **`Range` é obrigatório, não enfeite.** O player de áudio do iOS pede o
 *    arquivo em pedaços e **não toca** quem responde 200 com o arquivo inteiro.
 *    Por isso a resposta é 206 com `Content-Range` sempre que vier `Range`.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from '../lib/types';
import { COOKIE_SESSAO, usuarioDaSessao } from '../services/auth';
import { hasAccess } from '../services/entitlements';

/** `bytes=0-` / `bytes=100-199` / `bytes=-500`. Devolve null se não der para ler. */
export function lerRange(
  cabecalho: string | undefined,
  tamanho: number,
): { inicio: number; fim: number } | null {
  if (!cabecalho) return null;

  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!m) return null;

  const [, cru1 = '', cru2 = ''] = m;
  if (cru1 === '' && cru2 === '') return null;

  // `bytes=-500`: os últimos 500 bytes.
  if (cru1 === '') {
    const ultimos = Number(cru2);
    if (!Number.isFinite(ultimos) || ultimos <= 0) return null;
    return { inicio: Math.max(tamanho - ultimos, 0), fim: tamanho - 1 };
  }

  const inicio = Number(cru1);
  if (!Number.isFinite(inicio) || inicio >= tamanho) return null;

  const fim = cru2 === '' ? tamanho - 1 : Math.min(Number(cru2), tamanho - 1);
  if (fim < inicio) return null;

  return { inicio, fim };
}

/** De que produto é esta chave — ou null se ela não for de lição nenhuma. */
async function produtoDaChave(db: D1Database, chave: string): Promise<string | null> {
  const linha = await db
    .prepare(
      `SELECT pr.product_id
         FROM lessons l
         JOIN programs pr ON pr.id = l.program_id
        WHERE l.audio_key = ? OR l.bonus_audio_key = ? OR l.pdf_key = ?
        LIMIT 1`,
    )
    .bind(chave, chave, chave)
    .first<{ product_id: string }>();

  return linha?.product_id ?? null;
}

const TIPOS: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function tipoDaChave(chave: string): string {
  const ext = chave.split('.').pop()?.toLowerCase() ?? '';
  return TIPOS[ext] ?? 'application/octet-stream';
}

export const media = new Hono<AppBindings>().get('/*', async (c) => {
  const chave = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/media\//, ''));
  if (!chave || chave.includes('..')) return c.json({ error: 'chave_invalida' }, 400);

  const sessao = await usuarioDaSessao(c.env.DB, getCookie(c, COOKIE_SESSAO));
  if (!sessao) return c.json({ error: 'nao_autenticado' }, 401);

  const productId = await produtoDaChave(c.env.DB, chave);
  if (!productId) return c.json({ error: 'nao_encontrado' }, 404);
  if (!(await hasAccess(c.env.DB, sessao.userId, productId))) {
    return c.json({ error: 'sem_acesso' }, 403);
  }

  const cabecalho = c.req.header('range');

  // Sem Range: o objeto inteiro, mas avisando que pedaço é aceito.
  if (!cabecalho) {
    const objeto = await c.env.MEDIA.get(chave);
    if (!objeto) return c.json({ error: 'arquivo_ausente' }, 404);

    return new Response(objeto.body, {
      headers: {
        'content-type': tipoDaChave(chave),
        'content-length': String(objeto.size),
        'accept-ranges': 'bytes',
        etag: objeto.httpEtag,
        // Conteúdo pago: cache no aparelho de quem tem acesso, nunca no caminho.
        'cache-control': 'private, max-age=3600',
      },
    });
  }

  const cabecalhoDoObjeto = await c.env.MEDIA.head(chave);
  if (!cabecalhoDoObjeto) return c.json({ error: 'arquivo_ausente' }, 404);

  const faixa = lerRange(cabecalho, cabecalhoDoObjeto.size);
  if (!faixa) {
    return new Response('range inválido', {
      status: 416,
      headers: { 'content-range': `bytes */${cabecalhoDoObjeto.size}` },
    });
  }

  const objeto = await c.env.MEDIA.get(chave, {
    range: { offset: faixa.inicio, length: faixa.fim - faixa.inicio + 1 },
  });
  if (!objeto) return c.json({ error: 'arquivo_ausente' }, 404);

  return new Response((objeto as R2ObjectBody).body, {
    status: 206,
    headers: {
      'content-type': tipoDaChave(chave),
      'content-length': String(faixa.fim - faixa.inicio + 1),
      'content-range': `bytes ${faixa.inicio}-${faixa.fim}/${cabecalhoDoObjeto.size}`,
      'accept-ranges': 'bytes',
      etag: objeto.httpEtag,
      'cache-control': 'private, max-age=3600',
    },
  });
});
