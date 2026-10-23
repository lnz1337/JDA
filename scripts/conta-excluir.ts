/**
 * Exclusão de conta pedida pelo suporte (CLAUDE.md §14).
 *
 *   node scripts/conta-excluir.ts --email pessoa@exemplo.com --env production
 *   ... --confirmar      apaga de verdade
 *
 * Enquanto a tela de Perfil não existe (fase 7), é por aqui que a pessoa exerce
 * o direito de exclusão: ela escreve para o suporte e alguém roda isto.
 *
 * **Sem `--confirmar` ele só mostra.** A exclusão anonimiza e não tem volta, e um
 * e-mail digitado errado apaga a conta de outra pessoa. O passo a mais custa um
 * comando e evita um estrago que não dá para desfazer.
 *
 * Autentica com a ADMIN_API_KEY do ambiente ou do .dev.vars — que é a de
 * **staging**. Para produção, a chave tem que estar no ambiente: a de produção
 * foi gerada sem cópia (ver docs/ESTADO.md).
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
const confirmar = argv.includes('--confirmar');

if (!email || !email.includes('@')) {
  console.error('uso: node scripts/conta-excluir.ts --email <e-mail> --env <staging|production> [--confirmar]');
  process.exit(1);
}

const base = URLS[ambiente];
if (!base) {
  console.error(`ambiente desconhecido: ${ambiente}`);
  process.exit(1);
}

const res = await fetch(`${base}/api/admin/excluir-conta`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': exigirSegredo('ADMIN_API_KEY') },
  body: JSON.stringify({ email, ...(confirmar ? { confirmar: true } : {}) }),
});

const corpo = (await res.json()) as {
  error?: string;
  nome?: string | null;
  produtos?: string[];
  assinatura?: { status: string; proxima_cobranca: string | null } | null;
  assinatura_ativa?: boolean;
  excluido?: boolean;
};

if (!res.ok) {
  console.error(
    corpo.error === 'usuario_nao_encontrado'
      ? `Nenhuma conta ativa com ${email} em ${ambiente}.`
      : `HTTP ${res.status}: ${JSON.stringify(corpo)}`,
  );
  process.exit(1);
}

console.log(`\nConta: ${email}${corpo.nome ? ` (${corpo.nome})` : ''} — ambiente ${ambiente}`);
console.log(`Produtos ativos: ${corpo.produtos?.length ? corpo.produtos.join(', ') : 'nenhum'}`);
console.log(
  `Assinatura: ${
    corpo.assinatura
      ? `${corpo.assinatura.status}${
          corpo.assinatura.proxima_cobranca ? `, próxima em ${corpo.assinatura.proxima_cobranca}` : ''
        }`
      : 'nenhuma'
  }`,
);

if (corpo.assinatura_ativa) {
  console.warn(
    '\nATENÇÃO: esta conta tem assinatura válida.' +
      '\nExcluir a conta aqui NÃO cancela a cobrança na Payt — a pessoa continuaria' +
      '\npagando por um acesso que deixou de existir. Cancele no painel da Payt antes.',
  );
}

if (!corpo.excluido) {
  console.log(
    '\n(prévia: nada foi apagado)\nPara apagar de verdade, repita com --confirmar:' +
      `\n  npm run conta:excluir -- --email ${email} --env ${ambiente} --confirmar`,
  );
  process.exit(0);
}

console.log(
  '\nExcluída: nome, e-mail e telefone apagados, sessões e notificações encerradas,' +
    '\nintenções tiradas do Mural. O histórico de compra fica, sem dono (§14).',
);
