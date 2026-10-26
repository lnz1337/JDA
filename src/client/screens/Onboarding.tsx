import { useEffect, useState } from 'react';
import {
  assinaturaAtual,
  ehCelular,
  ehIOS,
  ehStandalone,
  gravarLocal,
  lerLocal,
  permissaoDeNotificacao,
  suportaPush,
} from '../lib/dispositivo';
import { PassoHorario } from './PassoHorario';
import { PassoInstalar } from './PassoInstalar';
import { PassoLembrete } from './PassoLembrete';

/** Chaves do aparelho. O que é da conta (hora, fuso) fica no banco. */
export const CHAVES = {
  instalarDispensado: 'onboarding:instalar:dispensado',
  lembreteDispensado: 'onboarding:lembrete:dispensado',
  horarioFeito: 'onboarding:horario:feito',
  /** O onboarding em tela cheia roda **uma vez por aparelho** (§11). */
  jaRodou: 'onboarding:feito',
} as const;

/** Quanto tempo um "Agora não" vale antes de o convite voltar (§11). */
export const DIAS_DISPENSADO = 7;

export function dispensadoRecentemente(chave: string): boolean {
  const quando = Number(lerLocal(chave) ?? 0);
  if (!quando) return false;
  return Date.now() - quando < DIAS_DISPENSADO * 86_400_000;
}

export function dispensar(chave: string): void {
  gravarLocal(chave, String(Date.now()));
}

export type Passo = 'instalar' | 'lembrete' | 'horario' | null;

/**
 * Qual passo mostrar agora, se algum.
 *
 * A ordem não é só estética: no iPhone o push **só existe** no app aberto pela
 * tela inicial, então pedir a permissão antes de instalar seria pedir uma coisa
 * que o aparelho não tem como dar — e um "não" aí não volta mais.
 */
export function passoAtual(): Passo {
  const standalone = ehStandalone();

  // Desktop não instala nem recebe lembrete: ele não é o aparelho de oração.
  if (!ehCelular()) return null;

  if (!standalone && !dispensadoRecentemente(CHAVES.instalarDispensado)) return 'instalar';

  // No iPhone, fora do standalone, não há PushManager: nem adianta oferecer.
  const podeOferecerLembrete = ehIOS() ? standalone : standalone || suportaPush();
  if (!podeOferecerLembrete) return null;

  const permissao = permissaoDeNotificacao();
  if (permissao === 'default' && !dispensadoRecentemente(CHAVES.lembreteDispensado)) {
    return 'lembrete';
  }

  if (permissao === 'granted' && !lerLocal(CHAVES.horarioFeito)) return 'horario';

  return null;
}

/**
 * Permissão concedida e este aparelho **sem assinatura**: o `subscribe` falhou,
 * ou a assinatura expirou, ou os dados do site foram limpos.
 *
 * Era o caso sem saída. O `passoAtual` só oferece o lembrete com a permissão em
 * `default`, então quem permitia e falhava na assinatura não via mais convite
 * nenhum — e a tela de falha mandava "tentar de novo pela tela inicial", onde
 * não havia nada para tocar.
 *
 * Fica separado do `passoAtual` porque consultar o `pushManager` é assíncrono, e
 * o `passoAtual` é lido durante a renderização.
 */
export async function precisaAssinarDeNovo(): Promise<boolean> {
  if (!ehCelular() || !suportaPush()) return false;
  if (permissaoDeNotificacao() !== 'granted') return false;
  // "Agora não" continua valendo: o convite volta daqui a uma semana.
  if (dispensadoRecentemente(CHAVES.lembreteDispensado)) return false;

  return (await assinaturaAtual()) === null;
}

/**
 * O onboarding em tela cheia deve rodar neste aparelho?
 *
 * Só na primeira vez. Depois dele, quem lembra é o card da Home — tomar a tela
 * inteira toda vez que a pessoa abre o app para repetir um convite que ela já
 * viu é o jeito mais rápido de ensinar que o app atrapalha.
 */
export function deveRodarOnboarding(): boolean {
  return !lerLocal(CHAVES.jaRodou) && passoAtual() !== null;
}

export function marcarOnboardingFeito(): void {
  gravarLocal(CHAVES.jaRodou, String(Date.now()));
}

/** Roda o onboarding e some quando não há mais nada a perguntar. */
export function Onboarding({ aoTerminar }: { aoTerminar: () => void }) {
  const [passo, setPasso] = useState<Passo>(() => passoAtual());

  // Instalar e permitir mudam o estado do aparelho por fora do React.
  useEffect(() => {
    const recalcular = () => setPasso(passoAtual());
    addEventListener('visibilitychange', recalcular);
    return () => removeEventListener('visibilitychange', recalcular);
  }, []);

  function seguir() {
    const proximo = passoAtual();
    if (proximo === passo || proximo === null) {
      aoTerminar();
      return;
    }
    setPasso(proximo);
  }

  if (passo === 'instalar') {
    return (
      <PassoInstalar
        aoInstalar={seguir}
        aoPular={() => {
          /*
           * "Agora não" encerra o onboarding. Emendar o próximo passo logo
           * depois de um "não" é ignorar a resposta; o convite volta no card da
           * Home, daqui a uma semana.
           */
          dispensar(CHAVES.instalarDispensado);
          aoTerminar();
        }}
      />
    );
  }

  if (passo === 'lembrete') {
    return (
      <PassoLembrete
        aoLigar={seguir}
        aoPular={() => {
          dispensar(CHAVES.lembreteDispensado);
          aoTerminar();
        }}
        /*
         * Falha não é "Agora não": dispensar aqui escondia o convite por sete
         * dias justamente de quem precisava tentar de novo. Só encerra a tela;
         * quem oferece de novo é o card da Home.
         */
        aoSeguir={aoTerminar}
      />
    );
  }

  if (passo === 'horario') {
    return (
      <PassoHorario
        aoTerminar={() => {
          gravarLocal(CHAVES.horarioFeito, String(Date.now()));
          aoTerminar();
        }}
      />
    );
  }

  return null;
}
