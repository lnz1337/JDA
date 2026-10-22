/**
 * Lê o texto da campanha de anúncio.
 *
 * O arquivo é do pipeline de conteúdo (`conteudo/emails/anuncio-app.md`): este
 * módulo só **lê**. A estrutura esperada é a que está lá — `## Assunto` com as
 * opções A/B, o pré-cabeçalho e `## Corpo`.
 */
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

export function montarAnuncio(v: VariaveisAnuncio) {
  // O corpo vira um modelo no formato que o renderizarEmail entende.
  const corpo = secao(modelo, 'Corpo');
  return renderizarEmail(`Assunto: ${assuntoA()}\n\n${corpo}`, v as unknown as Record<string, string>);
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
