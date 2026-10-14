# Check-in, checkout automático e agenda

## Ativar no Supabase

Em um banco com as migrações 001 a 005 aplicadas, execute uma vez `supabase/migrations/202610140006_stay_agenda.sql` no SQL Editor. Em uma instalação nova, aplique todas as seis na ordem dos nomes. Não reaplique migrações anteriores.

A migração ainda precisa ser aplicada no projeto remoto. O código apresenta uma mensagem de atualização pendente quando o banco não tem os novos endpoints ou a agenda.

## Operação

1. Publique os checklists e cadastre colaboradores com as funções Vistoria e Limpeza e acesso à propriedade.
2. Clique em **Registrar check-in**. Informe unidade, hóspede, quantidade, entrada, saída e responsáveis.
3. O mesmo registro cria a hospedagem, seu ciclo e duas tarefas pendentes: vistoria e limpeza, programadas para a saída. Repetir o envio com o mesmo identificador não duplica tarefas. Cadastrar uma saída futura não altera o estado operacional atual da unidade.
4. A **Agenda da equipe**, na visão geral, em Meu dia e em Atividades, mostra entradas e saídas para todos os colaboradores autorizados na propriedade. As tarefas pessoais continuam no Meu dia. Nomes de hóspedes e respostas dos checklists não são expostos pela agenda compartilhada.
5. Para estender ou antecipar a estadia, o gestor usa **Editar saída**, informa a data, o horário e o motivo. As mesmas tarefas acompanham a alteração; os responsáveis e versões dos checklists são preservados. A equipe recebe uma notificação e a agenda é atualizada por Realtime, além da atualização periódica do portal.

Datas usam o fuso America/Sao_Paulo, com persistência dos prazos em UTC. O sistema impede sobreposição de hospedagens, saída anterior à entrada, edição de versão desatualizada e execução antecipada de tarefas futuras. Depois que a execução começa, a saída fica bloqueada para preservar o histórico. As tarefas vinculadas à hospedagem não podem ter suas datas alteradas isoladamente.

A vistoria usa a ocupação da hospedagem encerrada. A limpeza usa a próxima reserva ou a ocupação-base; novas entradas e mudanças de saída recalculam apenas limpezas programadas que ainda não começaram, usando sua versão original do checklist. O fluxo anterior de preparação complementar permanece disponível.

Reservas anteriores à migração aparecem na agenda como **Reserva anterior**. Elas não recebem responsáveis ou tarefas retroativos automaticamente, pois esses dados não existiam. O checkout automático vale para registros feitos pelo novo fluxo.

## Interface e validação

Os itens com quantidade são apresentados em linhas com nome e seletores de menos/mais. No editor, regras adicionais ficam em **Opções**. Na execução, fotos e observações ficam recolhidas; quantidade, condição e confirmação continuam explícitas.

Os testes PostgreSQL verificam criação automática e idempotência, acesso por propriedade, privacidade da agenda, notificações, prorrogação e antecipação sem duplicação, concorrência, sobreposição e preservação das execuções iniciadas. A integração com Supabase Auth, Realtime e Vercel em produção depende da configuração e da migração no projeto remoto.
