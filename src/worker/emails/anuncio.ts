/**
 * Lê o texto da campanha de anúncio.
 *
 * O arquivo é do pipeline de conteúdo (`conteudo/emails/anuncio-app.md`): este
 * módulo só **lê**. A estrutura esperada é a que está lá — `## Assunto` com as
 * opções A/B, o pré-cabeçalho e `## Corpo`.
 */
import { APP_NAME } from '../../shared/constants';
import modelo from '../../../conteudo/emails/anuncio-app.md?raw';
import { renderizarEmail } from './render';

function secao(texto: string, titulo: string): string {
  const inicio = texto.indexOf(`## ${titulo}`);
  if (inicio < 0) throw new Error(`conteudo/emails/anuncio-app.md sem a seção "## ${titulo}"`);
  const depois = texto.indexOf('\n## ', inicio + 1);
  return texto.slice(inicio + `## ${titulo}`.length, depois < 0 ? undefined : depois).trim();
}

/** Primeira variante de assunto (A). O teste A/B fica para quando houver volume. */
function assuntoA(): string {
  const bloco = secao(modelo, 'Assunto (teste A/B, se houver volume)');
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
 * O arquivo de conteúdo termina com um rodapé próprio — separador `---` e um
 * bloco `<small>` com razão social e CNPJ. Quem decide o rodapé agora é o
 * renderizador (nome do app + motivo, sem dado de empresa), então o bloco do
 * arquivo é descartado na leitura. **Não é edição do arquivo**: o pipeline de
 * conteúdo é de outra sessão (CLAUDE.md §3), e cortar na leitura continua
 * funcionando quando ele tirar o rodapé de lá.
 */
function semRodapeAntigo(corpo: string): string {
  const corte = corpo.search(/\n-{3,}\s*\n/);
  if (corte < 0) return corpo;
  const cauda = corpo.slice(corte);
  return /<small>|CNPJ/i.test(cauda) ? corpo.slice(0, corte).trim() : corpo;
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

export function montarAnuncio(v: VariaveisAnuncio) {
  // O corpo vira um modelo no formato que o renderizarEmail entende. O nome
  // entra antes da limpeza, que é justamente para o caso de ele estar vazio.
  const corpo = semRodapeAntigo(secao(modelo, 'Corpo'));
  const bruto = `Assunto: ${assuntoA()}\n\n${corpo}`.replaceAll(
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

/** Versão curta para WhatsApp, para quem não tem e-mail válido. */
export function textoWhatsapp(v: VariaveisAnuncio): string {
  const bloco = secao(modelo, 'Versão para WhatsApp (opcional, para quem tem telefone)');
  const corpo = bloco
    .split('\n')
    .filter((l) => l.trim().startsWith('>'))
    .map((l) => l.replace(/^\s*>\s?/, ''))
    .join('\n')
    .trim();
  return renderizarEmail(`Assunto: -\n\n${corpo}`, v as unknown as Record<string, string>).texto;
}
