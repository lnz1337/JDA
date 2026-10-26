import { useCallback, useEffect, useState } from 'react';
import { api, type Me, registrarEvento } from './lib/api';
import { assinaturaAtual, permissaoDeNotificacao } from './lib/dispositivo';
import { garantirAssinatura } from './lib/lembrete';
import { irPara, useRota } from './lib/rota';
import { Entrar } from './screens/Entrar';
import { Home } from './screens/Home';
import { Inicio } from './screens/Inicio';
import { Licao } from './screens/Licao';
import { Onboarding, deveRodarOnboarding, marcarOnboardingFeito } from './screens/Onboarding';
import { PassoHorario } from './screens/PassoHorario';
import { PassoInstalar } from './screens/PassoInstalar';
import { PassoLembrete } from './screens/PassoLembrete';
import { Programa } from './screens/Programa';
import { SemAcesso } from './screens/SemAcesso';

type Estado = { fase: 'carregando' } | { fase: 'deslogado' } | { fase: 'logado'; me: Me };

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [onboarding, setOnboarding] = useState(deveRodarOnboarding);
  const rota = useRota();
  /** `null` enquanto não se sabe: consultar o `pushManager` é assíncrono. */
  const [semAssinatura, setSemAssinatura] = useState<boolean | null>(null);

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

  /*
   * Abriu pela notificação: registra e tira o `origem=push` da URL. Deixar o
   * parâmetro faria o recarregar da página contar de novo, e ele apareceria no
   * link que a pessoa manda para alguém.
   */
  /*
   * Permissão concedida e sem assinatura neste aparelho — reinstalou, limpou os
   * dados, o navegador expirou a assinatura. Refaz em silêncio: a pessoa já
   * disse sim uma vez, e perguntar de novo seria atrito sem motivo.
   */
  useEffect(() => {
    if (estado.fase === 'logado') void garantirAssinatura();
  }, [estado.fase]);

  /*
   * Este aparelho está assinado? É o que decide o que a rota `/lembrete` mostra.
   * Refaz a cada troca de rota porque o `garantirAssinatura` acima pode ter
   * assinado no caminho.
   */
  useEffect(() => {
    if (estado.fase !== 'logado') {
      setSemAssinatura(null);
      return;
    }

    let vivo = true;
    void assinaturaAtual().then((a) => {
      if (vivo) setSemAssinatura(a === null);
    });
    return () => {
      vivo = false;
    };
  }, [estado.fase, rota.nome]);

  useEffect(() => {
    const parametros = new URLSearchParams(location.search);
    if (parametros.get('origem') !== 'push') return;

    registrarEvento('push_aberto');
    parametros.delete('origem');
    const busca = parametros.toString();
    history.replaceState({}, '', `${location.pathname}${busca ? `?${busca}` : ''}`);
  }, []);

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

  // O onboarding só aparece na Home: quem chegou pelo push vai direto para a
  // oração, e quem está no meio da jornada não é interrompido para instalar.
  if (onboarding && rota.nome === 'inicio') {
    return (
      <Onboarding
        aoTerminar={() => {
          marcarOnboardingFeito();
          setOnboarding(false);
        }}
      />
    );
  }

  if (rota.nome === 'programa') return <Programa id={rota.id} />;
  if (rota.nome === 'licao') return <Licao id={rota.id} />;

  // Chamadas pelos cards da Home, para quem disse "Agora não" antes.
  if (rota.nome === 'instalar') return <PassoInstalar aoPular={() => irPara('/')} />;

  if (rota.nome === 'lembrete') {
    /*
     * Permissão concedida não quer dizer assinado. Esta rota ia direto para o
     * horário, e escolher a hora sem assinatura não liga nada: era por isso que
     * o push de confirmação respondia `sem_assinatura`. Com a permissão dada e
     * sem assinatura, o que falta é justamente o `ligarLembrete`.
     */
    if (semAssinatura === null) {
      return (
        <main className="flex min-h-dvh items-center justify-center">
          <p className="text-lg text-noite-300">carregando…</p>
        </main>
      );
    }

    return permissaoDeNotificacao() === 'granted' && !semAssinatura ? (
      <PassoHorario aoTerminar={() => irPara('/')} />
    ) : (
      <PassoLembrete
        aoLigar={() => irPara('/lembrete')}
        aoPular={() => irPara('/')}
        aoSeguir={() => irPara('/')}
      />
    );
  }

  return <Home me={estado.me} aoSair={sair} />;
}
