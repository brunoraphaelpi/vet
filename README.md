# Sistema Veterinário em Domicílio

Sistema web completo (mobile first) para uma veterinária de atendimento domiciliar:
agendamento de visitas, carteira de vacinação digital, histórico de atendimentos e um
painel restrito para a veterinária administrar tudo.

Diferente de um protótipo, este é um sistema real: roda como um servidor Node.js comum,
guarda os dados em disco (não depende de nenhum serviço externo) e pode ser hospedado
em qualquer lugar que rode Node — de uma VPS simples a serviços como Railway, Render
ou um servidor próprio.

## O que o sistema já faz

- Login de cliente por CPF/senha (com cadastro próprio) e área restrita da veterinária
  com senha separada.
- Agendamento por proposta: o cliente sugere até 3 opções de dia/horário, endereço
  (com busca automática por CEP) e pode anexar uma foto ou vídeo do que está
  acontecendo com o pet.
- A veterinária escolhe uma das opções (ou recusa) direto pelo painel; a confirmação
  ou recusa dispara e-mail automático (se configurado) e um link de WhatsApp pronto
  para enviar em um toque.
- Botão para adicionar a visita confirmada ao Google Agenda, tanto para o cliente
  quanto para a veterinária.
- Carteira de vacinação digital por pet, com foto da carteira física e foto do
  próprio pet.
- Notas privadas por pet, visíveis só para a veterinária (o cliente nunca recebe
  esse campo, nem pela API).
- A veterinária pode anexar arquivos (receitas, exames etc.) a cada visita; o
  cliente só visualiza/baixa, não edita.
- Fotos e vídeos podem ser clicados para ampliar ou abrir em outra aba.
- Painel inicial da veterinária com lembretes de próximos agendamentos e vacinas
  vencendo nos próximos 30 dias.
- Identidade visual configurável (nome, slogan e logo) e os textos das mensagens
  automáticas de confirmação/recusa são editáveis pela própria veterinária, na aba
  "Config." do painel.

## Como funciona o agendamento

1. O cliente propõe até 3 opções de dia/horário (junto com o endereço da visita, o
   motivo e, se quiser, uma foto ou vídeo do que está acontecendo com o pet).
2. A veterinária vê o pedido no painel, escolhe uma das opções (ou recusa).
3. Ao confirmar, o sistema:
   - envia um e-mail de confirmação automaticamente para o cliente, **se o envio de
     e-mail estiver configurado** (veja `.env` abaixo);
   - gera um link de WhatsApp pronto, com a mensagem já escrita, para a veterinária
     clicar e enviar em um toque — isso funciona sempre, mesmo sem nenhuma configuração,
     porque usa o WhatsApp da própria veterinária (não depende de nenhuma API paga).

## Rodando localmente

Pré-requisito: [Node.js](https://nodejs.org) versão 18 ou mais recente.

```bash
npm install
cp .env.example .env
npm start
```

Acesse `http://localhost:3000` no navegador (ou no celular, na mesma rede, pelo IP da
máquina). O sistema é mobile first — funciona bem tanto no celular quanto no computador.

Na primeira vez que o servidor roda, ele cria a senha inicial da área da veterinária
(`vet2026` por padrão, ou o valor de `VET_SENHA_INICIAL` no `.env`). Troque essa senha
assim que entrar, pelo botão **"Alterar senha"** no painel.

## Configurando o `.env`

Copie `.env.example` para `.env` e ajuste:

- `PORT` — porta em que o servidor roda (padrão 3000).
- `JWT_SECRET` — uma string aleatória usada para assinar os logins. Troque por algo
  único antes de colocar em produção.
- `VET_SENHA_INICIAL` — senha inicial da área da veterinária (só vale na primeira vez).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` —
  opcionais, para o envio automático de e-mail de confirmação. Se deixar em branco,
  o sistema simplesmente não envia e-mail (mas o link de WhatsApp continua funcionando
  normalmente). Um exemplo comum é usar o Gmail com uma ["senha de app"](https://support.google.com/accounts/answer/185833):
  `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`.

## Subindo em um servidor

Este projeto não precisa de banco de dados externo — os dados ficam em
`data/db.json` e as fotos/vídeos em `data/uploads/`. Isso torna o deploy simples:

**Opção 1 — Railway, Render, Fly.io ou similar (mais fácil):**
1. Suba esta pasta para um repositório Git (GitHub, GitLab etc.).
2. Crie um novo serviço "Web Service" a partir do repositório.
3. Comando de build: `npm install`. Comando de start: `npm start`.
4. Configure as variáveis de ambiente do `.env` no painel do serviço.
5. **Importante:** configure um "volume" ou "disco persistente" apontando para a pasta
   `data/` — sem isso, os dados podem ser apagados a cada novo deploy.

**Opção 2 — VPS própria (Hetzner, DigitalOcean, etc.):**
```bash
git clone <seu-repositorio>
cd vet-domicilio-web
npm install
cp .env.example .env   # edite o .env
npm install -g pm2
pm2 start server/index.js --name vet-domicilio
pm2 save
pm2 startup            # deixa o sistema reiniciando sozinho se o servidor reiniciar
```
Depois, configure um proxy reverso (Nginx ou Caddy) apontando para a porta do Node,
com certificado HTTPS (o Caddy faz isso automaticamente).

## Backup

Basta copiar a pasta `data/` inteira (contém `db.json` com todos os cadastros e
agendamentos, e `uploads/` com as fotos e vídeos). Faça isso com regularidade, por
exemplo com uma tarefa agendada (`cron`) copiando `data/` para outro lugar.

## Estrutura do projeto

```
server/            back-end (Node + Express)
  index.js          ponto de entrada
  db.js              armazenamento em arquivo (data/db.json)
  routes/            rotas da API (auth, pets, agendamentos, vet)
  mailer.js          envio de e-mail (opcional, via SMTP)
  whatsapp.js        geração do link de WhatsApp
public/             front-end (HTML/CSS/JS puro, sem build)
  index.html
  css/style.css      visual mobile first
  js/app.js          toda a lógica da interface
data/               dados e uploads (criado automaticamente)
```

## Segurança

- Senhas de clientes e da veterinária são armazenadas com hash (bcrypt), nunca em
  texto puro.
- Sessões usam tokens JWT válidos por 30 dias.
- Troque `JWT_SECRET` e a senha inicial da veterinária antes de usar em produção.
