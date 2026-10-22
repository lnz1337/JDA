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
  usuario: { id: string; email: string | null; nome: string | null };
  produtos: Array<{ id: string; name: string; kind: string }>;
  temAcesso: boolean;
  suporte: string | null;
}
