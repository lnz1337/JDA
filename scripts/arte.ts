/**
 * Gera os recortes da arte do app (docs/estilo-visual.md, "Imagem").
 *
 *   node scripts/arte.ts
 *
 * Fonte: `arte/guido-reni-sao-miguel.jpg`, São Miguel Arcanjo de Guido Reni
 * (c. 1635), reprodução de domínio público do Wikimedia Commons (origem anotada
 * no docs/ESTADO.md). Os recortes ficam **acima do demônio aos pés**: a primeira
 * tela da manhã é a oração, não o combate.
 *
 * Saída em `public/img/`, WebP em 480 e 960 de largura, cada um com até 120 KB.
 * Roda de novo sem medo: sobrescreve os mesmos arquivos.
 */
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONTE = resolve(RAIZ, 'arte/guido-reni-sao-miguel.jpg');
const SAIDA = resolve(RAIZ, 'public/img');
const LIMITE_BYTES = 120 * 1024;

/** Em pixels da fonte (1657 × 2441). */
const RECORTES = {
  // 3:1: rosto no terço de cima (a faixa desbota embaixo), lâmina da espada e asas.
  faixa: { left: 150, top: 270, width: 1350, height: 450 },
  // 4:3: do rosto à cintura.
  cartao: { left: 180, top: 100, width: 1300, height: 975 },
} as const;

const LARGURAS = [480, 960] as const;

mkdirSync(SAIDA, { recursive: true });

for (const [nome, recorte] of Object.entries(RECORTES)) {
  for (const largura of LARGURAS) {
    const destino = resolve(SAIDA, `sao-miguel-${nome}-${largura}.webp`);
    // Desce a qualidade até caber no limite: celular antigo em 3G não espera.
    for (let qualidade = 82; qualidade >= 40; qualidade -= 6) {
      await sharp(FONTE)
        .extract(recorte)
        .resize({ width: largura })
        .webp({ quality: qualidade })
        .toFile(destino);
      if (statSync(destino).size <= LIMITE_BYTES) break;
    }
    const kb = Math.round(statSync(destino).size / 1024);
    console.log(
      `${destino.slice(RAIZ.length + 1)}  ${kb} KB${kb * 1024 > LIMITE_BYTES ? '  ACIMA DO LIMITE' : ''}`,
    );
  }
}
