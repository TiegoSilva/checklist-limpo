# AJA Anfitrião

Plataforma operacional React + TypeScript, com funções Node.js para Vercel e regras transacionais no Supabase/PostgreSQL. Nenhum imóvel ou registro operacional fictício é carregado por padrão.

## Executar localmente

Requisitos: Node.js 22 e npm.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
# Preencha .env.local com os valores do seu projeto Supabase.
npm.cmd run dev
```

Abra http://127.0.0.1:5173. Visitantes sem sessão veem somente o painel de login, inclusive ao abrir links internos. O portal só é montado após a restauração da sessão. Sem variáveis, a tela de login informa indisponibilidade de acesso; siga a configuração abaixo. O Vite também atende `/api/health`, `/api/operation`, `/api/evidence` e `/api/notifications` durante o desenvolvimento. Segredos são carregados somente no processo Node.

```powershell
npm.cmd test
npm.cmd run build
```

## Supabase

1. Crie um projeto Supabase. No SQL Editor, aplique **todas** as migrações em `supabase/migrations`, em ordem de nome. Em um ambiente com Supabase CLI, prefira `supabase link` e `supabase db push`, revisando as migrações antes de produção.
2. Configure as variáveis da tabela abaixo.
3. No Supabase Auth, crie a primeira conta individual com e-mail confirmado e senha própria. Desabilite cadastro público se a operação for somente por convite. Configure URLs autorizadas e política de autenticação no painel do Supabase.
4. Entre na plataforma e use **Criar organização**. A primeira conta recebe os perfis administrativos dessa organização.
5. Cadastre empreendimentos, unidades, ambientes e inventário. Os nomes do briefing, como Refúgio Casinha Branca e Barra Concept Suites, são cadastrados pela interface; não são imóveis fixos no código.
6. Crie ou convide as demais contas no Supabase Auth. Em **Equipe e acessos**, atribua suas funções e propriedades autorizadas.
7. Em **Modelos de checklist**, use o catálogo para criar, editar, duplicar, visualizar ou remover modelos. Todos os itens ficam na mesma lista; escolha o tipo em **Opções**.
8. Crie uma **ordem de check-in**, informando unidade, hóspede, hóspedes e diárias. O checkout é criado automaticamente a partir do check-in. Uma tarefa simples usa somente os campos necessários.
9. Execute com a conta atribuída. Quantidades começam com o esperado; marque o item ou ajuste quantidade/condição para conferi-lo. Fotos ficam no campo único. O rascunho é salvo automaticamente; use **Enviar para aprovação** ao terminar.
10. Em **Aguardando aprovação**, um administrador ou gestor autorizado usa **Concluir revisão**. Com a migração 012, pode revisar também a própria execução. Itens, fotos, bloqueios e autoria continuam validados no servidor.

Os status operacionais exibidos são **Pendente**, **Aguardando aprovação** e **Concluída**. Etapas internas e histórico de correção continuam preservados. Veja [o fluxo de revisão](docs/REVISAO_E_EXECUCAO.md).

### Variáveis

| Variável                                | Onde                 | Uso                                                   |
| --------------------------------------- | -------------------- | ----------------------------------------------------- |
| `VITE_SUPABASE_URL`                     | frontend             | URL pública do projeto                                |
| `VITE_SUPABASE_ANON_KEY`                | frontend             | Chave pública anon, protegida por RLS                 |
| `SUPABASE_URL`                          | servidor             | Mesma URL                                             |
| `SUPABASE_ANON_KEY`                     | servidor             | Autenticação do usuário e API com RLS                 |
| `SUPABASE_SERVICE_ROLE_KEY`             | **somente servidor** | Verificar os bytes de imagens e processar a fila push |
| `VITE_VAPID_PUBLIC_KEY`                 | frontend, opcional   | Assinatura push do navegador                          |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | servidor, opcionais  | Entrega web push                                      |
| `VAPID_SUBJECT`                         | servidor, opcional   | Contato `mailto:` ou URL da operação                  |
| `CRON_SECRET`                           | servidor, opcional   | Autenticar o consumidor da fila                       |

Nunca use `VITE_` em chaves privadas. Nunca envie chaves por chat ou as versione. O build só injeta variáveis com prefixo `VITE_` no frontend. A chave service_role é obrigatória para confirmar fotografias pelo endpoint seguro; sem ela, a API retorna erro de configuração e nenhuma conclusão com foto obrigatória é liberada.

## Vercel

1. Publique este diretório em um repositório privado e importe na sua conta Vercel.
2. Configure o preset Vite, `npm run build` e saída `dist`; `vercel.json` já contém os rewrites e cabeçalhos.
3. Cadastre as variáveis no ambiente correspondente (Preview e Production separados). Use projetos Supabase separados para homologação e produção.
4. Aplique as migrações no banco correto antes de liberar a versão que as utiliza.
5. Configure o domínio na Vercel e as URLs de autenticação no Supabase. Use HTTPS.
6. Valide `/api/health`, login, isolamento de acesso e um ciclo completo com duas contas de teste.

**Não foi feito deploy nem aplicada migração em um projeto remoto nesta entrega.** Nenhuma credencial Supabase/Vercel foi disponibilizada no ambiente.

## Push e fila persistente

As notificações internas já são inseridas na mesma transação das ações. A fila `event_outbox` permite entrega push adicional. Realtime é um mecanismo complementar, com consulta periódica como recuperação.

Gere as chaves VAPID com a biblioteca instalada, em seu terminal privado:

```powershell
node --input-type=module -e "import webpush from 'web-push'; console.log(webpush.generateVAPIDKeys())"
```

Cadastre as chaves nas variáveis apropriadas e habilite push em **Seu perfil**. A permissão depende do navegador e da plataforma. No iOS, a instalação na tela inicial pode ser necessária.

O endpoint `GET /api/notifications` exige `Authorization: Bearer <CRON_SECRET>`. Configure um agendador para chamá-lo. `vercel.cron.example.json` contém uma configuração de cinco em cinco minutos para incorporar a `vercel.json` **somente se seu plano suportar essa frequência**. O agendamento não é ativado automaticamente e não há processo permanente em memória.

O consumidor usa leases, limite de lote, até oito tentativas, backoff e registros de entrega por dispositivo. Uma interrupção depois de o provedor receber a mensagem pode causar reenvio; o `tag` permite agrupar avisos. Não existe garantia de entrega instantânea do sistema operacional. Push exibe mensagem genérica, sem dados de hóspedes na tela bloqueada. Monitore linhas `state='failed'` e reprocesse após corrigir a causa.

## PWA, offline e privacidade

- Manifest, ícones PNG 192/512 e service worker. Instalação depende do navegador.
- Cache de recursos estáticos e shell; APIs, fotos e respostas autenticadas não entram no cache HTTP.
- Snapshot mínimo das atividades atribuídas e rascunhos ficam em IndexedDB, separados pelo ID do usuário. Dados de hóspedes, auditoria e notificações não são copiados para esse snapshot.
- Respostas alteradas têm rascunho automático local. O usuário envia explicitamente o progresso e a conclusão ao servidor.
- Rascunho com revisão divergente não é reaplicado automaticamente. O servidor rejeita revisão antiga.
- Logout remove rascunhos e snapshots locais. Em dispositivos compartilhados, faça logout. IndexedDB não protege contra acesso ao perfil desbloqueado do sistema operacional.
- Fotografias exigem conexão. Não há fila offline de arquivos.
- A atualização do service worker aguarda o ciclo normal de abas; não força recarga durante uma execução. Para liberar alterações de política de cache, incremente `CACHE` em `public/sw.js`.

## Estrutura e documentação

```text
src/
  App.tsx              navegação, dashboard e execução
  components.tsx       diálogo acessível e formulários
  management.tsx       equipe, permissões e serviços
  features/             execução, configurador e relatórios
  domain.ts            tipos, filtros, progresso, CSV e datas
  lib/client.ts        Supabase, fotos e IndexedDB
  lib/push.ts          permissão e assinatura push
api/                    funções Node compatíveis com Vercel
supabase/migrations/    esquema, RLS e transações versionadas
tests/                  domínio e PostgreSQL/PGlite com papéis reais
public/                 manifest, service worker e ícones
docs/                   arquitetura, cobertura e pendências
```

Veja [arquitetura](docs/ARQUITETURA.md) e [cobertura e pendências](docs/IMPLEMENTACAO.md). Os testes usam PostgreSQL embarcado (PGlite) com esquemas mínimos de Auth/Storage; não substituem homologação do Supabase Auth, Storage HTTP, Realtime, Vercel ou push em dispositivos reais.

Para atualizar um banco já instalado, consulte [Edição, itens compartilhados e prévia](docs/ATUALIZACAO_CHECKLISTS.md). A migração `202610140005_shared_checklist_items.sql` habilita a edição dos padrões e o compartilhamento de itens com quantidade entre check-in e checkout.

A migração `202610140006_stay_agenda.sql` estabeleceu a agenda compartilhada por propriedade e a edição da saída. Ela é pré-requisito para a organização em ordens de serviço descrita abaixo. Veja [o guia da agenda](docs/AGENDA_CHECKOUT.md).

Com a migração `202610140007_work_orders.sql`, cada checklist é um **modelo** e cada ordem executa uma versão desse modelo ou uma tarefa simples. Criar uma ordem de check-in informa **diárias e hóspedes** e cria uma ordem de checkout vinculada. Alterar a saída move apenas o checkout, preservando o check-in concluído. Consulte [Modelos e ordens de serviço](docs/MODELOS_E_ORDENS.md) para ativar e usar o novo fluxo.

A interface prioriza celular, com checks circulares, itens e quantidades em linha e criação de ordens em quatro passos condicionais. A migração `202610150008_archive_checklists.sql` adiciona **remoção e restauração de modelos**, preservando o histórico e bloqueando novas execuções de modelos removidos. Veja [Interface mobile e remoção de modelos](docs/INTERFACE_MOBILE.md) para atualizar o Supabase.

A migração `202610150009_checkin_execution_windows.sql` simplifica a programação: escolhe-se só o modelo de check-in; a saída é derivada dos seus itens com quantidade. As ordens guardam o check-in de origem e usam faixas padrão de 13:30–15:00 na entrada e 11:30–12:30 na saída. O gestor pode ajustar o horário do checkout no dia da execução, inclusive já iniciado e antes da revisão. Aplique a 009 depois da 008, antes de publicar este frontend.

Modelos com nomes próprios e duplicação entre unidades: aplique uma vez `supabase/migrations/202610150010_named_checklist_models.sql` após a 009. Na criação de OS, escolha Check-in ou Tarefa; o modelo é escolhido dentro do Check-in. Consulte [Modelos e ordens](docs/MODELOS_E_ORDENS.md).

Execução simplificada, fotos gerais (até 8), envio com retomada e gestão de status/exclusão: aplique uma vez `supabase/migrations/202610150011_execution_and_order_management.sql` após a 010. Publique o frontend e a API de evidências juntos. Detalhes em [Modelos e ordens](docs/MODELOS_E_ORDENS.md).

Para ativar a aprovação da própria execução por gestores, aplique uma vez `supabase/migrations/202610150012_manager_review.sql`, depois da 011. A migração não foi aplicada no projeto remoto nesta entrega.
