# Entrada sem código

Pedido do Leo (04/11): **tirar o código de 6 números da entrada.** Para o público
mais velho, ele é o maior empecilho do app: a pessoa sai do app, procura o
e-mail (que cai em Promoções ou no Spam), decora seis números e volta. Das 1.427
pessoas que receberam o anúncio, perto de 100 entraram.

Esta mudança vem **antes** da reforma visual (`docs/estilo-visual.md`): é
pequena, mexe só na entrada, e é ela que decide quantas pessoas chegam a ver o
app novo. Quando entrar, o §8 do CLAUDE.md é reescrito no mesmo commit.

## Por que não é "só o nome", como no 9 Palavras

O 9 Palavras não tem acesso pago dentro do app: quem tem o endereço usa tudo, e
o nome serve só para a saudação e o mural. Aqui o app precisa saber **quem
comprou**, e o nome sozinho não diz isso:

- há centenas de Marias na base, e a pessoa escreve o nome de um jeito no
  checkout e de outro no app;
- sem saber quem é, o app não sabe o que liberar, e a compra dentro do app
  (Tesouros, Círculo) cai numa conta que o aparelho não conhece (§7: o
  postback acha a pessoa pelo e-mail ou pelo telefone).

O que a pessoa **sabe de cabeça** e que identifica a compra é o **celular**,
que o checkout da Payt pede junto com o e-mail. Então a entrada vira: **o
celular ou o e-mail da compra, e pronto.** O nome fica para a saudação, como no
9 Palavras.

## Como fica

### Tela de entrada (`/entrar`)

1. "Entrar no app", em serifa, e dois botões grandes, um por linha:
   **"📱 Com o meu celular"** e **"✉️ Com o meu e-mail"**. Dois botões em vez de
   um campo que aceita os dois porque o teclado certo importa: o de números para
   o celular (`inputmode="tel"`), o de e-mail para o e-mail. Celular em cima.
2. Depois do toque, um campo só, com o rótulo "O celular da sua compra, com
   DDD" (ou "O e-mail da sua compra") e o botão dourado **"Entrar"**. Link
   "Prefiro entrar com o e-mail" (ou celular) para trocar.
3. Achou: entra direto. Não achou: "Não encontramos uma compra com esse
   celular. Confira o número ou tente com o e-mail." e, embaixo, o suporte
   (e-mail e WhatsApp).

Quem chega com `?e=` (link nosso com e-mail) cai direto no campo de e-mail
preenchido: um toque em "Entrar". O link de acesso (`/acesso?t=`) continua como
está, com o mesmo botão; vencido ou usado, a frase vira "Este link já foi usado.
Entre com o seu celular ou e-mail."

### Servidor (`POST /api/entrar`)

- Corpo `{ email }` ou `{ celular }`, validado com Zod.
- **E-mail**: minúsculo e sem espaço, comparado com `users.email`.
- **Celular**: só dígitos; tira o `55` da frente quando sobram 12 ou 13
  dígitos; compara **DDD + os 8 últimos dígitos** com o `users.phone`
  normalizado do mesmo jeito. É o que casa número com e sem o 9 da frente, que
  convivem na base.
- Só usuário com `deleted_at IS NULL`. Achou um: cria a sessão (o mesmo cookie
  de 365 dias do §8). Sem produto ativo, cai na tela de Sem acesso, como hoje.
- **Mais de um usuário com o mesmo celular** (família que comprou com o mesmo
  número): não escolhe por conta própria; pede o e-mail ("Este número está em
  mais de uma compra. Entre com o e-mail.").
- **Limite**: 10 tentativas por hora por IP e 10 por identificador (o
  `lib/limite.ts` que já existe). Acima disso, a mensagem oferece o suporte em
  vez de outro botão que não funciona. O limite é maior que os 5 do código
  porque aqui o erro comum é dígito trocado, e a pessoa tenta de novo.
- `events`: `login` com `metodo` (`celular`, `email` ou `link`) e, na falha,
  `login_falhou` com o motivo (`nao_encontrado`, `varios`, `limite`). **Nunca o
  e-mail nem o número.** É o que mostra se a mudança funcionou.
- A entrada **não manda e-mail nenhum**. De quebra, sobra cota: o código de
  login saía da reserva de 300 do transacional (§8).

### O nome

Se a conta não tem nome (`users.name` vazio), depois de entrar aparece uma tela
"Como podemos te chamar?", com um campo, o dourado "Continuar" e "Pular". Grava
em `PATCH /api/me` (`nome`, até 60 caracteres, Zod). É o nome da saudação ("Bom
dia, Maria") e, no Mural, a fonte do primeiro nome. Quem já tem nome não vê essa
tela. Nome que veio todo em maiúsculas da Payt ("ELIANA") é mostrado com a
primeira letra maiúscula e o resto minúsculo, sem mexer no que está gravado.

### O código continua onde protege

**Excluir a conta e trocar o e-mail continuam pedindo o código**, mandado para o
e-mail atual (§8). Essas ações são as que fazem estrago se outra pessoa estiver
com o celular na mão. O código de login (`purpose = 'login'`) sai da tela; a
rota que pede esse código pode ser removida.

## O que se aceita, e o que segura

| Risco | Tamanho | O que segura |
|---|---|---|
| Quem sabe o celular ou o e-mail de um cliente entra na conta dele | Vê o primeiro nome, o que a pessoa comprou e o progresso | Trocar e-mail e excluir conta pedem código. O app **nunca mostra o e-mail nem o telefone completos** (no Perfil, quando vier: `ma•••@gmail.com`, `(18) •••••-1234`) |
| Dá para testar se um número ou e-mail é cliente | Ser cliente de um app católico diz a religião da pessoa, que a LGPD trata como dado sensível | Limite por IP e por identificador: testar uma lista vira trabalho de semanas |
| Um cliente passa o celular para a família entrar junto | Um acesso vira vários | Aceitável num produto de oração de baixo preço; o progresso fica misturado, e é problema só de quem dividiu |

## Textos que mudam

- **App** (`src/`): `/entrar`, a tela do link inválido, Início e Sem acesso.
  Nenhum texto fala de código na entrada.
- **E-mail de boas-vindas** (`src/worker/emails/boas-vindas.md`): a frase "Depois
  disso você entra pelo app pedindo um código para este mesmo e-mail" vira
  "Depois disso, é só entrar no app com o seu celular ou e-mail."
- **Pipeline** (fora do `src/`, comigo): o PDF da área de membros da Payt, que
  ensina o passo do código, e a frase de reserva do `lembrete-app.md`. Avisar
  quando a entrada nova estiver em produção.

## Testes

- Celular com e sem o 9, com e sem `55`, com máscara (`(18) 99999-1234`).
- E-mail com maiúscula e espaço.
- Dois usuários com o mesmo celular: pede o e-mail, não entra em nenhum.
- Usuário excluído não entra.
- Limite por IP e por identificador.
- Sessão criada igual à do código (cookie, validade, renovação).
- Nenhum `events` com o e-mail ou o número.
- Excluir a conta continua exigindo o código.

## Ordem

1. Esta entrada, em staging; o Leo testa no iPhone e no BlueStacks.
2. **Produção** assim que o Leo der o ok: é a mudança que mais pesa no número de
   pessoas que entram.
3. Depois, o disparo do `lembrete-app` e a reforma visual.
