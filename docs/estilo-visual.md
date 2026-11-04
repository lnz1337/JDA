# Estilo visual: no padrão do app da Novena das 9 Palavras

Pedido do Leo (04/11): o JDA no mesmo estilo de
<https://novena-9-palavras.vercel.app/>. Este arquivo diz **o que vem de lá, o que
não vem e por quê**, e divide o trabalho em fases. Vale junto com o CLAUDE.md:
onde os dois conflitarem, a regra do CLAUDE.md (acesso, §9, §11, §14) ganha, e a
seção que mudar de propósito (§4, abas) é atualizada no mesmo commit.

**É referência de estilo e de estrutura de tela, não de conteúdo.** Não copiar
texto, imagem nem código de lá. O `app.css` deles pode ser lido como referência
de cor e de medida. Para ver o app, entra-se com qualquer nome (não tem login).

## Onde estamos e para onde vai

Hoje o app é branco e azul-noite (`noite-*`, `ouro-*`, `papel` no
`src/client/index.css`), letra de 18px, cartões de borda fina, uma lista de dias
e uma lição numa tela só. O 9 Palavras é **creme e dourado, com título em serifa,
arte sacra no topo e uma coisa por tela**. O que faz ele parecer "app de oração"
e não "site":

1. **Arte sacra** (pintura clássica) no alto das telas principais, desbotando
   para o fundo.
2. **Título em serifa** (Cormorant Garamond), corpo em Inter, letra de 20px.
3. **Botão dourado em relevo**: degradê com uma sombra sólida embaixo, que
   parece botão de verdade. Um botão dourado por tela, e é o de rezar.
4. **A Home diz o que fazer agora**: cartão com a arte, "AGORA · DIA 1",
   duração em minutos e "Começar ›"; embaixo, a lista do dia com os passos
   numerados e os minutos de cada um.
5. **O mapa da jornada**: caminho em zigue-zague, um círculo por dia, os
   bloqueados com cadeado, etapas com nome e marcos com vela.
6. **A oração em passos**: uma tela por parte, barra de progresso em segmentos,
   "Por que hoje" numa caixa com filete dourado, "Continuar" e "‹ Voltar um
   passo", botão de letra maior.
7. **Loja que começa pelo que já é seu**: cartão verde "✓ Já é seu" antes de
   qualquer coisa à venda.
8. **Tema claro e escuro**, com o claro de padrão.

## O que não vem, e por quê

| Lá | Aqui | Por quê |
|---|---|---|
| Entra só com o nome | Continua o login por código (§8) | O JDA é acesso comprado |
| 7 abas com rótulo de ~11px | Só as abas que existem, rótulo de 16px ou mais (§4) | 55+; aba que não leva a nada ensina que o app quebrou |
| Bolinha vermelha na aba da loja | Não | É aviso de notificação usado para vender. Sem push de oferta (§9) vale também para isso |
| "8.781 irmãs rezaram hoje" | Só com número real, e só acima de um mínimo (fase do Mural) | Número inventado é mentira; "2 pessoas rezaram" desanima |
| Mural com sobrenome, foto e doença de terceiros | §10: primeiro nome, aviso antes de escrever, sem foto | O dado é de quem não escolheu aparecer |
| "Bem-vinda", "irmãs" | Forma neutra ("Que bom ter você aqui") | A base não é só de mulheres |
| "Preciso de: saúde, dinheiro…", Bíblia, salmos, chat, música | Fora | Não há conteúdo, e oração por necessidade precisa do cuidado do §14. Se vier, é conteúdo novo (pipeline) |
| Faixa de instalar em todas as telas | Só na Home, como hoje (§11) | Convite que persegue vira ruído |
| E-mails | Não mudam nesta rodada | Têm layout próprio, feito para o Outlook (§8) |

## Cores

Tokens **semânticos**, trocados pelo atributo `data-tema` no `<html>`, para a
mesma classe servir aos dois temas sem `dark:` em todo lugar (no Tailwind v4:
variáveis CSS no `:root` e `[data-tema="escuro"]`, ligadas por `@theme inline`).
A paleta `noite-*` sai.

| Token | Claro (padrão) | Escuro | Uso |
|---|---|---|---|
| `fundo` | `#F7F2E8` | `#0C0704` | fundo da página |
| `fundo2` | `#F1EADB` | `#140C05` | cabeçalho, barra de abas |
| `cartao` | `#FFFDF8` | `#170E06` | cartões, botão secundário |
| `linha` | `#E3D7BF` | `#2E2013` | bordas, separadores |
| `titulo` | `#1A1004` | `#F6E4B6` | títulos em serifa |
| `texto` | `#2A1A0B` | `#E6DBC6` | corpo |
| `texto2` | `#5F5040` | `#C9B48E` | apoio, legenda |
| `ouro` | `#8A6524` | `#C9A24A` | rótulo em caixa alta, filete |
| `ouro-forte` | `#6B4E14` | `#F0CD7A` | link, aba ativa, texto do botão secundário |
| `verde-fundo` / `verde` | `#EEF5E4` / `#2A7350` | `#16200A` / `#7FC59A` | "Já é seu", dia concluído |

Botões (iguais nos dois temas):

- **Dourado** (rezar, começar, comprar): degradê `#D8AC52 → #BD8F34` de cima
  para baixo, texto `#1A1004` em peso 800, `box-shadow: 0 5px 0 #7D5C1C`,
  raio 12px, altura mínima 60px. No toque, desce 3px e a sombra encolhe.
- **Verde** (só o "Concluí o dia N"): `#3A9668 → #2A7350`, texto branco,
  sombra `0 5px 0 #1D5238`. Distinto do dourado de propósito: concluir não é
  rezar de novo.
- **Secundário** ("‹ Voltar", "Continuar" enquanto o áudio não tocou): fundo
  `cartao`, borda `linha`, texto `ouro-forte` em peso 700, altura mínima 52px.

`theme-color` (meta e manifest) acompanha o `fundo2` do tema. O tema escolhido
fica no `localStorage` (com `try/catch`) e é aplicado **antes da primeira
pintura**, num script curto no `index.html`, para não piscar branco no escuro.

## Letra

- **Cormorant Garamond** 600/700 nos títulos (24px ou mais) e no texto de oração
  rezada (intenção, oração centralizada). Em tamanho pequeno ela fica fina
  demais: abaixo de 24px é Inter.
- **Inter** 400 a 800 no resto. **Corpo de 20px.**
- **Fontes servidas pelo próprio app** (`@fontsource`, só o subconjunto latino),
  não pelo Google Fonts: o shell precisa abrir sem internet (§12), não há
  requisição para terceiro e o celular antigo não espera a fonte
  (`font-display: swap`).
- Rótulo em caixa alta (`AGORA · DIA 3`, `POR QUE HOJE`): Inter 800, 15px,
  espaçamento de 2px, cor `ouro`. É o menor texto do app.
- Alvo de toque nunca abaixo de 52px; barra de abas com 64px.

**Tamanho da letra regulável**: quatro tamanhos (`--fs` de 0,9, 1, 1,15 e 1,3),
guardados no aparelho (`localStorage` com `try/catch`). Aumentar aumenta todo o
texto, inclusive os botões; nada pode estourar a largura de 360px no tamanho
maior. Os controles aparecem em dois lugares: um passo novo do onboarding ("A
letra está boa?") e o par **A− / A+** na lição.

## Componentes

- **Cabeçalho fixo**: "Jornada com Meu Anjo" em serifa e, embaixo, "COM SÃO
  MIGUEL ARCANJO" em caixa alta espaçada; à direita, o botão de tema
  ("☀️ Claro" / "🌙 Escuro"). Fundo em degradê suave para o `fundo2`.
- **Arte**: ver "Imagem" abaixo. No topo da tela, largura inteira, desbotando
  para o `fundo` na metade de baixo.
- **Cartão**: fundo `cartao`, borda de 1px `linha`, raio 16px.
- **Caixa "Por que hoje"**: cartão com filete de 3px `ouro` à esquerda e o rótulo
  em caixa alta em cima.
- **Chip de duração**: "🕐 7 min", pílula de fundo `linha`. Sai do `duration_s`,
  arredondado para cima; sem duração, sem chip.
- **Ornamento**: linha fina dourada, uma cruz pequena no meio, linha de novo (SVG
  inline). Separa o título do resto na Início e na intenção.
- **Barra de progresso em segmentos**: um segmento por passo, os feitos em
  `ouro`, o atual mais escuro.
- **Velas**: 19 velinhas (9×14px); acesa é degradê `#F0CD7A → #BD8F34` com um
  brilho leve, apagada é `linha`. "N de 19 acesas" ao lado.
- **Barra de abas**: fundo `cartao`, borda de cima `linha`, aba ativa em
  `ouro-forte`, ícone e rótulo sempre (§4).

## Imagem

**São Miguel Arcanjo, de Guido Reni (1635)**, na igreja de Santa Maria della
Concezione dei Cappuccini, em Roma. Domínio público: o pintor morreu em 1642, e
a reprodução fotográfica fiel de obra em duas dimensões não gera direito novo
(no Wikimedia Commons, marcação PD-Art). Baixar do Commons a reprodução de maior
resolução, conferir a marcação de domínio público na página do arquivo e anotar
a origem no `docs/ESTADO.md`.

- Dois recortes: **faixa** (3:1, rosto, asas e espada) para o topo das telas, e
  **cartão** (4:3) para o cartão de hoje. Nada do demônio aos pés no recorte: a
  primeira tela da manhã é a oração, não o combate.
- WebP em duas larguras (480 e 960), cada uma com até 120 KB, em `public/img/`;
  `srcset`, `loading="eager"` só na Home, e o service worker guarda no cache do
  shell.
- `alt="São Miguel Arcanjo, pintura de Guido Reni"`.
- **Nunca a imagem do 9 Palavras.**

## Telas

### Lição em passos

A lição da jornada vira **três passos**, a partir do `body_md` que o
`conteudo/gerar_seed.py` já gera sempre no mesmo formato:

```
**Leitura do dia:** <referência>

<reflexão>

**Prática de hoje:** <prática>

**Intenção:** <intenção>
```

O `GET /api/licoes/:id` devolve, além do que já devolve, `passos: { leitura,
reflexao, pratica, intencao } | null`, separado no servidor por esses três
rótulos exatos. Lição sem esse formato (Presentes, UP1, UP2) vem com `passos:
null` e continua numa tela só, com o estilo novo. Teste com o `body_md` real do
seed.

1. **A oração de hoje**: rótulo "DIA 3 DE 19 · O CHAMADO", título em serifa,
   frase do dia, "📖 Salmo 91 (90)", o **player** grande e a caixa "POR QUE
   HOJE" com a reflexão. O botão dourado aqui é o de **ouvir** ("▶ Ouvir a
   oração · 7 min"); o "Continuar" é secundário até o áudio passar de 90%, e
   então vira dourado.
2. **A prática de hoje**: rótulo "PARA FAZER HOJE", o texto da prática grande,
   "Continuar" dourado.
3. **A sua intenção**: rótulo "A SUA INTENÇÃO", ornamento, a intenção em serifa,
   centralizada, e o botão **verde** "Concluí o dia 3". Concluído, uma tela curta:
   as 19 velas com a do dia acesa, "A vela do dia 3 está acesa" e quando abre o
   próximo ("O dia 4 libera amanhã"; no dia 19, o fechamento da jornada). Botão
   "Voltar para o início".

Regras:

- **O áudio não para ao trocar de passo.** O `<audio>` fica montado na tela da
  lição inteira; nos passos 2 e 3 ele aparece como um mini player fixo embaixo
  ("⏸ Pausar · 3:12"). Media Session, posição salva, `Range`,
  `lesson_started` no `play`, `audio_completed` acima de 90% e
  `lesson_completed` só quando o progresso é novo: **nada disso muda** (§6).
- O passo está na URL (`/licao/:id?passo=2`): o push abre no passo 1, e voltar
  pelo navegador volta um passo.
- Barra de segmentos no topo, "‹ Voltar um passo" a partir do passo 2, e A− / A+
  em todos.
- "Continuar" nunca é travado: quem não quer ouvir agora segue em frente.
- A barra de abas continua fora da lição.

### Home ("Hoje")

De cima para baixo:

1. Convite do aparelho (instalar ou lembrete) como **faixa fina** sob o
   cabeçalho: "📲 Coloque o app na tela do celular ›" e um "Agora não" de 52px
   que dispensa por 7 dias, como hoje (§11).
2. Saudação em serifa pelo **horário no fuso da pessoa**: "Bom dia" (5h–11h),
   "Boa tarde" (12h–17h), "Boa noite" (18h–4h), com o primeiro nome
   ("ELIANA" vira "Eliana"); sem nome, "Bom dia!". Embaixo, "Dia 3 de 19".
3. **Cartão de hoje**, com a arte no topo: "AGORA · DIA 3 · O CHAMADO", o título
   do dia, a frase, o chip de duração e o botão dourado "Começar ›" (concluído:
   "✓ Concluído" e o botão secundário "Ouvir de novo").
4. **"A sua jornada de hoje · 1 de 3"**, com barra de progresso e os três passos
   numerados (🙏 Ouvir a oração · 7 min, ✝ A prática de hoje, 🕯️ Entregar a
   intenção). Cada linha abre a lição naquele passo. Feito: o passo 1 quando o
   áudio passou de 90%, o 2 quando a pessoa passou por ele (os dois no
   `localStorage`, por lição, como conveniência), o 3 quando o servidor diz que
   a lição está concluída. Lição concluída no servidor marca os três.
5. O card de oferta (§9), **abaixo** da lista do dia e com o estilo novo.
6. "Também liberado para você" (Presentes, pacotes), em cartões.
7. A linha do lembrete e o "Sair do app", como hoje, até o Perfil existir.

A Home **continua sem matricular** (§6). Sem matrícula, o cartão convida para o
dia 1.

**Depois, quando os áudios das lições 3 e 4 dos Presentes estiverem no R2**: a
lista do dia ganha "☀️ Ao acordar · A oração de São Miguel" antes e "🌙 Antes de
dormir · Santo Anjo do Senhor" depois, marcados como feitos ao abrir. Não antes:
item que abre um áudio que não toca é pior que item nenhum.

### Jornada (o mapa)

Nova aba **Jornada**, separada da Home (que vira a aba **Hoje**). Abas: Hoje ·
Jornada · Loja; Mural e Perfil entram nas fases deles. O §4 muda no mesmo commit.

1. Arte em faixa, "A sua jornada" e "você está no dia 3 de 19" (o mesmo "dia de
   hoje" do lembrete).
2. **O seu altar**: as 19 velas, acesas as dos dias concluídos.
3. **As etapas**, vindas de `program.stages` no `seed/jornada-19-dias.json`
   (já gerado pelo pipeline): `[{ from_day, to_day, title, subtitle }]`, quatro
   etapas cobrindo os 19 dias. Precisa de onde morar: migration com
   `programs.stages_json TEXT` (nulo nos outros programas), o `seed-sql.ts`
   gravando o JSON, e o `GET /api/programas/:id` devolvendo `etapas`. Programa
   sem etapas mostra o caminho sem os blocos.
4. Em cada etapa: título em serifa, a frase, "2 de 7", e o **caminho em
   zigue-zague** (esquerda, centro, direita, centro…) com uma linha tracejada
   ligando os círculos. Estados do círculo:
   - concluído: dourado cheio, ✓;
   - hoje: dourado, maior, com o número e um anel;
   - liberado e não feito (atrasado): creme com borda dourada e o número;
   - bloqueado: apagado, 🔒, e embaixo **quando abre** ("Libera amanhã",
     "Libera em 5 dias") — a regra do §6 vale aqui também.

   Embaixo de cada círculo, "Dia N" e o título em até duas linhas. Tocar num
   liberado abre a lição; num bloqueado, não navega.
5. **Marcos** com vela sob os dias 3 ("Três dias"), 7 ("Uma semana"), 10
   ("Metade do caminho") e 19 ("A jornada completa"), acesos quando alcançados.

Animação só com `prefers-reduced-motion: no-preference`, e nada que rode em
laço: celular antigo. Os programas que liberam tudo de uma vez (Presentes, UP1,
UP2) continuam em lista, com o estilo novo. Nada do Círculo aparece no mapa
nesta rodada: a vez dele é a fase 7, e só depois do dia 19 (§9).

### Loja

1. "Loja", com uma frase curta embaixo.
2. **"✓ Já é seu"**: cartões verdes com o que a pessoa já tem (a Jornada, os
   Presentes, um pacote comprado). Tocar abre o programa.
3. **O resto**: capa à esquerda (`cover_key`; sem capa, um quadrado escuro com
   ✝), título em serifa com 🔒, a descrição de uma linha, o aviso do §14 quando
   houver, e o botão dourado **"Ver o que tem dentro · R$ 97"** (preço do
   `price_cents`).
4. Rodapé: "O pagamento é feito na Payt, com o seu e-mail já preenchido."

A página do produto ganha a capa grande, título em serifa, o aviso, a descrição,
o botão dourado de comprar e o "‹ Voltar" secundário. UTM, pré-preenchimento e
polling pós-compra (§7) não mudam.

### Início, Entrar e onboarding

- **Início**: arte no topo, "Jornada com Meu Anjo" em serifa grande, ornamento,
  uma frase sem promessa ("19 dias de oração com São Miguel Arcanjo, um por
  dia, com áudio."), botão dourado "Entrar no meu app" e o suporte.
- **Entrar e código**: o mesmo fluxo do §8, com o estilo novo. O campo do código
  em Inter 800, grande e espaçado; o aviso do Spam continua visível desde o
  início.
- **Sem acesso**: o mesmo texto, com o estilo novo.
- **Onboarding**: duas telas novas **antes** de instalar.
  1. **"Um dia de cada vez"**: "São 19 dias. Cada dia libera uma oração em áudio
     de uns 7 minutos, uma prática simples e uma intenção. Se você atrasar, o
     app guarda onde parou." Botão "Continuar" e "Pular" (vai para a Home).
  2. **"A letra está boa?"**: um parágrafo de amostra, "Aumentar" e "Diminuir"
     (secundários, 52px), e o dourado "Está boa assim".

  Depois, instalar → lembrete → horário, como hoje, com o "Agora não" que
  encerra (§11). Quem já fez o onboarding não vê as telas novas: tem o A− / A+
  na lição.

## Fases

Um commit por item, `npm run typecheck && npm test` limpos, push (§18), deploy
em **staging**. Ao fim de cada fase, prints de 390px das telas mexidas, no tema
claro, no escuro e na letra maior, para o Leo conferir no iPhone e no BlueStacks.
**Produção só quando o Leo pedir.**

| Fase | O quê | Muda comportamento? |
|---|---|---|
| R1 | Tokens, temas, fontes, letra regulável, componentes, cabeçalho, barra de abas e a arte, aplicados às telas que existem | Não, só aparência (e o tema/letra, que são novos) |
| R2 | Lição em passos, com `passos` no `GET /api/licoes/:id` | Sim: a lição vira três telas |
| R3 | Home "Hoje" | Sim: lista do dia, saudação |
| R4 | Mapa da jornada, `programs.stages_json`, aba Jornada | Sim: aba nova, §4 |
| R5 | Loja com "Já é seu" | Pouco |
| R6 | Início, Entrar, Sem acesso e as duas telas novas do onboarding | Sim: onboarding |

A fase 7 (Círculo, prazo por volta de 15/11, quando os primeiros chegam ao dia
19) é construída **já no estilo novo**: depois da R1, nenhuma tela nova nasce na
paleta velha.
