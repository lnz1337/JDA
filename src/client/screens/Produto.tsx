import { useEffect, useState } from 'react';
import type { ProdutoDaLoja } from '../../shared/types';
import { TextoMd } from '../components/TextoMd';
import { api, ErroApi } from '../lib/api';
import { marcarCompra } from '../lib/compra';
import { emReais } from '../lib/dinheiro';
import { irPara } from '../lib/rota';

/**
 * A página de um produto da loja (fase 6).
 *
 * Mostra a prévia — descrição, aviso obrigatório (§14) e **só os títulos** das
 * lições — e um botão de compra. O que vem dentro é o que convence; o conteúdo
 * em si é o que foi comprado, e o Worker não manda corpo de lição para cá.
 *
 * Quem já tem o produto não vê preço nenhum: vê por onde começar.
 */
export function Produto({ id }: { id: string }) {
  const [produto, setProduto] = useState<ProdutoDaLoja | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setProduto(null);
    setErro(null);
    api<{ produto: ProdutoDaLoja }>(`/api/loja/${id}`)
      .then((r) => setProduto(r.produto))
      .catch((e) =>
        setErro(
          e instanceof ErroApi && e.status === 404
            ? 'Não encontrei este conteúdo.'
            : 'Não consegui carregar agora. Confira a internet e tente de novo.',
        ),
      );
  }, [id]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 py-8">
      <button
        type="button"
        onClick={() => irPara('/loja')}
        className="min-h-[48px] self-start text-lg text-noite-700 underline"
      >
        ← Voltar para a loja
      </button>

      {erro && <p className="text-lg text-noite-900">{erro}</p>}
      {!produto && !erro && <p className="text-lg text-noite-700">carregando…</p>}

      {produto && (
        <>
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold leading-tight text-noite-900">{produto.nome}</h1>
            {produto.tem_acesso && (
              <p className="text-lg font-semibold text-noite-900">Liberado na sua conta ✓</p>
            )}
          </header>

          {/* O aviso vem antes do texto de venda: §14 não é rodapé. */}
          {produto.avisos.map((aviso) => (
            <p
              key={aviso}
              className="rounded-2xl border-2 border-ouro-300 bg-ouro-300/15 px-5 py-4 text-base leading-relaxed text-noite-900"
            >
              {aviso}
            </p>
          ))}

          {produto.descricao_md && <TextoMd md={produto.descricao_md} />}

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-noite-900">O que vem dentro</h2>
            {produto.partes.map((parte) => (
              <article
                key={parte.id}
                className="space-y-3 rounded-2xl border-2 border-noite-100 bg-white px-5 py-4"
              >
                <h3 className="text-lg font-semibold leading-snug text-noite-900">{parte.nome}</h3>

                <ol className="space-y-1">
                  {parte.licoes.map((titulo) => (
                    <li key={titulo} className="text-base leading-relaxed text-noite-700">
                      {titulo}
                    </li>
                  ))}
                </ol>

                {produto.tem_acesso && parte.programa_id && (
                  <button
                    type="button"
                    onClick={() => irPara(`/programa/${parte.programa_id}`)}
                    className="min-h-[56px] w-full rounded-xl bg-noite-900 px-4 py-3 text-lg font-semibold text-white"
                  >
                    Abrir
                  </button>
                )}
              </article>
            ))}
          </section>

          {!produto.tem_acesso && <Compra produto={produto} />}
        </>
      )}
    </main>
  );
}

/**
 * O bloco de compra.
 *
 * **Produto sem `checkout_url` não mostra botão**: link ainda não cadastrado é o
 * estado normal do catálogo hoje (§17), e um botão que não leva a nada é pior
 * que nenhum botão.
 */
function Compra({ produto }: { produto: ProdutoDaLoja }) {
  if (!produto.checkout_url) {
    return (
      <p className="rounded-2xl border-2 border-noite-100 px-5 py-4 text-lg leading-relaxed text-noite-700">
        Este conteúdo ainda não está disponível para compra aqui.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      {produto.preco_cents !== null && (
        <p className="text-2xl font-semibold text-noite-900">{emReais(produto.preco_cents)}</p>
      )}

      {/*
       * Antes do botão, não depois: compra feita com outro e-mail cria **outra
       * conta** pelo postback (§7), e o conteúdo não aparece para a pessoa. Ela
       * escreve para o suporte achando que não recebeu.
       */}
      {produto.email_da_conta && (
        <p className="rounded-2xl border-2 border-ouro-300 bg-ouro-300/15 px-5 py-4 text-lg leading-relaxed text-noite-900">
          Na compra, use o mesmo e-mail do app:{' '}
          <strong className="break-all font-semibold">{produto.email_da_conta}</strong>
        </p>
      )}

      {/*
       * Marca antes de sair: o checkout abre fora do app e, no iPhone, voltar
       * pelo ícone é uma abertura nova. É por essa marca que o app sabe, na
       * volta, que tem uma compra para conferir (§7).
       */}
      <a
        href={produto.checkout_url}
        onClick={() => marcarCompra(produto.id)}
        className="block min-h-[64px] w-full rounded-xl bg-noite-900 px-4 py-4 text-center text-xl font-semibold text-white"
      >
        Quero este conteúdo
      </a>
    </section>
  );
}
