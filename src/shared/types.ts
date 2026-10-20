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
