/**
 * A volta do checkout (CLAUDE.md §7).
 *
 * A compra acontece **fora** do app: o botão abre o checkout da Payt, e o
 * acesso só existe quando o postback chega. Cartão libera em segundos; Pix e
 * boleto podem levar minutos. Então, ao voltar, o app pergunta de tempos em
 * tempos se já liberou, em vez de pedir para a pessoa recarregar a página —
 * recarregar é justamente o que quem tem 55+ não vai pensar em fazer.
 *
 * O que está pendente fica em `localStorage` porque o app pode ser **fechado**
 * no caminho: no iPhone o checkout abre no Safari, fora do app instalado, e
 * voltar pelo ícone é uma abertura nova.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { irPara } from './rota';

const CHAVE = 'compra:pendente';

/** Dois minutos de espera e cinco segundos entre as perguntas (§7). */
const JANELA_MS = 2 * 60_000;
const INTERVALO_MS = 5_000;

export interface CompraPendente {
  produtoId: string;
  desde: number;
}

export function marcarCompra(produtoId: string): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ produtoId, desde: Date.now() }));
  } catch {
    /* sem armazenamento: a pessoa recarrega e vê o conteúdo do mesmo jeito */
  }
}

export function limparCompra(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* idem */
  }
}

/** A compra em andamento, se houver e se ainda estiver dentro da janela. */
export function compraPendente(): CompraPendente | null {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return null;

    const dado = JSON.parse(cru) as Partial<CompraPendente>;
    if (typeof dado.produtoId !== 'string' || typeof dado.desde !== 'number') return null;

    // Compra de ontem não interessa: a janela é de dois minutos, e perguntar
    // sobre ela abriria o produto errado na próxima vez que o app abrisse.
    if (Date.now() - dado.desde > JANELA_MS) {
      limparCompra();
      return null;
    }
    return { produtoId: dado.produtoId, desde: dado.desde };
  } catch {
    return null;
  }
}

async function jaLiberou(produtoId: string): Promise<boolean> {
  const { produtos } = await api<{ produtos: string[] }>('/api/me/entitlements');
  return produtos.includes(produtoId);
}

export type EstadoDaVolta = 'nada' | 'esperando' | 'liberado' | 'demorando';

export interface VoltaDaCompra {
  estado: EstadoDaVolta;
  produtoId: string | null;
  dispensar: () => void;
}

/**
 * Pergunta ao servidor, enquanto a pessoa estiver olhando, se a compra liberou.
 *
 * Só com a aba visível: perguntar de fundo gastaria bateria e rede para
 * ninguém ver a resposta. Por isso o laço também começa no `visibilitychange` —
 * o momento exato em que a pessoa volta do checkout.
 */
export function useVoltaDaCompra(): VoltaDaCompra {
  const [estado, setEstado] = useState<EstadoDaVolta>('nada');
  const [produtoId, setProdutoId] = useState<string | null>(null);
  const relogio = useRef<ReturnType<typeof setInterval> | null>(null);

  const parar = useCallback(() => {
    if (relogio.current !== null) {
      clearInterval(relogio.current);
      relogio.current = null;
    }
  }, []);

  const dispensar = useCallback(() => {
    parar();
    limparCompra();
    setEstado('nada');
    setProdutoId(null);
  }, [parar]);

  useEffect(() => {
    let vivo = true;

    async function perguntar(pendente: CompraPendente) {
      if (!vivo) return;

      if (Date.now() - pendente.desde > JANELA_MS) {
        parar();
        limparCompra();
        // Sem tom de erro: o pagamento pode estar certo e só demorando.
        setEstado('demorando');
        return;
      }

      try {
        if (!(await jaLiberou(pendente.produtoId))) return;
      } catch {
        // Sem rede agora: a próxima pergunta tenta de novo, dentro da janela.
        return;
      }

      if (!vivo) return;
      parar();
      limparCompra();
      setEstado('liberado');
      irPara(`/produto/${pendente.produtoId}`);
    }

    function comecar() {
      if (document.visibilityState !== 'visible' || relogio.current !== null) return;

      const pendente = compraPendente();
      if (!pendente) return;

      setProdutoId(pendente.produtoId);
      setEstado('esperando');
      void perguntar(pendente);
      relogio.current = setInterval(() => void perguntar(pendente), INTERVALO_MS);
    }

    comecar();
    addEventListener('visibilitychange', comecar);
    addEventListener('focus', comecar);

    return () => {
      vivo = false;
      parar();
      removeEventListener('visibilitychange', comecar);
      removeEventListener('focus', comecar);
    };
  }, [parar]);

  return { estado, produtoId, dispensar };
}
