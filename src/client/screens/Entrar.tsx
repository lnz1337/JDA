import { type FormEvent, useState } from 'react';
import { APP_NAME, CODIGO_DIGITOS, CODIGO_VALIDADE_MIN } from '../../shared/constants';
import { api, ErroApi } from '../lib/api';

const MENSAGENS: Record<string, string> = {
  codigo_invalido: 'Código errado ou expirado. Confira e tente de novo.',
  tentativas_esgotadas: 'Muitas tentativas. Peça um código novo.',
  dados_invalidos: 'Confira o e-mail e o código.',
  email_invalido: 'Esse e-mail não parece válido.',
};

/** Login em dois passos: pede o código, depois confere. */
export function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
  // O e-mail de boas-vindas manda /entrar?e=..., então já vem preenchido.
  const [email, setEmail] = useState(() => new URLSearchParams(location.search).get('e') ?? '');
  const [codigo, setCodigo] = useState('');
  const [etapa, setEtapa] = useState<'email' | 'codigo'>('email');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const comErro = (e: unknown) =>
    setErro(e instanceof ErroApi ? (MENSAGENS[e.codigo] ?? 'Algo deu errado. Tente de novo.') : 'Sem conexão.');

  async function pedirCodigo(ev: FormEvent) {
    ev.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api('/api/auth/codigo', { method: 'POST', body: JSON.stringify({ email }) });
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-noite-900">{APP_NAME}</h1>
        <p className="text-sm text-noite-700">
          {etapa === 'email'
            ? 'Digite o e-mail da sua compra. Vamos enviar um código de acesso.'
            : `Enviamos um código de ${CODIGO_DIGITOS} números para ${email}. Ele vale por ${CODIGO_VALIDADE_MIN} minutos.`}
        </p>
      </header>

      {etapa === 'email' ? (
        <form onSubmit={pedirCodigo} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-noite-900">Seu e-mail</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-noite-100 bg-white px-4 py-3 text-noite-950 outline-none focus:border-noite-700"
              placeholder="voce@exemplo.com.br"
            />
          </label>
          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-xl bg-noite-900 px-4 py-3 font-medium text-white disabled:opacity-60"
          >
            {enviando ? 'Enviando…' : 'Receber código'}
          </button>
        </form>
      ) : (
        <form onSubmit={entrar} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-noite-900">Código</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={CODIGO_DIGITOS}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-xl border border-noite-100 bg-white px-4 py-3 text-center text-2xl tracking-[0.4em] text-noite-950 outline-none focus:border-noite-700"
              placeholder="000000"
            />
          </label>
          <button
            type="submit"
            disabled={enviando || codigo.length < CODIGO_DIGITOS}
            className="w-full rounded-xl bg-noite-900 px-4 py-3 font-medium text-white disabled:opacity-60"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEtapa('email');
              setCodigo('');
              setErro(null);
            }}
            className="w-full text-sm text-noite-700 underline"
          >
            Usar outro e-mail
          </button>
        </form>
      )}

      {erro && <p className="text-sm text-red-700">{erro}</p>}
    </main>
  );
}
