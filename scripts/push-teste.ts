/**
 * Manda um push de teste para os aparelhos de alguém (CLAUDE.md §11).
 *
 *   node scripts/push-teste.ts --email pessoa@exemplo.com --env staging
 *   ... --titulo "..." --corpo "..."
 *
 * Serve para conferir a corrente inteira — VAPID, assinatura, serviço de push e
 * service worker — sem esperar a hora do lembrete. Autentica com a
 * ADMIN_API_KEY, como o resto do administrativo.
 */
import { exigirSegredo } from './lib/segredos.ts';

const URLS: Record<string, string> = {
  staging: 'https://teste.jornadacomeuanjo.com',
  production: 'https://jornadacomeuanjo.com',
};

const argv = process.argv.slice(2);
const valor = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const email = (valor('--email') ?? '').trim();
const ambiente = valor('--env') ?? 'staging';

if (!email || !email.includes('@')) {
  console.error('uso: node scripts/push-teste.ts --email <e-mail> --env <staging|production>');
  process.exit(1);
}

const base = URLS[ambiente];
if (!base) {
  console.error(`ambiente desconhecido: ${ambiente}`);
  process.exit(1);
}

const res = await fetch(`${base}/api/admin/push-teste`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': exigirSegredo('ADMIN_API_KEY') },
  body: JSON.stringify({
    email,
    ...(valor('--titulo') ? { titulo: valor('--titulo') } : {}),
    ...(valor('--corpo') ? { corpo: valor('--corpo') } : {}),
  }),
});

const corpo = (await res.json()) as {
  error?: string;
  aparelhos?: number;
  resultados?: Array<{ servico: string; ok: boolean; erro?: string }>;
};

if (!res.ok) {
  const motivos: Record<string, string> = {
    usuario_nao_encontrado: `Nenhuma conta ativa com ${email} em ${ambiente}.`,
    sem_assinatura: `${email} não tem nenhum aparelho com lembrete ligado em ${ambiente}.`,
  };
  console.error(motivos[corpo.error ?? ''] ?? `HTTP ${res.status}: ${JSON.stringify(corpo)}`);
  process.exit(1);
}

console.log(`\n${corpo.aparelhos} aparelho(s) de ${email} em ${ambiente}:`);
for (const r of corpo.resultados ?? []) {
  console.log(`  ${r.ok ? 'enviado' : 'FALHOU '}  ${r.servico}${r.erro ? ` — ${r.erro}` : ''}`);
}

if ((corpo.resultados ?? []).some((r) => !r.ok)) process.exit(1);
