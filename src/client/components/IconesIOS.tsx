/**
 * Ícones do passo a passo do iPhone, desenhados aqui.
 *
 * Não são recortes de tela da Apple: print envelhece a cada versão do iOS, pesa
 * no carregamento e não dá para colorir junto com o texto. Estes acompanham a
 * cor do texto (`currentColor`) e ficam nítidos em qualquer tela.
 */

const base = {
  width: 28,
  height: 28,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

/** O "Compartilhar" do Safari: quadrado com a seta saindo por cima. */
export function IconeCompartilhar() {
  return (
    <svg {...base} className="inline-block align-text-bottom">
      <title>Compartilhar</title>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

/** O "⋯" que no iOS 26 esconde o Compartilhar. */
export function IconeMaisOpcoes() {
  return (
    <svg {...base} className="inline-block align-text-bottom">
      <title>Mais opções</title>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** O "Adicionar à Tela de Início": quadrado com um mais dentro. */
export function IconeAdicionar() {
  return (
    <svg {...base} className="inline-block align-text-bottom">
      <title>Adicionar à Tela de Início</title>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

/** Os três pontinhos do Chrome no Android, que ficam na vertical. */
export function IconeMenuAndroid() {
  return (
    <svg {...base} className="inline-block align-text-bottom">
      <title>Menu do navegador</title>
      <circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
