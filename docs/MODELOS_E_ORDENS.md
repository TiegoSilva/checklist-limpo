# Modelos e ordens de serviço

## Estrutura

Um **modelo de checklist** é a configuração reutilizável de itens, tarefas, quantidades e regras. Publicar uma alteração cria uma versão. Uma **ordem de serviço** é uma execução concreta, com unidade, responsável, data e revisão. Cada ordem tem um destes formatos:

- **Checklist:** utiliza a versão escolhida de um modelo, copiada para a execução. Editar o modelo depois não altera essa ordem nem suas respostas.
- **Tarefa simples:** tem título e instruções, descrição do trabalho realizado, evidência fotográfica e revisão do gestor.

Os modelos atuais são configurados por unidade para check-in e checkout. Seus itens com quantidade permanecem compartilhados, conforme a migração 005. Também podem ser escolhidos para outras ordens da mesma unidade. Os modelos não executam operações por si mesmos.

## Hospedagem

Em **Nova ordem de serviço**, escolha **Check-in com checkout automático**. Informe a unidade, o formato de execução, o responsável pelo check-in, o hóspede, a entrada, a duração em diárias e a quantidade de hóspedes. Na mesma tela escolha o formato, o modelo quando aplicável e o responsável do checkout. A saída é calculada automaticamente: entrada + diárias. Os horários padrão são 14h na entrada e 12h na saída, editáveis em **Horários**.

Uma única transação cria a hospedagem e **duas ordens vinculadas**:

1. Check-in, para execução na data de entrada.
2. Checkout, para execução na data de saída.

Os dois formatos podem ser diferentes. Por exemplo: um checklist na entrada e uma tarefa simples na saída. Se ambos forem checklists, cada ordem terá sua própria execução e seu próprio modelo. As quantidades por hóspede usam a ocupação desta hospedagem em ambas as ordens. Repetir o envio com o mesmo identificador não duplica ordens.

A agenda continua compartilhada com todos os colaboradores autorizados na propriedade, sem expor nomes de hóspedes ou respostas de execução. As ordens com checklist e as tarefas simples aparecem no Meu dia e na agenda de execução; a página Ordens de serviço centraliza ambas. Todas passam por revisão, com aprovação por outro gestor autorizado.

## Prorrogar ou antecipar a saída

O gestor usa **Editar saída** na agenda, informando a nova data, o horário e o motivo. A duração exibida é recalculada. A alteração move **somente a ordem de checkout** e sua execução; a ordem de check-in, inclusive quando já concluída, é preservada.

O sistema bloqueia datas sobrepostas, duração inválida, ocupação acima da capacidade, modelos de outra unidade ou tipo incompatível, responsáveis sem acesso/função, edição concorrente e alteração de um checkout já iniciado. Ordens de hospedagem não podem ter a data alterada ou ser canceladas isoladamente pela execução do checklist. A execução de uma ordem futura só fica disponível no dia programado.

## Atualização do Supabase

Se as migrações 001 a 006 já foram aplicadas, execute uma vez `supabase/migrations/202610140007_work_orders.sql` no SQL Editor. Se a 006 ainda estiver pendente, execute primeiro a 006 e depois a 007. Em projeto novo, aplique todas na ordem dos nomes. Não reaplique migrações anteriores.

A migração preserva ordens, atividades e auditorias antigas. As ordens existentes continuam como tarefas simples; os fluxos anteriores de reservas/atividades permanecem disponíveis para compatibilidade. Não são fabricadas ordens retroativas ou alteradas datas antigas. A nova organização vale para ordens criadas pelo novo formulário.

Não foi aplicada migração no projeto remoto nesta entrega. A integração real com Supabase Auth, Storage, Realtime e Vercel depende da configuração externa. Os testes locais executam as funções e políticas reais em PostgreSQL e verificam os dois formatos, os vínculos, as quantidades, as versões, os cálculos de calendário, a revisão e a edição da saída após concluir o check-in.
