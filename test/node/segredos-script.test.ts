import { describe, expect, it } from 'vitest';
import { valorNoDevVars } from '../../scripts/lib/segredos.ts';

/**
 * O leitor de segredo dos scripts (`.dev.vars`, fora do git).
 *
 * Tinha dois defeitos. O padrão era montado dentro de template literal
 * (`` `^\s*${nome}...` ``), onde `\s` não é escape nenhum e vira o literal "s":
 * o regex real era `^s*NOME s*=s*(.*)$`, então nem espaço antes do nome nem BOM
 * no começo do arquivo casavam. E o arquivo gravado com BOM no Windows é
 * exatamente o que esse mesmo projeto já produziu num segredo.
 */
describe('valorNoDevVars', () => {
  it('lê a linha simples', () => {
    expect(valorNoDevVars('ADMIN_API_KEY=abc123', 'ADMIN_API_KEY')).toBe('abc123');
  });

  it('lê com BOM no começo do arquivo', () => {
    expect(valorNoDevVars('﻿ADMIN_API_KEY=abc123', 'ADMIN_API_KEY')).toBe('abc123');
  });

  it('aguenta espaço em volta do nome e do igual', () => {
    expect(valorNoDevVars('  ADMIN_API_KEY = abc123  ', 'ADMIN_API_KEY')).toBe('abc123');
  });

  it('tira aspas', () => {
    expect(valorNoDevVars('ADMIN_API_KEY="abc123"', 'ADMIN_API_KEY')).toBe('abc123');
    expect(valorNoDevVars("ADMIN_API_KEY='abc123'", 'ADMIN_API_KEY')).toBe('abc123');
  });

  it('acha a linha certa entre várias, com CRLF', () => {
    const arquivo = '﻿ADMIN_API_KEY=um\r\nCAMPAIGN_SIGNING_KEY=dois\r\n';
    expect(valorNoDevVars(arquivo, 'CAMPAIGN_SIGNING_KEY')).toBe('dois');
    expect(valorNoDevVars(arquivo, 'ADMIN_API_KEY')).toBe('um');
  });

  it('não confunde nome que é prefixo de outro', () => {
    // Sem a âncora no nome, 'ADMIN_API_KEY' casaria em 'ADMIN_API_KEY_ANTIGA'.
    const arquivo = 'ADMIN_API_KEY_ANTIGA=velha\nADMIN_API_KEY=nova\n';
    expect(valorNoDevVars(arquivo, 'ADMIN_API_KEY')).toBe('nova');
  });

  it('ignora linha comentada', () => {
    expect(valorNoDevVars('# ADMIN_API_KEY=velha\nADMIN_API_KEY=nova', 'ADMIN_API_KEY')).toBe(
      'nova',
    );
  });

  it('não encontrado é undefined', () => {
    expect(valorNoDevVars('OUTRA=x', 'ADMIN_API_KEY')).toBeUndefined();
  });
});
