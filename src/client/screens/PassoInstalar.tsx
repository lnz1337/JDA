import { useEffect, useState } from 'react';
import { APP_SHORT_NAME } from '../../shared/constants';
import {
  IconeAdicionar,
  IconeCompartilhar,
  IconeMaisOpcoes,
  IconeMenuAndroid,
} from '../components/IconesIOS';
import { registrarEvento } from '../lib/api';
import { ehIOS } from '../lib/dispositivo';

/**
 * Quanto esperamos pelo `beforeinstallprompt` antes de mostrar o passo a passo
 * manual. O evento é instantâneo quando existe; a espera só cobre o tempo de o
 * navegador decidir.
 */
const ESPERA_PROMPT_MS = 2000;

interface PromptDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Colocar o app na tela inicial (CLAUDE.md §12).
 *
 * No iPhone isto não é conveniência: **push só funciona no app aberto pelo
 * ícone** (§11). No Android é o que tira o app de dentro de uma aba.
 *
 * Uma ação por tela, letra grande, e "Agora não" sempre visível: ninguém fica
 * preso no onboarding.
 */
export function PassoInstalar({
  aoInstalar,
  aoPular,
}: {
  /** Instalou (ou já estava): segue para o próximo passo. */
  aoInstalar?: () => void;
  /** Disse "Agora não": o onboarding para por aqui. */
  aoPular: () => void;
}) {
  const seguir = aoInstalar ?? aoPular;
  const [prompt, setPrompt] = useState<PromptDeInstalacao | null>(null);
  const [esperou, setEsperou] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const ios = ehIOS();

  useEffect(() => {
    if (ios) return;

    const guardar = (e: Event) => {
      // Sem isto o Chrome mostra a própria barra de instalação, e aí são dois
      // convites competindo na mesma tela.
      e.preventDefault();
      setPrompt(e as PromptDeInstalacao);
    };

    const instalou = () => {
      registrarEvento('app_instalado');
      seguir();
    };

    addEventListener('beforeinstallprompt', guardar);
    addEventListener('appinstalled', instalou);

    // Navegador sem suporte, ou navegador interno do Gmail e do Instagram: o
    // evento nunca vem, e o passo manual é a única saída.
    const relogio = setTimeout(() => setEsperou(true), ESPERA_PROMPT_MS);

    return () => {
      removeEventListener('beforeinstallprompt', guardar);
      removeEventListener('appinstalled', instalou);
      clearTimeout(relogio);
    };
  }, [ios, seguir]);

  async function instalar() {
    if (!prompt) return;
    await prompt.prompt();
    const escolha = await prompt.userChoice;
    if (escolha.outcome === 'accepted') {
      registrarEvento('app_instalado');
      seguir();
      return;
    }
    // Recusou o diálogo do sistema: é um "não", e vale como "Agora não".
    aoPular();
  }

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(location.origin);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold leading-tight text-noite-900">
          Coloque o {APP_SHORT_NAME} na tela do seu celular
        </h1>
        <p className="text-lg leading-relaxed text-noite-700">
          Assim você abre o app com um toque, todos os dias, como qualquer outro aplicativo.
        </p>
      </header>

      {ios ? (
        <PassosIPhone />
      ) : prompt ? (
        <button
          type="button"
          onClick={() => void instalar()}
          className="min-h-[64px] w-full rounded-xl bg-noite-900 px-4 py-4 text-xl font-semibold text-white"
        >
          Colocar na tela inicial
        </button>
      ) : esperou ? (
        <PassosAndroid />
      ) : (
        <p className="text-lg text-noite-700">preparando…</p>
      )}

      {ios && (
        <section className="space-y-3 border-t-2 border-noite-100 pt-5">
          <p className="text-base leading-relaxed text-noite-700">
            Não encontrou a opção? Abra este link no Safari.
          </p>
          <button
            type="button"
            onClick={() => void copiarLink()}
            className="min-h-[48px] w-full rounded-xl border-2 border-noite-900 px-4 py-3 text-lg font-semibold text-noite-900"
          >
            {copiado ? 'Link copiado ✓' : 'Copiar link'}
          </button>
        </section>
      )}

      <button
        type="button"
        onClick={aoPular}
        className="mt-auto min-h-[48px] w-full py-2 text-lg text-noite-700 underline"
      >
        Agora não
      </button>
    </main>
  );
}

function Passo({ numero, children }: { numero: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-noite-900 text-lg font-semibold text-white">
        {numero}
      </span>
      <span className="pt-1 text-lg leading-relaxed text-noite-900">{children}</span>
    </li>
  );
}

function PassosIPhone() {
  return (
    <ol className="space-y-4 rounded-2xl border-2 border-noite-100 bg-white px-5 py-5">
      <Passo numero={1}>
        Toque no botão Compartilhar <IconeCompartilhar />. Se ele não aparecer, toque primeiro em{' '}
        <IconeMaisOpcoes />.
      </Passo>
      <Passo numero={2}>
        Desça a lista e toque em <strong className="font-semibold">Adicionar à Tela de Início</strong>{' '}
        <IconeAdicionar />.
      </Passo>
      <Passo numero={3}>
        Toque em <strong className="font-semibold">Adicionar</strong>.
      </Passo>
      <Passo numero={4}>
        Feche o Safari e abra o app pelo ícone do {APP_SHORT_NAME}.
      </Passo>
    </ol>
  );
}

function PassosAndroid() {
  return (
    <ol className="space-y-4 rounded-2xl border-2 border-noite-100 bg-white px-5 py-5">
      <Passo numero={1}>
        Toque nos três pontinhos <IconeMenuAndroid />, no canto de cima.
      </Passo>
      <Passo numero={2}>
        Escolha <strong className="font-semibold">Instalar app</strong> ou{' '}
        <strong className="font-semibold">Adicionar à tela inicial</strong>.
      </Passo>
    </ol>
  );
}
