import { type FormEvent, useEffect, useState } from 'react';
import {
  APP_NAME,
  CODIGO_DIGITOS,
  CODIGO_MAX_POR_HORA,
  CODIGO_VALIDADE_MIN,
  EMAIL_SUPORTE,
} from '../../shared/constants';
import { api, ErroApi } from '../lib/api';

const MENSAGENS: Record<string, string> = {
  codigo_invalido: 'Código errado ou expirado. Confira e tente de novo.',
  tentativas_esgotadas: 'Muitas tentativas. Peça um código novo.',
  dados_invalidos: 'Confira o e-mail e o código.',
  email_invalido: 'Esse e-mail não parece válido.',
};

/**
 * O que dizer para quem chegou pelo link do e-mail e o link não serviu mais.
 * Não é erro da pessoa, então o tom é o de quem já está resolvendo.
 */
const MOTIVOS: Record<string, string> = {
  link_usado: 'Este link já foi usado. Vamos te enviar um código.',
  link_expirado: 'Este link venceu. Vamos te enviar um código.',
  link_invalido: 'Não conseguimos abrir este link. Vamos te enviar um código.',
};

/** Espera entre dois pedidos de código, para o botão não virar martelo. */
const ESPERA_S = 60;

/**
 * Login em dois passos: pede o código, depois confere. Um passo por tela, letra
 * grande e o aviso de spam visível desde o começo — o público é 55+, e o e-mail
 * cai na pasta de lixo eletrônico do Outlook enquanto o domínio é novo.
 */
export function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
  const parametros = new URLSearchParams(location.search);
  // O e-mail dos nossos links vem preenchido: /entrar?e=...
  const [email, setEmail] = useState(() => parametros.get('e') ?? '');
  const [codigo, setCodigo] = useState('');
  const [etapa, setEtapa] = useState<'email' | 'codigo'>('email');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [envios, setEnvios] = useState(0);
  const [espera, setEspera] = useState(0);
  const [aviso] = useState(() => MOTIVOS[parametros.get('motivo') ?? ''] ?? null);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const comErro = (e: unknown) =>
    setErro(
      e instanceof ErroApi
        ? (MENSAGENS[e.codigo] ?? 'Algo deu errado. Tente de novo.')
        : 'Sem conexão. Confira a internet e tente de novo.',
    );

  async function pedirCodigo(ev?: FormEvent) {
    ev?.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email }) });
      setEnvios((n) => n + 1);
      setEspera(ESPERA_S);
      setEtapa('codigo');
    } catch (e) {
      comErro(e);
    } finally {
      setEnviando(false);
    }
  }

  async function entrar(ev: FormEvent) {
    ev.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api('/api/auth/entrar', { method: 'POST', body: JSON.stringify({ email, codigo }) });
      aoEntrar();
    } catch (e) {
      comErro(e);
    } finally {
      setEnviando(false);
    }
  }

  // O servidor limita a 5 pedidos por hora e responde sempre igual, sem dizer
  // que travou. Então a tela conta os envios e, no limite, oferece o suporte.
  const podeReenviar = espera === 0 && envios < CODIGO_MAX_POR_HORA && !enviando;
  const limiteBatido = envios >= CODIGO_MAX_POR_HORA;

  const rotuloReenvio = () => {
    if (espera > 0) return `Reenviar em ${espera}s`;
    if (enviando) return 'Enviando…';
    return 'Reenviar o código';
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-7 px-6 py-12">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold text-noite-900">{APP_NAME}</h1>
        <p className="text-lg leading-relaxed text-noite-700">
          {etapa === 'email'
            ? 'Digite o e-mail da sua compra. Vamos enviar um código de acesso.'
            : `Enviamos um código de ${CODIGO_DIGITOS} números para ${email}. Ele vale por ${CODIGO_VALIDADE_MIN} minutos.`}
        </p>
      </header>

      {aviso && etapa === 'email' && (
        <p className="rounded-2xl border border-ouro-300 bg-ouro-300/15 px-5 py-4 text-lg leading-relaxed text-noite-900">
          {aviso}
        </p>
      )}

      {etapa === 'email' ? (
        <form onSubmit={pedirCodigo} className="space-y-5">
          <label className="block space-y-2">
            <span className="text-lg font-medium text-noite-900">Seu e-mail</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border-2 border-noite-100 bg-white px-4 py-4 text-xl text-noite-950 outline-none focus:border-noite-700"
              placeholder="voce@exemplo.com.br"
            />
          </label>
          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-xl bg-noite-900 px-4 py-5 text-xl font-semibold text-white disabled:opacity-60"
          >
            {enviando ? 'Enviando…' : 'Receber código'}
          </button>
        </form>
      ) : (
        <form onSubmit={entrar} className="space-y-5">
          <label className="block space-y-2">
            <span className="text-lg font-medium text-noite-900">Código</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={CODIGO_DIGITOS}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-xl border-2 border-noite-100 bg-white px-4 py-4 text-center text-4xl tracking-[0.3em] text-noite-950 outline-none focus:border-noite-700"
              placeholder="000000"
            />
          </label>
          <button
            type="submit"
            disabled={enviando || codigo.length < CODIGO_DIGITOS}
            className="w-full rounded-xl bg-noite-900 px-4 py-5 text-xl font-semibold text-white disabled:opacity-60"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          {/* Visível desde o começo, não só depois de dar errado. */}
          <section className="space-y-3 rounded-2xl border border-noite-100 bg-white px-5 py-4">
            <p className="text-lg font-medium leading-relaxed text-noite-900">
              Não chegou? Confira a pasta Spam ou Lixo eletrônico.
            </p>
            {limiteBatido ? (
              <p className="text-base leading-relaxed text-noite-700">
                Já enviamos {envios} códigos para esse e-mail. Se nenhum chegou, escreva para{' '}
                <a className="font-medium text-noite-900 underline" href={`mailto:${EMAIL_SUPORTE}`}>
                  {EMAIL_SUPORTE}
                </a>{' '}
                que a gente te coloca dentro.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void pedirCodigo()}
                disabled={!podeReenviar}
                className="w-full rounded-xl border-2 border-noite-900 px-4 py-4 text-lg font-semibold text-noite-900 disabled:opacity-50"
              >
                {rotuloReenvio()}
              </button>
            )}
          </section>

          <button
            type="button"
            onClick={() => {
              setEtapa('email');
              setCodigo('');
              setErro(null);
            }}
            className="w-full py-2 text-lg text-noite-700 underline"
          >
            Usar outro e-mail
          </button>
        </form>
      )}

      {erro && <p className="text-lg font-medium text-red-700">{erro}</p>}
    </main>
  );
}
