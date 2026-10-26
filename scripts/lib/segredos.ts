/**
 * Lê um segredo do ambiente ou do .dev.vars (que está fora do git).
 * Os scripts de operação precisam da ADMIN_API_KEY, que vive só como secret no
 * Worker — a cópia local existe para não ter que digitar a chave toda hora.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * O valor de `nome` no conteúdo de um `.dev.vars`.
 *
 * Separado da leitura de disco para dar para testar sem tocar no `.dev.vars` de
 * verdade, que tem a chave do Leo.
 *
 * O padrão vai em `String.raw` por um motivo concreto: dentro de template
 * literal comum, `\s` não é escape nenhum e vira o literal "s" — o regex que
 * rodava de fato era `^s*NOME s*=s*(.*)$`, que não casava espaço antes do nome
 * **nem BOM no começo do arquivo**. E arquivo com BOM é exatamente o que o
 * Windows produz, como já aconteceu com um segredo deste projeto.
 */
export function valorNoDevVars(conteudo: string, nome: string): string | undefined {
  // Nome de segredo é sempre MAIUSCULA_COM_SUBLINHADO. Recusar o resto evita
  // ter que escapar o nome dentro do padrão, que é onde o escape se perde.
  if (!/^[A-Za-z0-9_]+$/.test(nome)) return undefined;

  const padrao = new RegExp(String.raw`^\s*${nome}\s*=\s*(.*)$`);

  /*
   * Quebra em CRLF e em LF. Não é detalhe de estilo: o `.` do JavaScript não
   * casa `\r`, que é terminador de linha, então o `(.*)$` do padrão não
   * casa nada num arquivo gravado no Windows — o caso normal aqui. O defeito
   * era antigo e passava batido porque o caminho do ambiente vem antes.
   */
  for (const linha of conteudo.split(/\r?\n/)) {
    const m = padrao.exec(linha);
    // As aspas saem aqui; o `\s` do padrão já cobre o BOM.
    if (m) return (m[1] ?? '').trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

export function segredo(nome: string): string | undefined {
  /*
   * Das pontas do valor do ambiente também: `$env:X = "..."` no PowerShell e
   * `export X=$(cmd)` no bash trazem quebra de linha sem avisar, e segredo com
   * quebra de linha não bate com o que o Worker tem cadastrado.
   */
  const doAmbiente = process.env[nome]?.trim();
  if (doAmbiente) return doAmbiente;

  const arquivo = resolve(RAIZ, '.dev.vars');
  if (!existsSync(arquivo)) return undefined;

  return valorNoDevVars(readFileSync(arquivo, 'utf8'), nome);
}

export function exigirSegredo(nome: string): string {
  const v = segredo(nome);
  if (!v) {
    console.error(`${nome} não encontrado. Defina no ambiente ou no .dev.vars (fora do git).`);
    process.exit(1);
  }
  return v;
}
