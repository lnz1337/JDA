/** Chamadas à API. Erro vira exceção com o código que o Worker devolveu. */
import { ErroApi } from './erro-api';

export { ErroApi } from './erro-api';

export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
  const res = await fetch(caminho, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const codigo = typeof corpo.error === 'string' ? corpo.error : `http_${res.status}`;
    throw new ErroApi(codigo, res.status, corpo);
  }
  return (await res.json()) as T;
}

export interface Me {
  usuario: {
    id: string;
    email: string | null;
    nome: string | null;
    timezone?: string;
    prayer_hour?: number;
  };
  produtos: Array<{ id: string; name: string; kind: string }>;
  temAcesso: boolean;
  suporte: string | null;
}

/** Eventos do funil que só o client sabe (§13). Falha de evento nunca atrapalha. */
export function registrarEvento(
  nome:
    | 'lesson_started'
    | 'audio_completed'
    | 'push_aberto'
    | 'app_instalado'
    | 'push_ativado'
    | 'push_negado'
    | 'push_erro_cliente'
    | 'store_viewed'
    | 'product_viewed'
    | 'checkout_clicked'
    | 'offer_clicked',
  props: {
    lesson_id?: string;
    dia?: number;
    programa?: string;
    /** Fase 6: qual produto da loja o evento é. */
    produto?: string;
    /** De onde veio a venda: a Loja ou o card de oferta da Home (§9). */
    canal?: 'loja' | 'home';
    /** `push_ativado`: 'botao' (a pessoa tocou) ou 'automatico' (reassinou só). */
    origem?: string;
    /** `push_erro_cliente`: onde parou, o que explodiu e o status, se houver. */
    etapa?: string;
    erro?: string;
    status?: number;
  } = {},
): void {
  void api('/api/eventos', {
    method: 'POST',
    body: JSON.stringify({ nome, ...props }),
    /*
     * O evento tem que sair mesmo que o app vá para o fundo no instante
     * seguinte. Sem isto o navegador cancela o fetch junto com a página, e foi
     * o que aconteceu em 26/10: duas tentativas de assinar falharam, o
     * `push_erro_cliente` foi disparado e nunca chegou ao Worker — o funil
     * ficou com buraco justamente onde estava o defeito.
     */
    keepalive: true,
  }).catch(() => undefined);
}
