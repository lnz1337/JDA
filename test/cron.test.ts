import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type Enviador,
  enviarLembretes,
  licaoDoLembrete,
  montarMensagem,
} from '../src/worker/cron';
import type { MensagemPush, ResultadoPush } from '../src/worker/services/push';
import { prepararBanco } from './ajuda';
import { envTeste } from './env-de-teste';

/** 23/10/2026, 10:00 UTC = 7h em São Paulo, 11h em Lisboa. */
const AGORA = '2026-10-23T10:00:00.000Z';

interface Enviado {
  userId: string;
  mensagem: MensagemPush;
}

/**
 * Enviador de mentira: o teste não pode sair pela internet, e o que importa aqui
 * é quem entra na lista e o que a mensagem diz — não a criptografia, que tem
 * teste próprio em `push-cripto.test.ts`.
 */
function enviadorFalso(resultado: Partial<ResultadoPush> = {}) {
  const enviados: Enviado[] = [];
  const enviar: Enviador = async (_env, userId, _assinatura, mensagem) => {
    enviados.push({ userId, mensagem });
    return { ok: true, servico: 'fcm', ...resultado } as ResultadoPush;
  };
  return { enviados, enviar };
}

interface OpcoesUsuario {
  id: string;
  hora?: number;
  timezone?: string;
  comAcesso?: boolean;
  comAssinatura?: boolean;
  /** Dias corridos desde o início da jornada; sem isto, não há matrícula. */
  diaDaJornada?: number;
  concluidos?: number[];
}

async function criarUsuario(o: OpcoesUsuario): Promise<void> {
  const agora = new Date(AGORA).toISOString();
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, timezone, prayer_hour, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(o.id, `${o.id}@exemplo.com.br`, 'Pessoa', o.timezone ?? 'America/Sao_Paulo', o.hora ?? 7, agora)
    .run();

  if (o.comAssinatura !== false) {
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, 'p', 'a', ?)`,
    )
      .bind(`s-${o.id}`, o.id, `https://fcm.googleapis.com/fcm/send/${o.id}`, agora)
      .run();
  }

  if (o.comAcesso !== false) {
    await env.DB.prepare(
      `INSERT INTO entitlements (id, user_id, product_id, source, status, granted_at)
       VALUES (?, ?, 'jornada-meu-anjo', 'manual', 'active', ?)`,
    )
      .bind(`e-${o.id}`, o.id, agora)
      .run();
  }

  if (o.diaDaJornada !== undefined) {
    const inicio = new Date(Date.parse(AGORA) - (o.diaDaJornada - 1) * 86_400_000).toISOString();
    await env.DB.prepare(
      "INSERT INTO enrollments (user_id, program_id, started_at) VALUES (?, 'jornada-19', ?)",
    )
      .bind(o.id, inicio)
      .run();
  }

  for (const dia of o.concluidos ?? []) {
    await env.DB.prepare(
      'INSERT INTO progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)',
    )
      .bind(o.id, `jornada-19-d${String(dia).padStart(2, '0')}`, agora)
      .run();
  }
}

beforeEach(prepararBanco);

describe('quem recebe o lembrete', () => {
  it('manda para quem está na hora, no fuso dele', async () => {
    await criarUsuario({ id: 'sp', hora: 7, timezone: 'America/Sao_Paulo' });
    await criarUsuario({ id: 'lisboa', hora: 11, timezone: 'Europe/Lisbon' });
    // Mesma hora no relógio, fuso diferente: ainda não é a hora dele.
    await criarUsuario({ id: 'manaus', hora: 7, timezone: 'America/Manaus' });

    const { enviados, enviar } = enviadorFalso();
    const r = await enviarLembretes(envTeste, { agora: AGORA, enviar });

    expect(enviados.map((e) => e.userId).sort()).toEqual(['lisboa', 'sp']);
    expect(r.enviados).toBe(2);
  });

  it('não manda fora da hora', async () => {
    await criarUsuario({ id: 'tarde', hora: 21 });

    const { enviados, enviar } = enviadorFalso();
    await enviarLembretes(envTeste, { agora: AGORA, enviar });

    expect(enviados).toHaveLength(0);
  });

  it('não manda para quem não tem a jornada', async () => {
    await criarUsuario({ id: 'sem-acesso', comAcesso: false });

    const { enviados, enviar } = enviadorFalso();
    const r = await enviarLembretes(envTeste, { agora: AGORA, enviar });

    expect(enviados).toHaveLength(0);
    expect(r.pulados).toBe(1);
  });

  it('não manda para quem não tem aparelho', async () => {
    await criarUsuario({ id: 'sem-aparelho', comAssinatura: false });

    const { enviados, enviar } = enviadorFalso();
    const r = await enviarLembretes(envTeste, { agora: AGORA, enviar });

    expect(enviados).toHaveLength(0);
    expect(r.candidatos).toBe(0);
  });

  it('quem já rezou hoje não é lembrado', async () => {
    await criarUsuario({ id: 'rezou', diaDaJornada: 3, concluidos: [3] });

    const { enviados, enviar } = enviadorFalso();
    const r = await enviarLembretes(envTeste, { agora: AGORA, enviar });

    expect(enviados).toHaveLength(0);
    expect(r.pulados).toBe(1);
  });

  it('sem matrícula, convida para o dia 1 — e não matricula', async () => {
    await criarUsuario({ id: 'novo' });

    const { enviados, enviar } = enviadorFalso();
    await enviarLembretes(envTeste, { agora: AGORA, enviar });

    expect(enviados[0]?.mensagem.titulo).toBe('Oração do dia 1');
    expect(enviados[0]?.mensagem.url).toBe('/licao/jornada-19-d01?origem=push');

    // O relógio da jornada só começa quando a pessoa entra no programa (§6).
    const m = await env.DB.prepare('SELECT COUNT(*) AS n FROM enrollments').first<{ n: number }>();
    expect(m?.n).toBe(0);
  });

  it('para de lembrar uma semana depois de o dia 19 abrir', async () => {
    await criarUsuario({ id: 'dentro', diaDaJornada: 19 + 7 });
    await criarUsuario({ id: 'fora', diaDaJornada: 19 + 8 });

    const { enviados, enviar } = enviadorFalso();
    await enviarLembretes(envTeste, { agora: AGORA, enviar });

    expect(enviados.map((e) => e.userId)).toEqual(['dentro']);
  });

  it('depois do dia 19, continua lembrando do dia 19', async () => {
    await criarUsuario({ id: 'atrasado', diaDaJornada: 22 });

    const { enviados, enviar } = enviadorFalso();
    await enviarLembretes(envTeste, { agora: AGORA, enviar });

    expect(enviados[0]?.mensagem.titulo).toBe('Oração do dia 19');
  });

  it('respeita o tamanho do lote', async () => {
    for (let i = 0; i < 5; i += 1) await criarUsuario({ id: `u${i}` });

    const { enviados, enviar } = enviadorFalso();
    const r = await enviarLembretes(envTeste, { agora: AGORA, enviar, limite: 2 });

    expect(enviados).toHaveLength(2);
    expect(r.candidatos).toBe(2);
  });
});

describe('trava contra lembrete duplicado', () => {
  it('duas execuções sobrepostas mandam uma vez só', async () => {
    await criarUsuario({ id: 'uma-vez', diaDaJornada: 2 });

    const { enviados, enviar } = enviadorFalso();
    // Ao mesmo tempo, como duas execuções do cron se sobrepondo.
    const [a, b] = await Promise.all([
      enviarLembretes(envTeste, { agora: AGORA, enviar }),
      enviarLembretes(envTeste, { agora: AGORA, enviar }),
    ]);

    expect(enviados).toHaveLength(1);
    expect(a.enviados + b.enviados).toBe(1);

    const linhas = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_envios').first<{
      n: number;
    }>();
    expect(linhas?.n).toBe(1);
  });

  it('a execução seguinte, no mesmo dia, não repete', async () => {
    await criarUsuario({ id: 'uma-vez', diaDaJornada: 2 });

    const { enviados, enviar } = enviadorFalso();
    await enviarLembretes(envTeste, { agora: AGORA, enviar });
    await enviarLembretes(envTeste, { agora: '2026-10-23T10:05:00.000Z', enviar });

    expect(enviados).toHaveLength(1);
  });

  it('no dia seguinte, lembra de novo', async () => {
    await criarUsuario({ id: 'amanha', diaDaJornada: 2 });

    const { enviados, enviar } = enviadorFalso();
    await enviarLembretes(envTeste, { agora: AGORA, enviar });
    await enviarLembretes(envTeste, { agora: '2026-10-24T10:00:00.000Z', enviar });

    expect(enviados).toHaveLength(2);
    expect(enviados.map((e) => e.mensagem.titulo)).toEqual([
      'Oração do dia 2',
      'Oração do dia 3',
    ]);
  });
});

describe('mensagem do lembrete', () => {
  it('usa o push_text do dia e aponta para a lição', async () => {
    await criarUsuario({ id: 'dia3', diaDaJornada: 3 });

    const licao = await licaoDoLembrete(env.DB, 'dia3', 'America/Sao_Paulo', AGORA);
    const mensagem = montarMensagem(licao!);

    expect(licao?.dia).toBe(3);
    expect(mensagem.titulo).toBe('Oração do dia 3');
    expect(mensagem.corpo).toBe(licao?.push_text);
    expect(mensagem.corpo.length).toBeGreaterThan(10);
    expect(mensagem.url).toBe('/licao/jornada-19-d03?origem=push');
    // Mesma tag: um lembrete substitui o outro em vez de empilhar.
    expect(mensagem.tag).toBe('oracao-do-dia');
  });
});
