/** Leitura de CSV com aspas e vírgula dentro do campo. */
export function lerCsv(texto: string): { colunas: string[]; linhas: Record<string, string>[] } {
  const limpo = texto.replace(/^﻿/, '');
  const separador = detectarSeparador(limpo);
  const campos = dividir(limpo, separador);

  const colunas = (campos[0] ?? []).map((c) => c.trim());
  const linhas = campos.slice(1)
    .filter((l) => l.some((v) => v.trim() !== ''))
    .map((l) => Object.fromEntries(colunas.map((c, i) => [c, (l[i] ?? '').trim()])));

  return { colunas, linhas };
}

function detectarSeparador(texto: string): string {
  const primeira = texto.split('\n')[0] ?? '';
  const virgulas = (primeira.match(/,/g) ?? []).length;
  const pontos = (primeira.match(/;/g) ?? []).length;
  return pontos > virgulas ? ';' : ',';
}

function dividir(texto: string, separador: string): string[][] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let entreAspas = false;

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else entreAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') entreAspas = true;
    else if (c === separador) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n') {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else if (c !== '\r') campo += c;
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}
