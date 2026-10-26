/** Chamadas à API. Erro vira exceção com o código que o Worker devolveu. */
export class ErroApi extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
  ) {
    super(codigo);
  }
}

export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
  const res = await fetch(caminho, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    const corpo = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ErroApi(corpo.error ?? `http_${res.status}`, res.status);
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
    | 'push_erro_cliente',
  props: {
    lesson_id?: string;
    dia?: number;
    programa?: string;
    /** `push_erro_cliente`: onde parou, o que explodiu e o status, se houver. */
    etapa?: string;
    erro?: string;
    status?: number;
  } = {},
): void {
  void api('/api/eventos', {
    method: 'POST',
    body: JSON.stringify({ nome, ...props }),
  }).catch(() => undefined);
}
