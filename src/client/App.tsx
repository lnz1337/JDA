import { useCallback, useEffect, useState } from 'react';
import { APP_NAME } from '../shared/constants';
import { api, type Me } from './lib/api';
import { Entrar } from './screens/Entrar';
import { SemAcesso } from './screens/SemAcesso';

type Estado = { fase: 'carregando' } | { fase: 'deslogado' } | { fase: 'logado'; me: Me };

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });

  const carregar = useCallback(async () => {
    try {
      setEstado({ fase: 'logado', me: await api<Me>('/api/me') });
    } catch {
      setEstado({ fase: 'deslogado' });
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const sair = useCallback(async () => {
    await api('/api/auth/sair', { method: 'POST' }).catch(() => undefined);
    setEstado({ fase: 'deslogado' });
  }, []);

  if (estado.fase === 'carregando') {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-noite-300">carregando…</p>
      </main>
    );
  }

  if (estado.fase === 'deslogado') {
    return <Entrar aoEntrar={carregar} />;
  }

  if (!estado.me.temAcesso) {
    return <SemAcesso suporte={estado.me.suporte} aoSair={sair} />;
  }

  const primeiro = estado.me.usuario.nome?.split(' ')[0];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-12">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ouro-500">
          {primeiro ? `Olá, ${primeiro}` : 'Olá'}
        </p>
        <h1 className="text-2xl font-semibold text-noite-900">{APP_NAME}</h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-noite-900">Liberado para você</h2>
        <ul className="space-y-2">
          {estado.me.produtos.map((p) => (
            <li
              key={p.id}
              className="rounded-2xl border border-noite-100 bg-white px-4 py-3 text-sm font-medium text-noite-900"
            >
              {p.name}
            </li>
          ))}
        </ul>
        {/* A jornada e o player entram na fase 5 (CLAUDE.md §16). */}
        <p className="text-sm text-noite-300">A jornada começa aqui em breve.</p>
      </section>

      <button type="button" onClick={sair} className="mt-auto text-sm text-noite-700 underline">
        Sair
      </button>
    </main>
  );
}
