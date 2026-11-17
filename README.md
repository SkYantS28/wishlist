# wishly

Rede social de listas de desejos, construída com React, Vite, Node.js, Express, Prisma e PostgreSQL.

## Requisitos

- Node.js 20 ou superior
- Docker com Docker Compose, ou PostgreSQL 16+

## Desenvolvimento local

1. Instale as dependências e inicie o PostgreSQL:

   ```bash
   npm install
   docker compose up -d db
   ```

2. Crie seu arquivo de ambiente:

   ```bash
   cp .env.example .env
   ```

   Altere `SESSION_SECRET` no `.env` para uma chave aleatória com pelo menos 32 caracteres. O `.env.example` contém credenciais locais de desenvolvimento; não as reutilize em produção.

3. Crie as tabelas e gere o Prisma Client:

   ```bash
   npm run db:deploy
   npm run db:generate
   ```

4. Em terminais separados, inicie a API e o frontend:

   ```bash
   npm run dev:api
   npm run dev
   ```

   Abra a URL exibida pelo Vite. O proxy encaminha `/api` para `http://localhost:3001`.

## Funcionalidades implementadas

- Cadastro, login e logout com senha armazenada usando bcrypt.
- Sessões HTTP-only guardadas no PostgreSQL e proteção CSRF para operações que alteram dados.
- Perfil com nome, `@usuário`, bio e visibilidade pública ou privada.
- Upload de foto de perfil JPEG, PNG ou WebP (até 2 MB).
- Criação, edição e exclusão de listas públicas e privadas.
- Adição, edição, remoção e marcação de desejos como já comprados.
- Pesquisa de perfis e listas públicas, descoberta e feed de quem você segue.
- Pedidos para seguir perfis privados, com aprovação ou recusa pelo dono.
- Recuperação de senha por e-mail quando um SMTP estiver configurado.
- Busca opcional de prévias Open Graph para lojas configuradas na allowlist.
- Cópia independente de um desejo para qualquer lista própria.
- Reserva anônima de presentes: o perfil dono vê apenas o estado de compra pessoal, nunca se um item está reservado nem quem reservou. Para outras pessoas, a reserva aparece sem identificar o autor.
- Autorização no servidor, validação de dados, limitação de tentativas de autenticação e mensagens de erro explícitas.

Perfis privados podem aparecer na busca apenas quando pesquisados pelo @usuário exato. Antes da aprovação, somente o nome e o @usuário ficam visíveis; após a aprovação, a pessoa pode ver as listas públicas. Listas privadas continuam exclusivas do dono. Não há endereço, telefone, pagamentos nem mensagens.

## Configurações opcionais

- **Recuperação de senha:** o `.env.example` vem preparado para Gmail em `crizostisky@gmail.com`. Ative a verificação em duas etapas e [crie uma senha de app no Google](https://myaccount.google.com/apppasswords); coloque-a em `SMTP_PASSWORD` (não use a senha normal da conta). O backend só habilita a recuperação quando todos os campos SMTP estão preenchidos. `APP_URL` deve apontar para a origem pública do site (HTTPS em produção).
- **Prévia de imagem de produto:** configure `PREVIEW_ALLOWED_HOSTS` com domínios confiáveis separados por vírgula (por exemplo, `loja.example,shop.example`). A API aceita somente HTTPS e valida hosts, DNS, redirecionamentos e limites de resposta. Sem uma allowlist, a busca de prévias fica desabilitada; links diretos para imagens continuam funcionando.

## Banco de dados e produção

- `npm run db:migrate -- --name nome-da-migracao`: cria/aplica uma migração em desenvolvimento.
- `npm run db:deploy`: aplica migrações já criadas em produção.
- `npm run db:studio`: abre o Prisma Studio.
- `npm run build`: gera os arquivos estáticos do frontend.
- `NODE_ENV=production npm start`: serve a API e o frontend compilado na mesma origem.

Em produção, defina `DATABASE_URL`, `SESSION_SECRET` (único e aleatório) e `NODE_ENV=production`; publique atrás de HTTPS. Configure backup do PostgreSQL e não exponha o banco diretamente à internet.

## Azure Static Web Apps

O arquivo `public/staticwebapp.config.json` é copiado pelo Vite para a raiz de `dist` e habilita o fallback do app React sem reescrever chamadas `/api/*` como HTML. No assistente de build do Azure, use:

- App location: `/`
- API location: deixe vazia
- Output location: `dist`
- Build command: `npm run build`

Isso publica somente o frontend. O backend atual é um servidor Express e não é executado pelo Static Web Apps como conteúdo estático; para login e listas funcionarem, hospede a API em um serviço compatível ou adapte-a para Azure Functions e configure a API location.

## Testes

```bash
npm test
```

O teste de integração precisa de um banco de teste migrado. Configure `TEST_DATABASE_URL` para esse banco antes de rodar `npm test`; o teste cria e remove somente contas identificadas com um sufixo aleatório.
