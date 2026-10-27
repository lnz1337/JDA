/**
 * Qual card de convite a Home mostra (CLAUDE.md §11).
 *
 * Separado do `passoAtual` do onboarding porque a ordem é outra: o onboarding
 * em tela cheia pede para instalar primeiro, e o card da Home pede o lembrete
 * primeiro. No Android o push funciona no Chrome sem instalar, e quem pulou a
 * instalação — ou tem um Chrome que nem oferece instalar — nunca via o convite
 * do lembrete, que é o que traz a pessoa de volta todo dia.
 *
 * No iPhone a ordem não muda nada: fora da tela inicial não há `PushManager`,
 * então o lembrete só vale com o app instalado, e aí não há o que instalar.
 *
 * Função pura, sem `window`: quem chama lê o aparelho e passa o retrato.
 */
export type Convite = 'instalar' | 'lembrete' | null;

export interface RetratoDoAparelho {
  celular: boolean;
  ios: boolean;
  standalone: boolean;
  suportaPush: boolean;
  permissao: 'default' | 'granted' | 'denied' | 'indisponivel';
  instalarDispensado: boolean;
  lembreteDispensado: boolean;
}

export function conviteDaHome(a: RetratoDoAparelho): Convite {
  // Desktop não instala nem recebe lembrete: ele não é o aparelho de oração.
  if (!a.celular) return null;

  const podeOferecerLembrete = a.ios ? a.standalone : a.standalone || a.suportaPush;
  if (podeOferecerLembrete && a.permissao === 'default' && !a.lembreteDispensado) {
    return 'lembrete';
  }

  if (!a.standalone && !a.instalarDispensado) return 'instalar';

  return null;
}
