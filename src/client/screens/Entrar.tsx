import { type FormEvent, useEffect, useState } from 'react';
import {
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
    <main className="mx-auto flex max-w-md flex-col gap-7 px-5 py-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold text-titulo">
          {etapa === 'email' ? 'Entrar no app' : 'Digite o código'}
        </h1>
        <p className="text-lg leading-relaxed text-texto2">
          {etapa === 'email'
            ? 'Digite o e-mail da sua compra. Vamos enviar um código de acesso.'
            : `Enviamos um código de ${CODIGO_DIGITOS} números para ${email}. Ele vale por ${CODIGO_VALIDADE_MIN} minutos.`}
        </p>
      </header>

      {aviso && etapa === 'email' && (
        <p className="caixa-destaque text-lg leading-relaxed text-texto">{aviso}</p>
      )}

      {etapa === 'email' ? (
        <form onSubmit={pedirCodigo} className="space-y-5">
          <label className="block space-y-2">
            <span className="text-lg font-medium text-texto">Seu e-mail</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="campo"
              placeholder="voce@exemplo.com.br"
            />
          </label>
          <button type="submit" disabled={enviando} className="botao botao-dourado">
            {enviando ? 'Enviando…' : 'Receber código'}
          </button>
        </form>
      ) : (
        <form onSubmit={entrar} className="space-y-5">
          <label className="block space-y-2">
            <span className="text-lg font-medium text-texto">Código</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={CODIGO_DIGITOS}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              className="campo text-center text-4xl tracking-[0.3em]"
              placeholder="000000"
            />
          </label>
          <button
            type="submit"
            disabled={enviando || codigo.length < CODIGO_DIGITOS}
            className="botao botao-dourado"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          {/* Visível desde o começo, não só depois de dar errado. */}
          <section className="space-y-3 rounded-2xl border border-linha bg-cartao px-5 py-4">
            <p className="text-lg font-medium leading-relaxed text-texto">
              Não chegou? Confira a pasta Spam ou Lixo eletrônico.
            </p>
            {limiteBatido ? (
              <p className="text-base leading-relaxed text-texto2">
                Já enviamos {envios} códigos para esse e-mail. Se nenhum chegou, escreva para{' '}
                <a
                  className="font-semibold text-ouro-forte underline"
                  href={`mailto:${EMAIL_SUPORTE}`}
                >
                  {EMAIL_SUPORTE}
                </a>{' '}
                que a gente te coloca dentro.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void pedirCodigo()}
                disabled={!podeReenviar}
                className="botao botao-secundario"
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
            className="link w-full justify-center text-lg"
          >
            Usar outro e-mail
          </button>
        </form>
      )}

      {erro && <p className="text-lg font-medium text-red-700">{erro}</p>}
    </main>
  );
}
