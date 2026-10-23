import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { lerRange } from '../src/worker/routes/media';
import { fraseDaLicao, semAvisoRepetido } from '../src/worker/services/jornada';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

const BASE = 'https://exemplo.test';
const USER = 'u-jornada';
const COOKIE = 'sessao=s-jornada';

async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request(
    `${BASE}${caminho}`,
    { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } },
    envTeste,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

/** Usuário logado, com a jornada liberada. `inicio` matricula no dia escolhido. */
async function prepararUsuario(opcoes: { inicio?: string; timezone?: string } = {}) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, timezone, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(USER, 'pessoa@exemplo.com.br', 'Maria', opcoes.timezone ?? 'America/Sao_Paulo', agora)
    .run();

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind('s-jornada', USER, new Date(Date.now() + 86_400_000).toISOString(), agora)
    .run();

  await env.DB.prepare(
    `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at)
     VALUES ('e-jornada', ?, 'jornada-meu-anjo', 'manual', 'active', ?)`,
  )
    .bind(USER, agora)
    .run();

  if (opcoes.inicio) {
    await env.DB.prepare(
      'INSERT INTO enrollments (user_id, program_id, started_at) VALUES (?, ?, ?)',
    )
      .bind(USER, 'jornada-19', opcoes.inicio)
      .run();
  }
}

/** Data de início que deixa a pessoa no dia N da jornada. */
function inicioNoDia(n: number): string {
  return new Date(Date.now() - (n - 1) * 86_400_000).toISOString();
}

interface RespostaPrograma {
  programa: { id: string; total_days: number; concluidos: number; atual: { dia: number } | null };
  licoes: Array<{
    id: string;
    dia: number;
    estado: string;
    dias_para_liberar?: number;
    tem_audio: boolean;
  }>;
}

beforeEach(prepararBanco);

describe('frase do dia', () => {
  it('usa o summary quando existe', () => {
    expect(fraseDaLicao('A frase curta', '**Intenção:** outra coisa')).toBe('A frase curta');
  });

  it('sem summary, usa a linha de Intenção do corpo', () => {
    // Hoje a jornada vem sem summary no seed; a Intenção já é uma frase só.
    expect(fraseDaLicao(null, '**Leitura:** Ap 12\n\n**Intenção:** Entregar o meu pedido.')).toBe(
      'Entregar o meu pedido.',
    );
  });

  it('sem os dois, cai no primeiro parágrafo de texto corrido', () => {
    const corpo = '**Leitura do dia:** Ap 12,7-9\n\nSão Miguel aparece na Escritura como defensor.';
    expect(fraseDaLicao(null, corpo)).toBe(
      'São Miguel aparece na Escritura como defensor.',
    );
  });

  it('não devolve frase quando não há o que dizer', () => {
    expect(fraseDaLicao(null, null)).toBeNull();
    expect(fraseDaLicao('   ', '**Leitura:** Ap 12')).toBeNull();
  });
});

describe('aviso repetido no corpo', () => {
  it('tira a citação do topo quando ela é o próprio aviso', () => {
    const corpo = '> Conteúdo devocional. Não substitui tratamento.\n\nNão adianta limpar a casa.';
    expect(semAvisoRepetido(corpo, 'Conteúdo devocional. Não substitui tratamento.')).toBe(
      'Não adianta limpar a casa.',
    );
  });

  it('não mexe em citação que é conteúdo', () => {
    const corpo = '> São Miguel Arcanjo, defendei-nos no combate.\n\nReze esta oração.';
    expect(semAvisoRepetido(corpo, 'Conteúdo devocional. Não substitui tratamento.')).toBe(corpo);
  });

  it('não mexe quando o aviso aparece no meio, não no topo', () => {
    const corpo = 'Primeiro parágrafo.\n\n> Conteúdo devocional.';
    expect(semAvisoRepetido(corpo, 'Conteúdo devocional.')).toBe(corpo);
  });

  it('aguenta corpo ou aviso vazios', () => {
    expect(semAvisoRepetido(null, 'aviso')).toBeNull();
    expect(semAvisoRepetido('texto', null)).toBe('texto');
  });
});

describe('lista de dias', () => {
  it('sem sessão, não devolve nada', async () => {
    expect((await chamar('/api/programas')).status).toBe(401);
    expect((await chamar('/api/programas/jornada-19')).status).toBe(401);
  });

  it('matricula na primeira visita, não antes', async () => {
    await prepararUsuario();

    await chamar('/api/programas', { headers: { cookie: COOKIE } });
    const antes = await env.DB.prepare('SELECT COUNT(*) AS n FROM enrollments').first<{ n: number }>();
    expect(antes?.n, 'a Home não pode matricular ninguém').toBe(0);

    await chamar('/api/programas/jornada-19', { headers: { cookie: COOKIE } });
    const depois = await env.DB.prepare('SELECT COUNT(*) AS n FROM enrollments').first<{
      n: number;
    }>();
    expect(depois?.n).toBe(1);
  });

  it('no primeiro dia: dia 1 é hoje, dia 2 libera amanhã, dia 19 em 18 dias', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });

    const res = await chamar('/api/programas/jornada-19', { headers: { cookie: COOKIE } });
    const corpo = (await res.json()) as RespostaPrograma;

    const porDia = new Map(corpo.licoes.map((l) => [l.dia, l]));
    expect(corpo.licoes).toHaveLength(19);
    expect(porDia.get(1)?.estado).toBe('hoje');
    expect(porDia.get(2)?.estado).toBe('bloqueado');
    expect(porDia.get(2)?.dias_para_liberar).toBe(1);
    expect(porDia.get(19)?.dias_para_liberar).toBe(18);
    expect(corpo.programa.atual?.dia).toBe(1);
  });

  it('no quinto dia, o atrasado não fica travado', async () => {
    await prepararUsuario({ inicio: inicioNoDia(5) });

    const corpo = (await (
      await chamar('/api/programas/jornada-19', { headers: { cookie: COOKIE } })
    ).json()) as RespostaPrograma;

    const porDia = new Map(corpo.licoes.map((l) => [l.dia, l]));
    // Quem pulou os primeiros dias continua podendo abri-los (§6).
    expect(porDia.get(1)?.estado).toBe('liberado');
    expect(porDia.get(4)?.estado).toBe('liberado');
    expect(porDia.get(5)?.estado).toBe('hoje');
    expect(porDia.get(6)?.estado).toBe('bloqueado');
  });

  it('dia concluído aparece como concluído, mesmo sendo o de hoje', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });
    await chamar('/api/licoes/jornada-19-d01/concluir', {
      method: 'POST',
      headers: { cookie: COOKIE },
    });

    const corpo = (await (
      await chamar('/api/programas/jornada-19', { headers: { cookie: COOKIE } })
    ).json()) as RespostaPrograma;

    expect(corpo.licoes.find((l) => l.dia === 1)?.estado).toBe('concluido');
    expect(corpo.programa.concluidos).toBe(1);
  });

  it('produto avulso libera tudo de uma vez', async () => {
    await prepararUsuario();
    await env.DB.prepare(
      `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at)
       VALUES ('e-gargano', ?, 'oracao-gargano', 'manual', 'active', ?)`,
    )
      .bind(USER, new Date().toISOString())
      .run();

    const corpo = (await (
      await chamar('/api/programas/oracao-gargano', { headers: { cookie: COOKIE } })
    ).json()) as RespostaPrograma;

    expect(corpo.licoes.every((l) => l.estado === 'liberado')).toBe(true);
  });

  it('programa de produto que a pessoa não tem é 403', async () => {
    await prepararUsuario();
    const res = await chamar('/api/programas/jornada-cura', { headers: { cookie: COOKIE } });
    expect(res.status).toBe(403);
  });

  it('a Home só traz programa que a pessoa tem', async () => {
    await prepararUsuario({ inicio: inicioNoDia(3) });

    const corpo = (await (
      await chamar('/api/programas', { headers: { cookie: COOKIE } })
    ).json()) as { programas: Array<{ id: string; atual: { dia: number } | null }> };

    expect(corpo.programas.map((p) => p.id)).toEqual(['jornada-19']);
    expect(corpo.programas[0]?.atual?.dia).toBe(3);
  });
});

describe('abrir e concluir lição', () => {
  it('a lição de hoje abre, com corpo e áudio', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });

    const res = await chamar('/api/licoes/jornada-19-d01', { headers: { cookie: COOKIE } });
    const { licao } = (await res.json()) as {
      licao: { dia: number; body_md: string; audio_url: string; frase: string };
    };

    expect(res.status).toBe(200);
    expect(licao.dia).toBe(1);
    expect(licao.body_md).toContain('São Miguel');
    // A chave do R2 não vai crua para o client.
    expect(licao.audio_url).toBe('/media/jornada/d01.mp3');
    expect(licao.frase).toBeTruthy();
  });

  it('dia que ainda não liberou não abre, nem adivinhando a URL', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });

    const res = await chamar('/api/licoes/jornada-19-d05', { headers: { cookie: COOKIE } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'bloqueada', dias_para_liberar: 4 });
  });

  it('o dia 19 leva o hino como segunda faixa', async () => {
    await prepararUsuario({ inicio: inicioNoDia(19) });

    const { licao } = (await (
      await chamar('/api/licoes/jornada-19-d19', { headers: { cookie: COOKIE } })
    ).json()) as { licao: { bonus_audio_url: string; bonus_title: string } };

    expect(licao.bonus_audio_url).toBe('/media/jornada/hino-sao-miguel.mp3');
    expect(licao.bonus_title).toBe('Hino de São Miguel');
  });

  it('concluir grava progresso e evento, sem duplicar', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });

    await chamar('/api/licoes/jornada-19-d01/concluir', {
      method: 'POST',
      headers: { cookie: COOKIE },
    });
    const segunda = await chamar('/api/licoes/jornada-19-d01/concluir', {
      method: 'POST',
      headers: { cookie: COOKIE },
    });

    expect(segunda.status).toBe(200);
    expect(await segunda.json()).toMatchObject({ ok: true, concluidos: 1, total: 19 });

    const p = await env.DB.prepare('SELECT COUNT(*) AS n FROM progress').first<{ n: number }>();
    expect(p?.n).toBe(1);

    // Um evento só: o funil D1 → D19 contaria insistência se o segundo toque
    // no botão também virasse linha.
    const e = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE name = 'lesson_completed'",
    ).first<{ n: number }>();
    expect(e?.n).toBe(1);
  });

  it('concluir os 19 fecha a matrícula, que é o gatilho da oferta', async () => {
    await prepararUsuario({ inicio: inicioNoDia(19) });

    for (let dia = 1; dia <= 19; dia += 1) {
      const id = `jornada-19-d${String(dia).padStart(2, '0')}`;
      await chamar(`/api/licoes/${id}/concluir`, { method: 'POST', headers: { cookie: COOKIE } });
    }

    const m = await env.DB.prepare(
      'SELECT completed_at FROM enrollments WHERE user_id = ? AND program_id = ?',
    )
      .bind(USER, 'jornada-19')
      .first<{ completed_at: string | null }>();

    expect(m?.completed_at).toBeTruthy();
  });

  it('não dá para concluir dia de produto que não é seu', async () => {
    await prepararUsuario();
    const res = await chamar('/api/licoes/jornada-cura-l01/concluir', {
      method: 'POST',
      headers: { cookie: COOKIE },
    });
    expect(res.status).toBe(403);
  });
});

describe('eventos do client', () => {
  it('aceita só os eventos da lista', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });

    const ok = await chamar('/api/eventos', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify({ nome: 'audio_completed', lesson_id: 'jornada-19-d01', dia: 1 }),
    });
    expect(ok.status).toBe(200);

    const recusado = await chamar('/api/eventos', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify({ nome: 'compra_fraudada' }),
    });
    expect(recusado.status).toBe(400);

    const linha = await env.DB.prepare('SELECT name, props_json FROM events').first<{
      name: string;
      props_json: string;
    }>();
    expect(linha?.name).toBe('audio_completed');
    expect(JSON.parse(linha?.props_json ?? '{}')).toMatchObject({ dia: 1 });
  });

  it('sem sessão não registra evento', async () => {
    const res = await chamar('/api/eventos', {
      method: 'POST',
      body: JSON.stringify({ nome: 'lesson_started' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('mídia', () => {
  it('lê o cabeçalho Range nas formas que o player usa', () => {
    expect(lerRange('bytes=0-', 1000)).toEqual({ inicio: 0, fim: 999 });
    expect(lerRange('bytes=100-199', 1000)).toEqual({ inicio: 100, fim: 199 });
    expect(lerRange('bytes=-500', 1000)).toEqual({ inicio: 500, fim: 999 });
    // Fim além do arquivo é cortado, não recusado: o iOS pede assim.
    expect(lerRange('bytes=900-5000', 1000)).toEqual({ inicio: 900, fim: 999 });

    expect(lerRange(undefined, 1000)).toBeNull();
    expect(lerRange('bytes=1000-', 1000)).toBeNull();
    expect(lerRange('bytes=200-100', 1000)).toBeNull();
    expect(lerRange('parafusos=0-10', 1000)).toBeNull();
  });

  it('exige sessão', async () => {
    expect((await chamar('/media/jornada/d01.mp3')).status).toBe(401);
  });

  it('recusa chave que não é de lição nenhuma', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });
    const res = await chamar('/media/segredo/backup.sql', { headers: { cookie: COOKIE } });
    expect(res.status).toBe(404);
  });

  it('recusa áudio de produto que a pessoa não tem', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });
    // jornada-cura/l01.mp3 é de um produto que este usuário não comprou.
    const chave = await env.DB.prepare(
      "SELECT audio_key FROM lessons WHERE program_id = 'jornada-cura' AND audio_key IS NOT NULL LIMIT 1",
    ).first<{ audio_key: string }>();

    const res = await chamar(`/media/${chave?.audio_key}`, { headers: { cookie: COOKIE } });
    expect(res.status).toBe(403);
  });

  it('com acesso, responde 206 e o pedaço pedido', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });
    await env.MEDIA.put('jornada/d01.mp3', new Uint8Array(1000).fill(7));

    const res = await chamar('/media/jornada/d01.mp3', {
      headers: { cookie: COOKIE, range: 'bytes=10-19' },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(res.headers.get('content-length')).toBe('10');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it('sem Range, manda o arquivo inteiro e avisa que aceita pedaço', async () => {
    await prepararUsuario({ inicio: inicioNoDia(1) });
    await env.MEDIA.put('jornada/d01.mp3', new Uint8Array(1000).fill(7));

    const res = await chamar('/media/jornada/d01.mp3', { headers: { cookie: COOKIE } });

    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('1000');
  });
});
