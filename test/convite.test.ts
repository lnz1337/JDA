import { describe, expect, it } from 'vitest';
import { conviteDaHome, type RetratoDoAparelho } from '../src/client/lib/convite';

/**
 * O card da Home (CLAUDE.md §11). No Android o lembrete não depende de instalar:
 * o push funciona no Chrome, e há Chrome que nem oferece "Instalar app" (achado
 * no BlueStacks). Sem isso, quem não instalava nunca via o convite do lembrete.
 */
const androidNoChrome: RetratoDoAparelho = {
  celular: true,
  ios: false,
  standalone: false,
  suportaPush: true,
  permissao: 'default',
  instalarDispensado: false,
  lembreteDispensado: false,
};

const iphoneNoSafari: RetratoDoAparelho = { ...androidNoChrome, ios: true, suportaPush: false };

describe('conviteDaHome', () => {
  it('Android no Chrome: o lembrete vem antes de instalar', () => {
    expect(conviteDaHome(androidNoChrome)).toBe('lembrete');
  });

  it('Android no Chrome: lembrete dispensado, sobra o de instalar', () => {
    expect(conviteDaHome({ ...androidNoChrome, lembreteDispensado: true })).toBe('instalar');
  });

  it('Android no Chrome: permissão já respondida, sobra o de instalar', () => {
    expect(conviteDaHome({ ...androidNoChrome, permissao: 'granted' })).toBe('instalar');
    expect(conviteDaHome({ ...androidNoChrome, permissao: 'denied' })).toBe('instalar');
  });

  it('Android com os dois dispensados não mostra nada', () => {
    expect(
      conviteDaHome({ ...androidNoChrome, lembreteDispensado: true, instalarDispensado: true }),
    ).toBeNull();
  });

  it('Android sem PushManager no navegador: só o de instalar', () => {
    expect(conviteDaHome({ ...androidNoChrome, suportaPush: false })).toBe('instalar');
  });

  it('Android instalado: o lembrete, como antes', () => {
    expect(conviteDaHome({ ...androidNoChrome, standalone: true })).toBe('lembrete');
  });

  it('iPhone no Safari: só o de instalar, como antes', () => {
    // Fora da tela inicial não há PushManager: pedir aqui seria pedir o que o
    // aparelho não tem como dar.
    expect(conviteDaHome(iphoneNoSafari)).toBe('instalar');
    // Mesmo que o navegador dissesse que tem push, no iPhone não vale fora do standalone.
    expect(conviteDaHome({ ...iphoneNoSafari, suportaPush: true })).toBe('instalar');
  });

  it('iPhone instalado: o lembrete, como antes', () => {
    expect(conviteDaHome({ ...iphoneNoSafari, standalone: true, suportaPush: true })).toBe(
      'lembrete',
    );
  });

  it('desktop não recebe convite', () => {
    expect(conviteDaHome({ ...androidNoChrome, celular: false })).toBeNull();
  });
});
