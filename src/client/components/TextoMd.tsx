import type { JSX } from 'react';

/**
 * O pedaço de markdown que o conteúdo usa: parágrafo, negrito e lista.
 *
 * O renderizador dos e-mails não serve aqui (ele monta documento inteiro, com
 * estilo inline para o Outlook). Aqui o que importa é **letra grande** e
 * entrelinha larga: é texto para rezar junto, lido no celular por quem tem 60
 * anos, não um parágrafo de blog.
 */
function comNegrito(texto: string): Array<JSX.Element | string> {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**') ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: pedaços de uma linha fixa
      <strong key={i} className="font-semibold text-noite-900">
        {parte.slice(2, -2)}
      </strong>
    ) : (
      parte
    ),
  );
}

export function TextoMd({ md }: { md: string }) {
  const blocos = md
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="space-y-5">
      {blocos.map((bloco, i) => {
        const linhas = bloco
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);

        // Citação: oração para rezar, destacada do texto que a explica.
        if (linhas.every((l) => l.startsWith('>'))) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocos de um texto fixo
            <blockquote
              key={i}
              className="border-l-4 border-ouro-300 pl-4 text-lg italic leading-relaxed text-noite-900"
            >
              {comNegrito(linhas.map((l) => l.replace(/^>\s?/, '')).join(' '))}
            </blockquote>
          );
        }

        const marcadores = linhas.filter((l) => l.startsWith('- '));
        const numeradas = linhas.filter((l) => /^\d+[.)]\s/.test(l));

        if (marcadores.length > 0 || numeradas.length > 1) {
          const ordenada = numeradas.length > marcadores.length;
          const itens = (ordenada ? numeradas : marcadores).map((l) =>
            l.replace(/^(-\s+|\d+[.)]\s+)/, ''),
          );
          const Lista = ordenada ? 'ol' : 'ul';

          return (
            <Lista
              // biome-ignore lint/suspicious/noArrayIndexKey: blocos de um texto fixo
              key={i}
              className={`space-y-2 pl-6 text-lg leading-relaxed text-noite-700 ${
                ordenada ? 'list-decimal' : 'list-disc'
              }`}
            >
              {itens.map((item, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: itens de uma lista fixa
                <li key={j}>{comNegrito(item)}</li>
              ))}
            </Lista>
          );
        }

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocos de um texto fixo
          <p key={i} className="text-lg leading-relaxed text-noite-700">
            {comNegrito(bloco)}
          </p>
        );
      })}
    </div>
  );
}
