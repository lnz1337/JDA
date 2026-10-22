/** Textos de e-mail são .md importados como string pelo bundler (Vite `?raw`). */
declare module '*.md?raw' {
  const conteudo: string;
  export default conteudo;
}
