import { type FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { gravarLocal } from '../lib/dispositivo';

/** O aparelho lembra o "Pular": a pergunta não volta a cada abertura. */
export const CHAVE_NOME_PULADO = 'nome:pulado';

/**
 * Para quem entrou e a conta não tem nome (docs/entrada-sem-codigo.md). É o nome
 * da saudação e, no Mural, a fonte do primeiro nome. Quem já tem nome não vê
 * esta tela, e "Pular" segue sem nome.
 */
export function PerguntarNome({ aoTerminar }: { aoTerminar: () => void }) {
  const [nome, setNome] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(false);

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    setEnviando(true);
    setErro(false);
    try {
      await api('/api/me', { method: 'PATCH', body: JSON.stringify({ nome: nome.trim() }) });
      aoTerminar();
    } catch {
      setErro(true);
    } finally {
      setEnviando(false);
    }
  }

  function pular() {
    gravarLocal(CHAVE_NOME_PULADO, String(Date.now()));
    aoTerminar();
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-7 px-5 py-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold text-titulo">Como podemos te chamar?</h1>
        <p className="text-lg leading-relaxed text-texto2">
          É o nome que aparece quando o app te dá bom dia.
        </p>
      </header>

      <form onSubmit={salvar} className="space-y-5">
        <label className="block space-y-2">
          <span className="text-lg font-medium text-texto">Seu nome</span>
          <input
            type="text"
            autoComplete="given-name"
            autoCapitalize="words"
            required
            autoFocus
            maxLength={60}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="campo"
            placeholder="Maria"
          />
        </label>

        <button type="submit" disabled={enviando || !nome.trim()} className="botao botao-dourado">
          {enviando ? 'Salvando…' : 'Continuar'}
        </button>

        <button type="button" onClick={pular} className="link w-full justify-center text-lg">
          Pular
        </button>
      </form>

      {erro && (
        <p role="alert" className="caixa-destaque text-lg text-texto">
          Não consegui salvar agora. Confira a internet e tente de novo.
        </p>
      )}
    </main>
  );
}
