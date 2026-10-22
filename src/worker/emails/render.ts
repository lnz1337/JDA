/**
 * Renderiza um texto de e-mail.
 *
 * O arquivo .md tem a primeira linha `Assunto: ...`, uma linha em branco e o
 * corpo em markdown. O markdown é escrito para ser legível como texto puro, que
 * é a versão text/plain; o HTML sai de um subconjunto pequeno — parágrafo,
 * negrito, link, lista e citação — que é tudo que estes e-mails usam.
 */
export interface EmailRenderizado {
  assunto: string;
  texto: string;
  html: string;
}

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function substituir(texto: string, variaveis: Record<string, string>): string {
  return texto.replace(/\{\{(\w+)\}\}/g, (inteiro, chave: string) =>
    chave in variaveis ? variaveis[chave] ?? '' : inteiro,
  );
}

/** Negrito e links dentro de uma linha. */
function inline(linha: string, paraHtml: boolean): string {
  if (!paraHtml) {
    return linha
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\[(.+?)\]\((.+?)\)/g, '$1: $2');
  }
  return escapar(linha)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
}

function paraHtml(corpo: string): string {
  const saida: string[] = [];
  let emLista = false;

  const fecharLista = () => {
    if (emLista) {
      saida.push('</ul>');
      emLista = false;
    }
  };

  for (const linha of corpo.split('\n')) {
    const t = linha.trim();

    if (t === '') {
      fecharLista();
      continue;
    }
    if (t.startsWith('<')) {
      // HTML cru (ex.: <small> do rodapé) passa direto.
      fecharLista();
      saida.push(t);
      continue;
    }
    if (t.startsWith('- ')) {
      if (!emLista) {
        saida.push('<ul>');
        emLista = true;
      }
      saida.push(`<li>${inline(t.slice(2), true)}</li>`);
      continue;
    }
    fecharLista();
    if (t.startsWith('> ')) {
      saida.push(`<blockquote>${inline(t.slice(2), true)}</blockquote>`);
      continue;
    }
    const titulo = /^(#{1,3})\s+(.*)$/.exec(t);
    if (titulo) {
      const nivel = titulo[1]?.length ?? 1;
      saida.push(`<h${nivel}>${inline(titulo[2] ?? '', true)}</h${nivel}>`);
      continue;
    }
    saida.push(`<p>${inline(t, true)}</p>`);
  }
  fecharLista();

  return saida.join('\n');
}

export function renderizarEmail(
  modelo: string,
  variaveis: Record<string, string> = {},
): EmailRenderizado {
  const completo = substituir(modelo, variaveis);
  const linhas = completo.split('\n');
  const indiceAssunto = linhas.findIndex((l) => l.trim().toLowerCase().startsWith('assunto:'));

  if (indiceAssunto < 0) {
    throw new Error('modelo de e-mail sem a linha "Assunto:"');
  }

  const assunto = (linhas[indiceAssunto] ?? '').replace(/^\s*assunto:\s*/i, '').trim();
  const corpo = linhas.slice(indiceAssunto + 1).join('\n').trim();

  const texto = corpo
    .split('\n')
    .map((l) => inline(l.replace(/^#{1,3}\s+/, ''), false))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return { assunto, texto, html: paraHtml(corpo) };
}
