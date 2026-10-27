/**
 * Provedores que dá para priorizar numa onda, e os domínios de cada um.
 *
 * Em `shared` porque a campanha (Worker) e o importador (script) contam pelos
 * mesmos domínios.
 *
 * Serve para subir reputação onde ela já existe antes de encostar em quem é
 * mais severo: o Gmail entrega na caixa de entrada desde o primeiro dia, e o
 * Outlook manda para o lixo eletrônico enquanto o domínio é novo (SCL 5, mesmo
 * com SPF, DKIM e DMARC passando).
 */
export const PROVEDORES: Record<string, string[]> = {
  gmail: ['gmail.com', 'googlemail.com'],
  outlook: [
    'outlook.com', 'outlook.com.br', 'hotmail.com', 'hotmail.com.br',
    'live.com', 'live.com.br', 'msn.com',
  ],
  yahoo: ['yahoo.com', 'yahoo.com.br', 'ymail.com', 'rocketmail.com'],
  icloud: ['icloud.com', 'me.com', 'mac.com'],
  uol: ['uol.com.br', 'bol.com.br'],
  terra: ['terra.com.br'],
  ig: ['ig.com.br'],
};
