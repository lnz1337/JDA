import { type FormEvent, useState } from 'react';
import { EMAIL_SUPORTE, WHATSAPP_SUPORTE } from '../../shared/constants';
import { api, ErroApi } from '../lib/api';

type Metodo = 'celular' | 'email';

/**
 * O que dizer para quem chegou pelo link do e-mail e o link não serviu mais.
 * Não é erro da pessoa, então o tom é o de quem já está resolvendo.
 */
const MOTIVOS: Record<string, string> = {
  link_usado: 'Este link já foi usado. Entre com o seu celular ou e-mail.',
  link_expirado: 'Este link venceu. Entre com o seu celular ou e-mail.',
  link_invalido: 'Não conseguimos abrir este link. Entre com o seu celular ou e-mail.',
};

function mensagemDeErro(codigo: string, metodo: Metodo): string {
  switch (codigo) {
    case 'nao_encontrado':
      return metodo === 'celular'
        ? 'Não encontramos uma compra com esse celular. Confira o número ou tente com o e-mail.'
        : 'Não encontramos uma compra com esse e-mail. Confira ou tente com o celular.';
    case 'varios':
      return 'Este número está em mais de uma compra. Entre com o e-mail.';
    case 'limite':
      return 'Foram muitas tentativas seguidas. Espere um pouco, ou fale com a gente que ajudamos você a entrar.';
    case 'dados_invalidos':
    case 'invalido':
      return metodo === 'celular'
        ? 'Digite o celular com o DDD, por exemplo (11) 98765-4321.'
        : 'Esse e-mail não parece completo. Confira e tente de novo.';
    default:
      return 'Algo deu errado. Tente de novo.';
  }
}

/**
 * A entrada sem código (CLAUDE.md §8, docs/entrada-sem-codigo.md): o celular
 * ou o e-mail da compra, e pronto.
 *
 * Dois botões em vez de um campo que aceita os dois, porque o teclado certo
 * importa para quem tem 60 anos: o de números para o celular, o de e-mail para
 * o e-mail. Celular em cima — é o que a pessoa sabe de cabeça.
 */
export function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
  const parametros = new URLSearchParams(location.search);
  // Link nosso com e-mail (/entrar?e=...): já cai no campo de e-mail preenchido.
  const emailDoLink = parametros.get('e') ?? '';
  const [metodo, setMetodo] = useState<Metodo | null>(emailDoLink ? 'email' : null);
  const [valor, setValor] = useState(emailDoLink);
  const [erro, setErro] = useState<{ codigo: string; metodo: Metodo } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso] = useState(() => MOTIVOS[parametros.get('motivo') ?? ''] ?? null);

  function escolher(m: Metodo) {
    setMetodo(m);
    setValor(m === 'email' ? emailDoLink : '');
    setErro(null);
  }

  async function entrar(ev: FormEvent) {
    ev.preventDefault();
    if (!metodo) return;
    setErro(null);
    setEnviando(true);
    try {
      await api('/api/entrar', {
        method: 'POST',
        body: JSON.stringify(metodo === 'celular' ? { celular: valor } : { email: valor }),
      });
      aoEntrar();
    } catch (e) {
      setErro({ codigo: e instanceof ErroApi ? e.codigo : 'sem_conexao', metodo });
    } finally {
      setEnviando(false);
    }
  }

  const precisaDeAjuda = erro && ['nao_encontrado', 'limite', 'varios'].includes(erro.codigo);
  const outro: Metodo = metodo === 'celular' ? 'email' : 'celular';

  return (
    <main className="mx-auto flex max-w-md flex-col gap-7 px-5 py-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold text-titulo">Entrar no app</h1>
        <p className="text-lg leading-relaxed text-texto2">
          {metodo === null
            ? 'Use o celular ou o e-mail que você usou na compra.'
            : metodo === 'celular'
              ? 'Digite o celular que você usou na compra.'
              : 'Digite o e-mail que você usou na compra.'}
        </p>
      </header>

      {aviso && <p className="caixa-destaque text-lg leading-relaxed text-texto">{aviso}</p>}

      {metodo === null ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => escolher('celular')}
            className="botao botao-secundario min-h-[64px] text-xl"
          >
            <span aria-hidden="true">📱</span> Com o meu celular
          </button>
          <button
            type="button"
            onClick={() => escolher('email')}
            className="botao botao-secundario min-h-[64px] text-xl"
          >
            <span aria-hidden="true">✉️</span> Com o meu e-mail
          </button>
        </div>
      ) : (
        <form onSubmit={entrar} className="space-y-5">
          <label className="block space-y-2">
            <span className="text-lg font-medium text-texto">
              {metodo === 'celular' ? 'O celular da sua compra, com DDD' : 'O e-mail da sua compra'}
            </span>
            {metodo === 'celular' ? (
              <input
                key="celular"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                autoFocus
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="campo"
                placeholder="(11) 98765-4321"
              />
            ) : (
              <input
                key="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                autoFocus={!emailDoLink}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="campo"
                placeholder="voce@exemplo.com.br"
              />
            )}
          </label>

          <button type="submit" disabled={enviando} className="botao botao-dourado">
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          <button
            type="button"
            onClick={() => escolher(outro)}
            className="link w-full justify-center text-lg"
          >
            {outro === 'email' ? 'Prefiro entrar com o e-mail' : 'Prefiro entrar com o celular'}
          </button>
        </form>
      )}

      {erro && (
        <p role="alert" className="caixa-destaque text-lg font-medium leading-relaxed text-texto">
          {erro.codigo === 'sem_conexao'
            ? 'Sem conexão. Confira a internet e tente de novo.'
            : mensagemDeErro(erro.codigo, erro.metodo)}
        </p>
      )}

      {precisaDeAjuda && <Suporte />}
    </main>
  );
}

/** E-mail e, quando houver número cadastrado, WhatsApp do suporte. */
function Suporte() {
  return (
    <section className="cartao space-y-2 px-5 py-4 text-lg leading-relaxed text-texto">
      <p>Precisa de ajuda para entrar? Fale com a gente:</p>
      <p>
        <a
          className="break-all font-semibold text-ouro-forte underline"
          href={`mailto:${EMAIL_SUPORTE}`}
        >
          {EMAIL_SUPORTE}
        </a>
      </p>
      {WHATSAPP_SUPORTE && (
        <p>
          <a
            className="font-semibold text-ouro-forte underline"
            href={`https://wa.me/${WHATSAPP_SUPORTE}`}
          >
            WhatsApp do suporte
          </a>
        </p>
      )}
    </section>
  );
}
