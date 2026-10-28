/**
 * Lê o texto da campanha de anúncio.
 *
 * Os arquivos são do pipeline de conteúdo (`conteudo/emails/anuncio-app.md` e
 * `anuncio-app-curto.md`): este módulo só **lê**. A estrutura esperada é a que
 * está lá, igual nos dois — `## Assunto` com as opções A/B, o pré-cabeçalho e
 * `## Corpo`.
 */
import { APP_NAME } from '../../shared/constants';
import modeloPadrao from '../../../conteudo/emails/anuncio-app.md?raw';
import modeloCurto from '../../../conteudo/emails/anuncio-app-curto.md?raw';
import { renderizarEmail } from './render';

/**
 * Os dois textos do anúncio. O curto é escrito para parecer mensagem pessoal de
 * acesso (sem lista de vantagens, sem botão, sem assinatura) e testa se o Gmail
 * o põe em Principal em vez de Promoções.
 */
export const MODELOS_ANUNCIO = {
  padrao: { texto: modeloPadrao, arquivo: 'conteudo/emails/anuncio-app.md' },
  curto: { texto: modeloCurto, arquivo: 'conteudo/emails/anuncio-app-curto.md' },
} as const;

export type ModeloAnuncio = keyof typeof MODELOS_ANUNCIO;

export function ehModeloAnuncio(valor: unknown): valor is ModeloAnuncio {
  return typeof valor === 'string' && Object.hasOwn(MODELOS_ANUNCIO, valor);
}

function secao(texto: string, titulo: string, arquivo: string = MODELOS_ANUNCIO.padrao.arquivo): string {
  const inicio = texto.indexOf(`## ${titulo}`);
  if (inicio < 0) throw new Error(`${arquivo} sem a seção "## ${titulo}"`);
  const depois = texto.indexOf('\n## ', inicio + 1);
  return texto.slice(inicio + `## ${titulo}`.length, depois < 0 ? undefined : depois).trim();
}

/** Primeira variante de assunto (A). O teste A/B fica para quando houver volume. */
function assuntoA(texto: string, arquivo: string): string {
  const bloco = secao(texto, 'Assunto (teste A/B, se houver volume)', arquivo);
  const linha = bloco.split('\n').find((l) => l.trim().startsWith('- A:'));
  const m = /`(.+)`/.exec(linha ?? '');
  if (!m) throw new Error('não achei o assunto A no texto da campanha');
  return m[1] ?? '';
}

export interface VariaveisAnuncio {
  primeiro_nome: string;
  link_acesso: string;
  lista_produtos: string;
  link_parar: string;
  email_suporte: string;
}

/**
 * O arquivo de conteúdo termina com rodapé próprio, depois de um separador
 * `---`. Quem monta o rodapé é o renderizador, igual nos três e-mails, então o
 * bloco do arquivo é descartado na leitura — senão o "parar de receber" sai
 * duas vezes no mesmo e-mail.
 *
 * **Não é edição do arquivo**: o pipeline de conteúdo é de outra sessão
 * (CLAUDE.md §3). O que o rodapé de lá diz vai para o `motivo` em `montarAnuncio`.
 *
 * O marcador é o `{{link_parar}}`, que só existe no rodapé — mais estável do que
 * procurar `<small>` ou CNPJ, que foi o formato até 22/10/2026.
 */
function semRodapeAntigo(corpo: string): string {
  const corte = corpo.search(/\n-{3,}\s*\n/);
  if (corte < 0) return corpo;
  const cauda = corpo.slice(corte);
  return /\{\{link_parar\}\}|<small>|CNPJ/i.test(cauda) ? corpo.slice(0, corte).trim() : corpo;
}

/**
 * Boa parte da base antiga não tem o nome gravado. Sem nome, a saudação
 * `Olá, {{primeiro_nome}}!` viraria "Olá, !" e o assunto começaria por vírgula.
 * O arquivo de conteúdo manda usar "Olá!" sem nome: é o que a limpeza faz, nos
 * dois lugares.
 */
function limparSaudacao(texto: string): string {
  return texto
    .replace(/,[ \t]*!/g, '!')
    .replace(/^(assunto:)\s*,\s*(.)/im, (_i, rotulo: string, primeira: string) =>
      `${rotulo} ${primeira.toUpperCase()}`,
    );
}

/**
 * O link do corpo do modelo curto fica **dentro da frase**, de propósito: botão
 * é o que faz e-mail parecer informativo. O renderizador só faz botão de link
 * sozinho na linha, então o curto sai com link no texto sem tratamento nenhum.
 */
export function montarAnuncio(v: VariaveisAnuncio, qual: ModeloAnuncio = 'padrao') {
  const { texto, arquivo } = MODELOS_ANUNCIO[qual];
  // O corpo vira um modelo no formato que o renderizarEmail entende. O nome
  // entra antes da limpeza, que é justamente para o caso de ele estar vazio.
  const corpo = semRodapeAntigo(secao(texto, 'Corpo', arquivo));
  const bruto = `Assunto: ${assuntoA(texto, arquivo)}\n\n${corpo}`.replaceAll(
    '{{primeiro_nome}}',
    v.primeiro_nome.trim(),
  );

  return renderizarEmail(
    limparSaudacao(bruto),
    v as unknown as Record<string, string>,
    {
      motivo:
        `Você recebeu este e-mail porque comprou a ${APP_NAME}. ` +
        `Se não quiser mais receber avisos sobre o app, [clique aqui](${v.link_parar}). ` +
        'Os e-mails com o seu código de acesso continuam chegando.',
    },
  );
}

/** Versão curta para WhatsApp, para quem não tem e-mail válido. Só o modelo completo tem. */
export function textoWhatsapp(v: VariaveisAnuncio): string {
  const bloco = secao(modeloPadrao, 'Versão para WhatsApp (opcional, para quem tem telefone)');
  const corpo = bloco
    .split('\n')
    .filter((l) => l.trim().startsWith('>'))
    .map((l) => l.replace(/^\s*>\s?/, ''))
    .join('\n')
    .trim();
  return renderizarEmail(`Assunto: -\n\n${corpo}`, v as unknown as Record<string, string>).texto;
}
