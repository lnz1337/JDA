import { useCallback, useEffect, useState } from 'react';
import { api, type Me } from './lib/api';
import { irPara, useRota } from './lib/rota';
import { Entrar } from './screens/Entrar';
import { Home } from './screens/Home';
import { Inicio } from './screens/Inicio';
import { Licao } from './screens/Licao';
import { Programa } from './screens/Programa';
import { SemAcesso } from './screens/SemAcesso';

type Estado = { fase: 'carregando' } | { fase: 'deslogado' } | { fase: 'logado'; me: Me };

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const rota = useRota();

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
    irPara('/');
  }, []);

  if (estado.fase === 'carregando') {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-lg text-noite-300">carregando…</p>
      </main>
    );
  }

  if (estado.fase === 'deslogado') {
    // Deslogado só tem duas telas: a apresentação pública e o login.
    if (rota.nome === 'entrar') return <Entrar aoEntrar={carregar} />;
    return <Inicio aoEntrar={() => irPara('/entrar')} />;
  }

  if (!estado.me.temAcesso) {
    return <SemAcesso suporte={estado.me.suporte} aoSair={sair} />;
  }

  if (rota.nome === 'programa') return <Programa id={rota.id} />;
  if (rota.nome === 'licao') return <Licao id={rota.id} />;

  return <Home me={estado.me} aoSair={sair} />;
}
