import { useEffect, useState } from 'react';
import type { ItemDaLoja } from '../../shared/types';
import { api } from '../lib/api';
import { emReais } from '../lib/dinheiro';
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
    api<{ itens: ItemDaLoja[] }>('/api/loja')
      .then((r) => setItens(r.itens))
      .catch(() => setErro(true));
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold leading-tight text-noite-900">Loja</h1>
        <p className="text-lg leading-relaxed text-noite-700">
          Conteúdos para rezar além da sua jornada.
        </p>
      </header>

      {erro && (
        <p className="text-lg text-noite-900">
          Não consegui carregar a loja agora. Confira a internet e tente de novo.
        </p>
      )}
      {!itens && !erro && <p className="text-lg text-noite-700">carregando…</p>}

      {itens?.length === 0 && (
        <p className="text-lg leading-relaxed text-noite-700">
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
    </main>
  );
}

function CartaoDaLoja({ item }: { item: ItemDaLoja }) {
  return (
    <article className="space-y-3 rounded-2xl border-2 border-noite-100 bg-white px-5 py-5">
      <h2 className="text-xl font-semibold leading-snug text-noite-900">
        {/* Cadeado só em quem não tem: ele é a informação, não enfeite. */}
        {!item.tem_acesso && <span aria-hidden="true">🔒 </span>}
        {item.nome}
      </h2>

      {item.inclui.length > 0 && (
        <div className="space-y-1">
          <p className="text-base font-semibold text-noite-700">Vem com:</p>
          <ul className="space-y-1">
            {item.inclui.map((nome) => (
              <li key={nome} className="text-base leading-relaxed text-noite-700">
                • {nome}
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.tem_acesso ? (
        <>
          <p className="text-lg font-semibold text-noite-900">Liberado ✓</p>
          <button
            type="button"
            onClick={() => irPara(item.abrir ?? `/produto/${item.id}`)}
            className="min-h-[56px] w-full rounded-xl bg-noite-900 px-4 py-3 text-lg font-semibold text-white"
          >
            Abrir
          </button>
        </>
      ) : (
        <>
          {item.preco_cents !== null && (
            <p className="text-xl font-semibold text-noite-900">{emReais(item.preco_cents)}</p>
          )}
          <button
            type="button"
            onClick={() => irPara(`/produto/${item.id}`)}
            className="min-h-[56px] w-full rounded-xl border-2 border-noite-900 px-4 py-3 text-lg font-semibold text-noite-900"
          >
            Ver
          </button>
        </>
      )}
    </article>
  );
}
