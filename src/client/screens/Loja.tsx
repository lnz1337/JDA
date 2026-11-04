import { useEffect, useState } from 'react';
import type { ItemDaLoja } from '../../shared/types';
import { api, registrarEvento } from '../lib/api';
import { emReais } from '../lib/dinheiro';
import { Arte } from '../components/Visual';
import { irPara } from '../lib/rota';

/**
 * A loja (fase 6).
 *
 * Por enquanto são os dois pacotes do funil, para quem recusou o upsell e
 * mudou de ideia. O Círculo entra na fase 7 e os conteúdos novos entram quando
 * existirem — o Worker é que decide o que listar, a tela só desenha.
 *
 * Quem já tem um item vê "Liberado" e **Abrir**, não preço: preço de novo em
 * algo já pago faz a pessoa achar que vai pagar duas vezes.
 */
export function Loja() {
  const [itens, setItens] = useState<ItemDaLoja[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    registrarEvento('store_viewed');
    api<{ itens: ItemDaLoja[] }>('/api/loja')
      .then((r) => setItens(r.itens))
      .catch(() => setErro(true));
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col">
      <Arte />
      <div className="relative -mt-10 flex flex-col gap-5 px-5 pb-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold leading-tight text-titulo">Tesouros</h1>
          <p className="text-lg leading-relaxed text-texto2">
            Conteúdos para rezar além da sua jornada.
          </p>
        </header>

        {erro && (
          <p className="text-lg text-texto">
            Não consegui carregar os Tesouros agora. Confira a internet e tente de novo.
          </p>
        )}
        {!itens && !erro && <p className="text-lg text-texto2">carregando…</p>}

        {itens?.length === 0 && (
          <p className="text-lg leading-relaxed text-texto2">
            Nada por aqui ainda. Em breve teremos novos conteúdos.
          </p>
        )}

        <ul className="space-y-4">
          {itens?.map((item) => (
            <li key={item.id}>
              <CartaoDaLoja item={item} />
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

function CartaoDaLoja({ item }: { item: ItemDaLoja }) {
  return (
    <article className="space-y-3 cartao px-5 py-5">
      <h2 className="text-xl font-semibold leading-snug text-titulo">
        {/* Cadeado só em quem não tem: ele é a informação, não enfeite. */}
        {!item.tem_acesso && <span aria-hidden="true">🔒 </span>}
        {item.nome}
      </h2>

      {item.inclui.length > 0 && (
        <div className="space-y-1">
          <p className="text-base font-semibold text-texto2">Vem com:</p>
          <ul className="space-y-1">
            {item.inclui.map((nome) => (
              <li key={nome} className="text-base leading-relaxed text-texto2">
                • {nome}
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.tem_acesso ? (
        <>
          <p className="text-lg font-bold text-verde">Liberado ✓</p>
          <button
            type="button"
            onClick={() => irPara(item.abrir ?? `/produto/${item.id}`)}
            className="botao botao-secundario"
          >
            Abrir
          </button>
        </>
      ) : (
        <>
          {item.preco_cents !== null && (
            <p className="text-xl font-semibold text-texto">{emReais(item.preco_cents)}</p>
          )}
          <button
            type="button"
            onClick={() => irPara(`/produto/${item.id}`)}
            className="botao botao-secundario"
          >
            Ver
          </button>
        </>
      )}
    </article>
  );
}
