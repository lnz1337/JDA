import { describe, expect, it } from 'vitest';
import { acharColuna, normalizarNome } from '../../scripts/lib/colunas.ts';
import { dataDaVendaParaIso } from '../../scripts/lib/data-venda.ts';
import { celulaParaTexto, dataDeCelula } from '../../scripts/lib/xlsx.ts';

/**
 * O relatório de vendas da Payt lido direto do `.xlsx` (lançamento, etapa 5).
 * As colunas abaixo são as do relatório real de 27/10.
 */
const COLUNAS_DA_PAYT = [
  'Código', 'Tags', 'Cliente', 'Tipo Venda', 'Sku', 'Produto', 'Código do Checkout',
  'Status Compra', 'Status Pagamento', 'Data da venda', 'Data Aprovação do Pagamento',
  'Email', 'Telefone', 'Código do Cupom', 'Código de Rastreio',
];

describe('coluna pelo nome', () => {
  it('ignora acento, caixa e espaço', () => {
    expect(normalizarNome('Data Aprovação do Pagamento')).toBe('dataaprovacaodopagamento');
    expect(normalizarNome('Código')).toBe('codigo');
  });

  it('"Código" é a transação, não o código do checkout', () => {
    // Sem tirar o acento, nenhuma coluna casava com "codigo" e a transação
    // ficava de fora. Com o "contém" antes do exato, ganharia "Código do Checkout".
    expect(acharColuna(COLUNAS_DA_PAYT, ['transaction_id', 'transacao', 'codigo'])).toBe('Código');
  });

  it('acha a data da venda', () => {
    expect(acharColuna(COLUNAS_DA_PAYT, ['data_pagamento', 'data_da_venda'])).toBe('Data da venda');
  });

  it('devolve null quando não há', () => {
    expect(acharColuna(COLUNAS_DA_PAYT, ['product_code'])).toBeNull();
  });
});

describe('célula do Excel', () => {
  it('data vira o relógio de Brasília, sem fuso', () => {
    // O Excel não tem fuso: a biblioteca entrega o número como Date em UTC, e os
    // campos UTC são a hora que estava no relógio de quem exportou.
    const d = new Date(Date.UTC(2026, 9, 27, 9, 20, 18));
    expect(dataDeCelula(d)).toBe('2026-10-27 09:20:18');
    expect(dataDaVendaParaIso(celulaParaTexto(d))).toBe('2026-10-27T12:20:18.000Z');
  });

  it('número fica como está no arquivo', () => {
    // Telefone e código numérico não passam por Number: perderiam dígito ou zero.
    expect(celulaParaTexto('5511987654321')).toBe('5511987654321');
    expect(celulaParaTexto('  007  ')).toBe('007');
  });

  it('vazio é texto vazio', () => {
    expect(celulaParaTexto(null)).toBe('');
    expect(celulaParaTexto(undefined)).toBe('');
    expect(celulaParaTexto(new Date(Number.NaN))).toBe('');
  });
});

describe('data em número de série do Excel', () => {
  it('vira data de verdade, em horário de Brasília', () => {
    // 46322 é 27/10/2026 e o ,5 é meio-dia — no relógio de Brasília.
    expect(dataDaVendaParaIso('46322')).toBe('2026-10-27T03:00:00.000Z');
    expect(dataDaVendaParaIso('46322.5')).toBe('2026-10-27T15:00:00.000Z');
  });

  it('número que não é data não vira data', () => {
    expect(dataDaVendaParaIso('123')).toBeNull();
  });
});
