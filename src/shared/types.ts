/** Tipos compartilhados entre o Worker e o client. */

export type AppEnvName = 'development' | 'production';

/** Resposta de `GET /api/health`. Liveness: não toca no banco. */
export interface HealthResponse {
  ok: true;
  app: string;
  env: AppEnvName;
  /** ISO 8601 UTC. */
  time: string;
  bindings: {
    db: boolean;
    media: boolean;
  };
}

/** Formato único de erro da API. */
export interface ApiErrorResponse {
  error: string;
  message?: string;
}

/* ------------------------------------------------------- jornada (fase 5) */

export type EstadoLicao = 'concluido' | 'hoje' | 'liberado' | 'bloqueado';

export interface LicaoNaLista {
  id: string;
  dia: number;
  titulo: string;
  frase: string | null;
  estado: EstadoLicao;
  tem_audio: boolean;
  duracao_s: number | null;
  /** Só quando `bloqueado`: quantos dias faltam. 1 = "libera amanhã". */
  dias_para_liberar?: number;
}

export interface Programa {
  id: string;
  titulo: string;
  produto_id: string;
  produto_nome: string;
  notice: string | null;
  unlock_rule: 'daily' | 'all';
  total_days: number;
  concluidos: number;
  /** Para onde o botão da Home leva: hoje, ou o primeiro não concluído. */
  atual: LicaoNaLista | null;
}

export interface LicaoCompleta extends LicaoNaLista {
  programa_id: string;
  programa_titulo: string;
  /** 'daily' diz "Dia 2 de 19"; 'all' diz "Parte 2 de 4". */
  unlock_rule: 'daily' | 'all';
  total_days: number;
  notice: string | null;
  body_md: string | null;
  /** Caminho no Worker, nunca a chave do R2. */
  audio_url: string | null;
  bonus_audio_url: string | null;
  bonus_title: string | null;
}

/* ------------------------------------------------------------ loja (fase 6) */

export type TipoDeProduto = 'program' | 'bundle' | 'subscription';

export interface ItemDaLoja {
  id: string;
  nome: string;
  kind: TipoDeProduto;
  preco_cents: number | null;
  /** Tem link de checkout usável. Sem ele, a tela não mostra botão de compra. */
  tem_checkout: boolean;
  tem_acesso: boolean;
  /** Os nomes do que vem dentro, quando é bundle; vazio quando não é. */
  inclui: string[];
  /** Caminho no app para quem já tem o produto; `null` para quem não tem. */
  abrir: string | null;
}

export interface ParteDoProduto {
  id: string;
  nome: string;
  programa_id: string | null;
  /** Só os títulos: a prévia da loja não entrega conteúdo pago. */
  licoes: string[];
}

export interface ProdutoDaLoja extends ItemDaLoja {
  descricao_md: string | null;
  /** Avisos obrigatórios (§14): o do produto e os das partes, sem repetir. */
  avisos: string[];
  partes: ParteDoProduto[];
  /** Já com as UTMs da loja; `null` quando não há checkout cadastrado. */
  checkout_url: string | null;
  /** O e-mail da conta, para o aviso logo acima do botão de compra. */
  email_da_conta: string | null;
}
