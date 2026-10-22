/** Constantes usadas pelo Worker e pelo client. */
export const APP_NAME = 'Jornada com Meu Anjo';
export const APP_SHORT_NAME = 'Meu Anjo';
export const APP_DESCRIPTION =
  'Jornada devocional de 19 dias com São Miguel Arcanjo: oração do dia, novenas e mural de intenções.';

/** Domínio de produção. O staging continua em workers.dev. */
export const APP_DOMINIO = 'jornadacomeuanjo.com';
export const EMAIL_SUPORTE = 'suporte@jornadacomeuanjo.com';

export const THEME_COLOR = '#1e1b4b';
export const BACKGROUND_COLOR = '#faf7f2';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_PRAYER_HOUR = 7;

export const JOURNEY_TOTAL_DAYS = 19;

/** Login por código (CLAUDE.md §8). */
export const CODIGO_DIGITOS = 6;
export const CODIGO_VALIDADE_MIN = 15;
export const CODIGO_MAX_TENTATIVAS = 5;
/** Pedidos de código por hora, por e-mail e por IP. */
export const CODIGO_MAX_POR_HORA = 5;
export const SESSAO_DIAS = 90;
export const INTENTION_MAX_LENGTH = 280;
