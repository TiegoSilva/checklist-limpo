# Revisão e execução simplificadas

## Ativar a revisão própria no Supabase

Com as migrações 001 a 011 já aplicadas, execute uma única vez o arquivo `supabase/migrations/202610150012_manager_review.sql` no SQL Editor do projeto correto, antes de publicar o frontend. Em uma instalação nova, aplique todos os arquivos na ordem. Não reaplique as migrações anteriores.

A 012 remove apenas a restrição de autoria das rotas de revisão já existentes. Administradores e gestores precisam continuar autorizados na unidade. Permanecem as conferências obrigatórias, fotos, observações de divergência, controle de revisão, bloqueios impeditivos, snapshots e auditoria com executor e revisor. Funções internas continuam privadas. Não há alteração de credenciais, funções de equipe ou permissões de propriedade.

Nenhuma migração foi aplicada no Supabase remoto por esta entrega. Nenhuma publicação na Vercel foi confirmada.

## Operação

- O status mostrado nas ordens, agenda, indicadores e gestão usa **Pendente**, **Aguardando aprovação** e **Concluída**. Execução iniciada e correção são etapas internas de uma ordem pendente; seus registros permanecem preservados. Ordens antigas canceladas ficam recolhidas no histórico, fora da lista ativa.
- Em **Aguardando aprovação**, abra a execução e use **Concluir revisão** no rodapé fixo. Gestores podem revisar a própria execução. Colaboradores acompanham o envio sem ação de aprovação.
- **Solicitar correção** abre itens e justificativa na área rolável. Durante a correção, a ação de aprovar fica oculta. Cancelar a correção permite voltar à revisão.
- Hóspedes, diárias e progresso permanecem no topo durante o preenchimento. Detalhes complementares ficam recolhidos; as ações administrativas ficam ao final.
- Marcar o check confirma a quantidade esperada. Ajustar quantidade, condição ou conferência técnica confirma o item. É possível desmarcar depois. A divergência continua automática.
- Problemas abrem a observação, antes dos campos opcionais de reposição. O envio aponta o primeiro item pendente, observa limites de quantidade, exige justificativa e foto quando configuradas, antes de iniciar o envio ao servidor.
- Rascunho automático e **Salvar Rascunho** mantêm as respostas no dispositivo sem interromper com confirmação adicional. Envio e revisão confirmados usam a mensagem central no modal; erro permite retomar.
- Tarefas usam ações diretas, sem seletor de próxima ação nem campos de justificativa desnecessários.
- A página de modelos mantém apenas o catálogo final, com suas ações de criação, edição, duplicação e prévia.

## Validação

124 testes automatizados, incluindo PostgreSQL local com todas as migrações e RLS: revisão própria por gestor, impedimento a colaborador sem função gerencial, auditoria, concorrência, fotos, correção, snapshots e retomada de envio. Build de produção validado.

Conferência visual em 320 e 390 px e desktop de 1280 px, com componentes reais e dados fictícios, sem gravações remotas. Aprovação, correção, sucesso e erro foram simulados na prévia; o comportamento transacional foi validado separadamente no PostgreSQL local. Capturas em `docs/screenshots/*v4.png`.
