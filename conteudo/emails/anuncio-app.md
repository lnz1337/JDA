# E-mail de anúncio do app para quem já comprou

Campanha única para os compradores anteriores ao app. Enviar **só em produção**, com o app
funcionando (no mínimo fases 4 e 5 entregues: login e jornada com player).

Variáveis disponíveis no template:
- `{{primeiro_nome}}`: primeiro nome do cliente (se vazio, usar "Olá!" sem nome)
- `{{link_acesso}}`: link de acesso direto e pessoal (`/acesso?t={token}`), de uso único e válido por 7 dias
- `{{lista_produtos}}`: lista dos produtos liberados para esse cliente, um por linha
- `{{link_parar}}`: link para deixar de receber avisos (não afeta e-mails de login)
- `{{email_suporte}}`: suporte@jornadacomeuanjo.com

## Assunto (teste A/B, se houver volume)

- A: `{{primeiro_nome}}, sua Jornada com Meu Anjo agora tem um app`
- B: `Sua jornada com São Miguel ficou mais fácil`

**Pré-cabeçalho** (texto que aparece ao lado do assunto na caixa de entrada):
`Os 19 dias, os áudios e a oração do dia, tudo no seu celular. Já liberado para você.`

## Corpo

Olá, {{primeiro_nome}}!

Você faz parte da **Jornada com Meu Anjo**, e preparamos um presente para a sua caminhada com São Miguel: agora a jornada tem um **aplicativo próprio**, feito para caber no seu dia.

**O que você encontra no app:**
- Os **19 dias da jornada**, um por dia, com áudio, reflexão e a prática do dia
- O **Canto de São Miguel** dentro de cada oração
- Um **lembrete diário** no horário que você escolher, para não perder nenhum dia
- O **Hino de São Miguel**, para rezar cantando

**Já está tudo liberado para você.** Estes são os conteúdos da sua compra:

{{lista_produtos}}

Você não paga nada a mais.

**Para entrar é só um toque.** Toque no botão abaixo e você já entra no app, sem senha:

[ Entrar no meu app ]({{link_acesso}})

Este botão é só seu e vale por 7 dias. Se ele já tiver sido usado ou estiver vencido, o app pede o seu e-mail e manda um código de 6 números. É só digitar o código e pronto.

**Dica:** depois de entrar, o app mostra como colocá-lo na tela inicial do seu celular, como um aplicativo comum. Assim você abre com um toque, todos os dias. No iPhone, ao abrir pela tela inicial pela primeira vez, ele pode pedir o código uma vez.

Se tiver qualquer dificuldade para entrar, é só responder este e-mail ou escrever para {{email_suporte}}. Vamos te ajudar.

Que São Miguel Arcanjo vá sempre à sua frente.

Com carinho,
**Equipe Jornada com Meu Anjo**

---
Você está recebendo este e-mail porque comprou a Jornada com Meu Anjo. Se não quiser mais receber avisos sobre o app, [clique aqui]({{link_parar}}). Os e-mails com o seu código de acesso continuam chegando normalmente.

Jornada com Meu Anjo · [jornadacomeuanjo.com](https://jornadacomeuanjo.com) · [Política de Privacidade](https://jornadacomeuanjo.com/privacidade)

<!-- Nota editorial: o rodapé não traz os dados da empresa de propósito. A identificação completa do responsável pelos dados (exigida pela LGPD) fica na Política de Privacidade. -->

## Versão para WhatsApp (opcional, para quem tem telefone)

Use para quem não tem e-mail válido (`fake_email`) ou não abriu o e-mail em 3 dias.

> Olá, {{primeiro_nome}}! 🙏
>
> Aqui é da *Jornada com Meu Anjo*. Temos uma novidade: agora a sua jornada com São Miguel tem um *aplicativo*, com os 19 dias, os áudios e um lembrete diário de oração.
>
> Já está liberado para você, sem pagar nada a mais. Para entrar, é só tocar no link:
> {{link_acesso}}
>
> Se o app pedir um código ou qualquer coisa não funcionar, é só responder esta mensagem que a gente te ajuda. Que São Miguel vá à sua frente!
