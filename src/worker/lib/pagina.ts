/**
 * Páginas servidas pelo Worker, fora do PWA: a confirmação do link de acesso e o
 * "parar de receber". São páginas que chegam por link de e-mail, então não podem
 * depender de JavaScript nem do bundle do app — precisam funcionar no navegador
 * que o cliente de e-mail abrir.
 *
 * Mesma régua dos e-mails (§8): uma coluna, letra grande, nada miúdo. As cores
 * são as do app (docs/estilo-visual.md), sem fonte baixada: a página tem que
 * abrir rápido no navegador do cliente de e-mail. O tema segue o do aparelho,
 * porque aqui não há a escolha que o app guarda.
 */
import { APP_NAME } from '../../shared/constants';

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `conteudo` já é HTML; o título vai escapado. */
export function pagina(titulo: string, conteudo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escaparHtml(titulo)} — ${APP_NAME}</title>
<style>
  body{margin:0;background:#f7f2e8;color:#2a1a0b;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    display:grid;place-items:center;min-height:100vh}
  main{width:100%;max-width:34rem;padding:2rem 1.5rem;text-align:center;box-sizing:border-box}
  h1{margin:0 0 1rem;font-family:Georgia,'Times New Roman',serif;font-size:2rem;line-height:1.25;color:#1a1004}
  p{margin:0 0 1.25rem;font-size:1.25rem;line-height:1.65;color:#5f5040}
  button{display:block;width:100%;box-sizing:border-box;margin:1.5rem 0 0;min-height:60px;
    padding:1.125rem 2rem;border:0;border-radius:12px;color:#1a1004;
    background:linear-gradient(180deg,#d8ac52 0%,#bd8f34 100%);box-shadow:0 5px 0 #7d5c1c;
    font:inherit;font-size:1.25rem;font-weight:800;cursor:pointer}
  button:active{transform:translateY(3px);box-shadow:0 2px 0 #7d5c1c}
  a{color:#6b4e14;font-weight:600}
  @media (prefers-color-scheme:dark){
    body{background:#0c0704;color:#e6dbc6}
    h1{color:#f6e4b6}
    p{color:#c9b48e}
    a{color:#f0cd7a}
  }
</style>
</head>
<body><main>
<h1>${escaparHtml(titulo)}</h1>
${conteudo}
</main></body>
</html>`;
}
