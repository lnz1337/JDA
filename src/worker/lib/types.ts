/**
 * `Env` vem de `worker-configuration.d.ts`, gerado por `npm run cf-typegen`
 * a partir dos bindings do wrangler.toml.
 *
 * Secrets não aparecem lá de propósito (não ficam em arquivo de configuração),
 * então são declarados aqui, a partir da lista do CLAUDE.md §15. São opcionais:
 * em um ambiente onde o secret não foi cadastrado, o código tem que reagir, não
 * confiar que existe.
 *
 * MAIL_FROM e MAIL_PROVIDER não entram: viraram vars do wrangler.toml, porque
 * endereço de remetente e escolha de provedor não são segredo.
 */
export interface Secrets {
  PAYT_INTEGRATION_KEY?: string;
  RESEND_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export type AppBindings = {
  Bindings: Env & Secrets;
};
