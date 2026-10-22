/**
 * Moldura HTML dos e-mails (CLAUDE.md §8).
 *
 * O público é 55+ e boa parte lê no Outlook/Hotmail, que renderiza e-mail com o
 * motor do Word. Daí as escolhas:
 *
 * - **tabela, não flex nem grid**: o Word não implementa nenhum dos dois;
 * - **estilo inline em cada elemento**: `<style>` no `<head>` é descartado por
 *   vários clientes, inclusive o Outlook de desktop;
 * - **uma coluna, 600px**: largura que couber em qualquer painel de leitura;
 * - **corpo em 19px com entrelinha 1.65**: letra grande é requisito, não
 *   estética — quem tem 60 anos lê no celular sem óculos de leitura;
 * - **nada de imagem**: imagem bloqueada por padrão deixaria o e-mail sem
 *   sentido, e peso de imagem conta contra a reputação de quem acabou de
 *   começar a enviar.
 *
 * O rodapé é só o nome do app e o motivo de a pessoa estar recebendo aquele
 * e-mail. Dado de empresa (razão social, CNPJ) fica na página de privacidade,
 * não aqui.
 */
import { APP_NAME } from '../../shared/constants';

export const CORES = {
  papel: '#faf7f2',
  cartao: '#ffffff',
  texto: '#141233',
  textoSuave: '#2f2c73',
  borda: '#dcdff5',
  noite: '#1e1b4b',
  destaque: '#f3f1fb',
} as const;

const FONTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif";

/** Corpo do texto. Tudo que o conteúdo gera herda daqui. */
export const ESTILO_CORPO = `font-family:${FONTE};font-size:19px;line-height:1.65;color:${CORES.texto}`;

export const ESTILOS = {
  paragrafo: `margin:0 0 18px;${ESTILO_CORPO}`,
  titulo: `margin:0 0 16px;font-family:${FONTE};font-size:24px;line-height:1.35;font-weight:600;color:${CORES.texto}`,
  lista: `margin:0 0 18px;padding-left:24px;${ESTILO_CORPO}`,
  item: 'margin:0 0 10px',
  citacao: `margin:0 0 18px;padding:12px 18px;border-left:4px solid ${CORES.borda};${ESTILO_CORPO};color:${CORES.textoSuave}`,
  link: `color:${CORES.textoSuave};text-decoration:underline`,
  /** Botão: `inline-block` com padding, porque o Word ignora `height` em `<a>`. */
  botao: `display:inline-block;padding:18px 32px;background-color:${CORES.noite};color:#ffffff;font-family:${FONTE};font-size:19px;font-weight:600;line-height:1.2;text-decoration:none;border-radius:12px`,
  /** O código de login, grande o bastante para ler de longe e copiar à mão. */
  destaque: `margin:0 0 20px;padding:20px 16px;background-color:${CORES.destaque};border:1px solid ${CORES.borda};border-radius:12px;font-family:${FONTE};font-size:40px;line-height:1.2;font-weight:700;letter-spacing:6px;text-align:center;color:${CORES.noite}`,
  rodape: `margin:0;font-family:${FONTE};font-size:15px;line-height:1.6;color:${CORES.textoSuave}`,
} as const;

/**
 * Embrulha o conteúdo já renderizado num documento completo.
 * `rodape` já vem como HTML; sem rodapé, nenhum é inventado.
 */
export function documento(conteudo: string, rodape?: string): string {
  const bloco = rodape
    ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:20px 28px 8px;text-align:center">
            <p style="${ESTILOS.rodape}"><strong>${APP_NAME}</strong></p>
            <p style="${ESTILOS.rodape}">${rodape}</p>
          </td></tr>
        </table>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${CORES.papel};-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CORES.papel}">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px">
        <tr>
          <td style="padding:32px 28px;background-color:${CORES.cartao};border:1px solid ${CORES.borda};border-radius:16px">
${conteudo}
          </td>
        </tr>
      </table>${bloco}
    </td>
  </tr>
</table>
</body>
</html>`;
}
