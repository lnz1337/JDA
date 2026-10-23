/**
 * Páginas servidas pelo Worker, fora do PWA: a confirmação do link de acesso e o
 * "parar de receber". São páginas que chegam por link de e-mail, então não podem
 * depender de JavaScript nem do bundle do app — precisam funcionar no navegador
 * que o cliente de e-mail abrir.
 *
 * Mesma régua dos e-mails (§8): uma coluna, letra grande, nada miúdo.
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
  body{margin:0;background:#faf7f2;color:#141233;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    display:grid;place-items:center;min-height:100vh}
  main{width:100%;max-width:34rem;padding:2rem 1.5rem;text-align:center;box-sizing:border-box}
  h1{margin:0 0 1rem;font-size:1.75rem;line-height:1.3}
  p{margin:0 0 1.25rem;font-size:1.1875rem;line-height:1.65;color:#2f2c73}
  button{display:block;width:100%;box-sizing:border-box;margin:1.5rem 0 0;
    padding:1.125rem 2rem;border:0;border-radius:12px;background:#1e1b4b;color:#fff;
    font:inherit;font-size:1.1875rem;font-weight:600;cursor:pointer}
  a{color:#2f2c73}
</style>
</head>
<body><main>
<h1>${escaparHtml(titulo)}</h1>
${conteudo}
</main></body>
</html>`;
}
