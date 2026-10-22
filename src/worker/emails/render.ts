/**
 * Renderiza um e-mail a partir de um modelo em markdown.
 *
 * O arquivo .md tem a primeira linha `Assunto: ...`, uma linha em branco e o
 * corpo. O corpo é escrito para ser legível como texto puro — que é a versão
 * `text/plain` — e o HTML sai da moldura em `layout.ts`.
 *
 * Duas regras valem para todo modelo:
 *
 * 1. **quem escreve o modelo não escreve HTML.** Tag crua no markdown é
 *    removida das duas versões. Antes ela passava direto, e o `<small>` do
 *    rodapé saía literal para quem lia o e-mail em texto puro;
 * 2. **o visual é do renderizador.** O modelo só diz o que cada bloco é.
 *
 * Blocos que o corpo pode usar:
 *
 * | No markdown | Vira |
 * |---|---|
 * | `# Título` (até `###`) | título |
 * | `- item` / `1. item` | lista |
 * | `> trecho` | citação |
 * | `:destaque: 123456` | bloco grande e centralizado (o código de login) |
 * | `[ Rótulo ](url)` sozinho na linha | botão |
 * | `[rótulo](url)` no meio da frase | link |
 * | `**negrito**` | negrito |
 */
import { APP_NAME } from '../../shared/constants';
import { ESTILOS, documento } from './layout';

export interface EmailRenderizado {
  assunto: string;
  texto: string;
  html: string;
}

export interface RodapeEmail {
  /** Por que esta pessoa está recebendo este e-mail. Aceita markdown inline. */
  motivo: string;
}

type Bloco =
  | { tipo: 'titulo'; nivel: number; texto: string }
  | { tipo: 'paragrafo'; texto: string }
  | { tipo: 'lista'; ordenada: boolean; itens: string[] }
  | { tipo: 'citacao'; texto: string }
  | { tipo: 'destaque'; texto: string }
  | { tipo: 'botao'; rotulo: string; url: string }
  | { tipo: 'separador' };

/** Tag HTML escrita no markdown não é conteúdo: sai das duas versões. */
function semTags(linha: string): string {
  return linha.replace(/<\/?[a-z][^>]*>/gi, '');
}

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function substituir(texto: string, variaveis: Record<string, string>): string {
  return texto.replace(/\{\{(\w+)\}\}/g, (inteiro, chave: string) =>
    chave in variaveis ? (variaveis[chave] ?? '') : inteiro,
  );
}

const LINK = /\[(.+?)\]\((.+?)\)/g;
const SO_LINK = /^\[\s*(.+?)\s*\]\((\S+)\)$/;

/** Negrito e links dentro de uma linha. */
function inline(linha: string, paraHtml: boolean): string {
  if (!paraHtml) {
    return linha.replace(/\*\*(.+?)\*\*/g, '$1').replace(LINK, '$1: $2');
  }
  return escapar(linha)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(LINK, `<a href="$2" style="${ESTILOS.link}">$1</a>`);
}

function analisar(corpo: string): Bloco[] {
  const blocos: Bloco[] = [];

  const lista = (): Extract<Bloco, { tipo: 'lista' }> | null => {
    const ultimo = blocos[blocos.length - 1];
    return ultimo?.tipo === 'lista' ? ultimo : null;
  };

  let dentroDeLista = false;

  for (const bruta of corpo.split('\n')) {
    const t = semTags(bruta).trim();

    if (t === '') {
      dentroDeLista = false;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      dentroDeLista = false;
      blocos.push({ tipo: 'separador' });
      continue;
    }

    const item = /^(?:-\s+(.*)|(\d+)\.\s+(.*))$/.exec(t);
    if (item) {
      const texto = item[1] ?? item[3] ?? '';
      const ordenada = item[2] !== undefined;
      const atual = dentroDeLista ? lista() : null;
      if (atual && atual.ordenada === ordenada) {
        atual.itens.push(texto);
      } else {
        blocos.push({ tipo: 'lista', ordenada, itens: [texto] });
        dentroDeLista = true;
      }
      continue;
    }
    dentroDeLista = false;

    const destaque = /^:destaque:\s*(.*)$/.exec(t);
    if (destaque) {
      blocos.push({ tipo: 'destaque', texto: destaque[1] ?? '' });
      continue;
    }

    const soLink = SO_LINK.exec(t);
    if (soLink) {
      blocos.push({ tipo: 'botao', rotulo: soLink[1] ?? '', url: soLink[2] ?? '' });
      continue;
    }

    if (t.startsWith('> ')) {
      blocos.push({ tipo: 'citacao', texto: t.slice(2) });
      continue;
    }

    const titulo = /^(#{1,3})\s+(.*)$/.exec(t);
    if (titulo) {
      blocos.push({ tipo: 'titulo', nivel: titulo[1]?.length ?? 1, texto: titulo[2] ?? '' });
      continue;
    }

    blocos.push({ tipo: 'paragrafo', texto: t });
  }

  return blocos;
}

function blocoEmHtml(b: Bloco): string {
  switch (b.tipo) {
    case 'titulo':
      return `<h${b.nivel} style="${ESTILOS.titulo}">${inline(b.texto, true)}</h${b.nivel}>`;
    case 'paragrafo':
      return `<p style="${ESTILOS.paragrafo}">${inline(b.texto, true)}</p>`;
    case 'lista': {
      const tag = b.ordenada ? 'ol' : 'ul';
      const itens = b.itens
        .map((i) => `<li style="${ESTILOS.item}">${inline(i, true)}</li>`)
        .join('\n');
      return `<${tag} style="${ESTILOS.lista}">\n${itens}\n</${tag}>`;
    }
    case 'citacao':
      return `<blockquote style="${ESTILOS.citacao}">${inline(b.texto, true)}</blockquote>`;
    case 'destaque':
      return `<div style="${ESTILOS.destaque}">${inline(b.texto, true)}</div>`;
    case 'botao':
      // Numa tabela própria: o Word não centraliza `text-align` em bloco solto.
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px"><tr><td align="center"><a href="${escapar(
        b.url,
      )}" style="${ESTILOS.botao}">${inline(b.rotulo, true)}</a></td></tr></table>`;
    case 'separador':
      return `<hr style="margin:0 0 18px;border:0;border-top:1px solid #dcdff5">`;
  }
}

function blocoEmTexto(b: Bloco): string | null {
  switch (b.tipo) {
    case 'titulo':
    case 'paragrafo':
    case 'citacao':
    case 'destaque':
      return inline(b.texto, false);
    case 'lista':
      return b.itens.map((i) => `- ${inline(i, false)}`).join('\n');
    case 'botao':
      return `${inline(b.rotulo, false)}: ${b.url}`;
    case 'separador':
      return null;
  }
}

export function renderizarEmail(
  modelo: string,
  variaveis: Record<string, string> = {},
  rodape?: RodapeEmail,
): EmailRenderizado {
  const completo = substituir(modelo, variaveis);
  const linhas = completo.split('\n');
  const indiceAssunto = linhas.findIndex((l) => l.trim().toLowerCase().startsWith('assunto:'));

  if (indiceAssunto < 0) {
    throw new Error('modelo de e-mail sem a linha "Assunto:"');
  }

  const assunto = semTags(linhas[indiceAssunto] ?? '')
    .replace(/^\s*assunto:\s*/i, '')
    .trim();
  const blocos = analisar(linhas.slice(indiceAssunto + 1).join('\n').trim());

  const corpoTexto = blocos
    .map(blocoEmTexto)
    .filter((l): l is string => l !== null)
    .join('\n\n');

  const motivo = rodape?.motivo.trim();
  const texto = motivo
    ? `${corpoTexto}\n\n—\n${APP_NAME}\n${inline(semTags(motivo), false)}`
    : corpoTexto;

  return {
    assunto,
    texto,
    html: documento(
      blocos.map(blocoEmHtml).join('\n'),
      motivo ? inline(semTags(motivo), true) : undefined,
    ),
  };
}
