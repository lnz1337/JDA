/**
 * Exporta quem não dá para alcançar por e-mail, para o contato por WhatsApp.
 *
 *   node scripts/exportar-sem-email.ts --env production [--saida lista.csv]
 *
 * Entram: quem tem telefone e (não tem e-mail) OU (o último envio para ele
 * falhou). O link de acesso vai pronto, para colar na mensagem.
 */
import { writeFileSync } from 'node:fs';
import { consultar } from './lib/d1.ts';

const argv = process.argv.slice(2);
const valor = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const ambiente = valor('--env') ?? 'staging';
const saida = valor('--saida') ?? `sem-email-${ambiente}.csv`;
const BASES: Record<string, string> = {
  staging: 'https://jda-pwa-staging.leonardovcs2022.workers.dev',
  production: 'https://jornadacomeuanjo.com',
};
const base = BASES[ambiente] ?? BASES.staging!;

interface Linha {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  produtos: string | null;
}

const linhas = consultar<Linha>(
  `SELECT u.name AS nome, u.phone AS telefone, u.email,
          (SELECT GROUP_CONCAT(p.name, ' / ')
             FROM entitlements e JOIN products p ON p.id = e.product_id
            WHERE e.user_id = u.id AND e.status = 'active') AS produtos
     FROM users u
    WHERE u.deleted_at IS NULL
      AND u.phone IS NOT NULL AND u.phone != ''
      AND EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = u.id AND e.status = 'active')
      AND (
        u.email IS NULL
        OR EXISTS (
          SELECT 1 FROM events ev
           WHERE ev.user_id = u.id AND ev.name = 'email_falhou'
        )
      )
    ORDER BY u.created_at`,
  ambiente,
);

function campo(v: string | null): string {
  const s = (v ?? '').replace(/"/g, '""');
  return /[",;\n]/.test(s) ? `"${s}"` : s;
}

const csv = [
  'nome;telefone;produtos;link_acesso',
  ...linhas.map((l) =>
    [
      campo(l.nome),
      campo(l.telefone),
      campo(l.produtos),
      campo(l.email ? `${base}/entrar?e=${encodeURIComponent(l.email)}` : `${base}/entrar`),
    ].join(';'),
  ),
].join('\n');

writeFileSync(saida, `﻿${csv}`, 'utf8');
console.log(`${linhas.length} pessoa(s) -> ${saida}`);
