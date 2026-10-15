# Cobertura da implementação

Esta entrega é uma implementação inicial funcional dos fluxos centrais, com integração real preparada. **Não equivale à conclusão integral das seis fases do briefing nem à homologação de produção.** Sem projeto Supabase configurado, não há operação remota ativa. Visitantes veem somente a tela de login; o portal e suas consultas são montados apenas com sessão autenticada. Não há preview público do portal.

## Fases

| Fase | Implementado | Verificação | Pendências |
| --- | --- | --- | --- |
| 1 — Fundação | React/Vite/TS, Auth por senha, organização, propriedades/unidades/ambientes, múltiplas funções, acesso por propriedade, RLS e auditoria básica | Build e testes PostgreSQL | Aplicar migrações e validar Auth real; convites e recuperação ainda feitos no painel Supabase; cadastro é inicial, edição administrativa completa não foi construída |
| 2 — Checklists e inventário | Dois tipos de checklist, criação/publicação de versões, cópia de versões, reordenação, inventário por ambiente, contagem explícita, enxoval, ocupação condicional, fotos privadas e referência | Testes de banco e domínio | Herança entre unidades/empreendimentos, interface de movimentação histórica de inventário, miniaturas e comparação lado a lado |
| 3 — Operação | Checkout idempotente, duas atividades por ciclo, Meu dia, agenda, atribuição, programação, cancelamento, correções por item, aprovação independente, bloqueios e preparação complementar | Testes de banco e filtros; inspeção da interface | Homologação com duas contas e dados reais, indicadores detalhados por checkout e períodos avançados |
| 4 — Serviços e comunicação | Serviços com responsável, revisão e fotografia; ocorrências; central persistente; Realtime com consulta periódica; push, fila, lease, backoff e histórico de entrega | Testes de banco da fila, notificações e serviços | Configurar VAPID e agendador; testar entrega em Android/iOS/desktop; alerta automático de atrasos ainda não implementado; cancelamento e reatribuição de serviços não expostos |
| 5 — PWA e acessibilidade | Manifest, ícones, shell/static cache, snapshot mínimo e rascunhos IndexedDB, conflitos por revisão, fonte 100–200%, foco, labels, teclado e movimento reduzido | Inspeção no navegador em celular com 200%, sem transbordamento na tela de preferências | Homologar offline real em dispositivos, testes automáticos IndexedDB e auditoria WCAG completa; arquivos não são enfileirados offline |
| 6 — Relatórios e produção | Filtros por período/unidade/colaborador/tipo, execução separada de aprovação, médias, CSV, PDF via impressão, exportação de auditoria, configuração Vercel e documentação | Build, testes de domínio e PostgreSQL | Relatórios de perdas/recorrência e tempos de ciclo completos, paginação além de 1.000 registros, backups testados, monitoramento e deploy |

## Testes automatizados

`npm test` executa Vitest e um PostgreSQL embarcado com PGlite. O teste carrega **todas as migrações**, cria usuários de teste e alterna os papéis `anon`, `authenticated` e `service_role`. Schemas mínimos de `auth` e `storage` são substitutos locais; funções e políticas do domínio são as migrações reais.

Cobertura atual:

- Bloqueio de usuário anônimo e isolamento entre propriedades.
- Proibição de alteração direta de tabelas e auditoria por usuários operacionais.
- Checkout cria duas atividades e não duplica evento repetido.
- Filtro de tarefas por ocupação e preparação complementar com somente diferenças.
- Quantidade preenchida não equivale a conferência explícita.
- Submissão exige itens conferidos e evidências.
- Recebimento da fotografia exige existência do objeto; recibos são imutáveis para usuários.
- Conflito de revisão impede sobrescrita.
- Após a migração 012, administrador/gestor autorizado pode aprovar a própria execução. Executor sem função de gestão continua impedido.
- Reprovação exige motivo e itens, mantém snapshot e exige nova foto dos itens corrigidos.
- Ocorrência impeditiva bloqueia aprovação; resolução exige gestor e motivo.
- Notificações e outbox persistem em transação.
- Fila push não pode ser reivindicada pelo navegador; endpoints de provedores não autorizados são rejeitados.
- Ordem de serviço exige foto, texto e outro aprovador.
- Auditoria registra ator e horário do banco.
- Ordenação diária, datas de São Paulo e exportação CSV com proteção contra fórmulas.
- Tela exclusiva de login sem sessão, inclusive em links internos, durante a restauração do acesso e em caso de falha de sessão. Consultas operacionais não são iniciadas na tela pública.

**Não validados automaticamente:** Supabase Auth HTTP, upload/download HTTP com Storage real, cálculo do hash pela API em integração, Realtime, assinatura/entrega push real, sessão offline e recuperação IndexedDB em navegador, acessibilidade completa e deploy Vercel. Não considerar esses itens homologados por causa dos testes locais.

## Como verificar visualmente

1. Execute `npm run dev` e abra a URL local.
2. Sem sessão, confira que a página inicial e links internos mostram somente login, sem menu ou dashboard. Sem configuração do Supabase, o acesso fica indisponível. Depois de configurar e autenticar, o portal deve aparecer; ao sair, a tela deve retornar ao login.
3. Em Preferências, escolha 200% e reduza o viewport para um celular. Os textos devem quebrar linha sem sobreposição. O menu recolhido não deve receber foco de teclado.
4. Conecte um ambiente de homologação, configure duas contas e siga os dez passos do README.
5. Tente aprovar a própria atividade, concluir sem fotografia, enviar uma revisão antiga e acessar uma propriedade não autorizada. Todas essas tentativas devem falhar no servidor, mesmo fora da interface.
6. Reprove um item, corrija com nova fotografia e confirme que a primeira submissão continua disponível no histórico.
7. Após liberação, confirme reserva com outra ocupação e confira a atividade complementar.
8. Teste instalação, perda de conexão, recuperação do rascunho e retomada com o servidor. A conclusão oficial nunca deve ocorrer offline.

## Próxima etapa externa

Configurar as variáveis de um projeto Supabase de homologação, aplicar as sete migrações e executar o roteiro de ponta a ponta. Para um banco com as quatro primeiras já aplicadas, execute as migrações 005 e 006, conforme [o guia de checklists](ATUALIZACAO_CHECKLISTS.md) e [o guia da agenda](AGENDA_CHECKOUT.md). A migração 007 organiza [modelos e ordens de serviço](MODELOS_E_ORDENS.md), com diárias, hóspedes e checkout vinculado. Depois configurar Vercel, domínio, VAPID e agendamento. Nenhuma chave deve ser colocada no repositório ou enviada em mensagens.
