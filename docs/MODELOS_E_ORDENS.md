# Modelos e ordens de serviço

## Estrutura

Um **modelo de checklist** é a configuração reutilizável de itens, tarefas, quantidades e regras. Publicar uma alteração cria uma versão. Uma **ordem de serviço** é uma execução concreta, com unidade, responsável, data e revisão. Cada ordem tem um destes formatos:

- **Checklist:** utiliza a versão escolhida de um modelo, copiada para a execução. Editar o modelo depois não altera essa ordem nem suas respostas.
- **Tarefa simples:** tem título e instruções, descrição do trabalho realizado, evidência fotográfica e revisão do gestor.

Cada unidade pode ter vários modelos com nomes próprios. Em **Novo modelo**, informe um nome livre, como “Preparação rápida” ou “Preparação completa”, e cadastre os itens e tarefas. Ao editar, somente esse modelo recebe uma nova versão; ordens existentes continuam com a versão escolhida. Os modelos antigos mantêm seus nomes iniciais e podem ser renomeados.

Para copiar, use **Duplicar** no cartão ou **Começar a partir de** na criação. Escolha a **Unidade de destino**, ajuste o nome e os itens e salve. A cópia tem identidade e histórico próprios, preserva quantidades, regras, tarefas e fotos, e não substitui modelos do destino. As referências fotográficas são copiadas para o Storage da unidade de destino antes da publicação; é necessário acesso de gestão às duas unidades. Novos modelos alimentam o check-in; o checkout é derivado automaticamente dos itens de quantidade do modelo escolhido.

## Hospedagem

Em **Nova ordem de serviço**, o formulário segue quatro passos: **Tipo → Detalhes → Programação → Revisão**. Escolha **Check-in** ou **Tarefa**. Os campos mudam conforme a escolha; voltar a um passo mantém os dados preenchidos enquanto o formulário estiver aberto.

Para **Check-in** (opção selecionada por padrão), informe unidade, hóspede, entrada, diárias e quantidade de hóspedes. A saída é calculada automaticamente: entrada + diárias. Em Programação, escolha os responsáveis e **somente o modelo de check-in**. A conferência de checkout é gerada com os itens de quantidade da mesma versão escolhida, usando a ocupação da estadia. As tarefas exclusivas de limpeza ficam na entrada. Sem itens de quantidade aplicáveis, o checkout usa tarefa simples.

As faixas padrão são **13:30–15:00** para check-in e **11:30–12:30** para checkout, no fuso de São Paulo. Ambas podem ser alteradas ao criar. O início aparece na programação e o fim é o prazo da ordem. Confira o resumo e use **Criar as duas ordens**.

Para **Tarefa**, informe a unidade e o trabalho a realizar, depois responsável e prazo. Instruções, prioridade, bloqueio da unidade e vínculo com ocorrência ficam nas opções adicionais.

Uma única transação cria a hospedagem e **duas ordens vinculadas**:

1. Check-in, para execução na data de entrada.
2. Checkout, para execução na data de saída.

As duas ordens guardam o check-in de origem e têm respostas e revisões independentes. O checkout guarda a referência à versão de check-in usada para derivar sua lista. Alterar o modelo depois não muda as ordens já criadas. As quantidades por hóspede usam a ocupação desta hospedagem em ambas. Repetir o envio com o mesmo identificador não duplica ordens. Tarefas adicionais podem ser ligadas ao check-in da mesma unidade em **Prioridade e outras opções → Check-in de origem**.

A agenda continua compartilhada com todos os colaboradores autorizados na propriedade, sem expor nomes de hóspedes ou respostas de execução. As ordens com checklist e as tarefas simples aparecem no Meu dia e na agenda de execução; a página Ordens de serviço centraliza ambas. Todas passam por revisão, com aprovação por outro gestor autorizado.

## Prorrogar ou antecipar a saída

O gestor usa **Editar saída** na agenda, informando a nova data, o horário e o motivo. A duração exibida é recalculada. A alteração move **somente a ordem de checkout** e sua execução; a ordem de check-in, inclusive quando já concluída, é preservada.

O sistema bloqueia datas sobrepostas, duração inválida, ocupação acima da capacidade, modelos de outra unidade ou tipo incompatível, responsáveis sem acesso/função, edição concorrente e mudança de dia de um checkout já iniciado. No dia da execução, um gestor pode ajustar apenas a faixa de horário de um checkout iniciado, preservando respostas e evidências. Depois do envio à revisão, os horários ficam bloqueados. O ajuste está disponível na agenda e na própria ordem em **Alterar programação do checkout**. Ordens de hospedagem não podem ter a data alterada ou ser canceladas isoladamente pela execução do checklist. A execução de uma ordem futura só fica disponível no dia programado.

## Atualização do Supabase

Se as migrações 001 a 006 já foram aplicadas, execute uma vez `supabase/migrations/202610140007_work_orders.sql` no SQL Editor. Se a 006 ainda estiver pendente, execute primeiro a 006 e depois a 007. Em projeto novo, aplique todas na ordem dos nomes. Não reaplique migrações anteriores.

A migração preserva ordens, atividades e auditorias antigas. As ordens existentes continuam como tarefas simples; os fluxos anteriores de reservas/atividades permanecem disponíveis para compatibilidade. Não são fabricadas ordens retroativas ou alteradas datas antigas. A nova organização vale para ordens criadas pelo novo formulário.

Para remover e restaurar modelos, aplique também a migração 008 e consulte [a atualização de interface e remoção](INTERFACE_MOBILE.md).

Não foi aplicada migração no projeto remoto nesta entrega. A integração real com Supabase Auth, Storage, Realtime e Vercel depende da configuração externa. Os testes locais executam as funções e políticas reais em PostgreSQL e verificam os dois formatos, os vínculos, as quantidades, as versões, os cálculos de calendário, a revisão e a edição da saída após concluir o check-in.

A migração `202610150009_checkin_execution_windows.sql` ativa as faixas de execução, o checkout derivado e o vínculo de ordens adicionais. Aplique uma vez depois da 008. Ordens anteriores mantêm suas listas e seus prazos; a migração não reescreve execuções históricas.

A migração `202610150010_named_checklist_models.sql` permite vários modelos nomeados por unidade e cópias independentes. Execute uma vez após a 009, antes de usar o novo editor. Nenhuma migração remota foi aplicada automaticamente.

## Execução e gestão das ordens (migração 011)

O administrador ou gestor da unidade pode abrir **Gerenciar ordem de serviço** para alterar o status, informando o motivo. Pendente, em execução, em aprovação, aprovada, em correção e cancelada são as opções. Aprovação mantém a conferência das evidências e a exigência de outro gestor; não permite aprovar a própria execução. Reabrir uma ordem preserva a aprovação anterior e inicia uma nova tentativa com as respostas existentes.

**Excluir ordem** retira a ordem da operação e preserva respostas, fotos e auditoria. Excluir o check-in também exclui o checkout gerado com ele, liberando as datas dessa hospedagem. Tarefas adicionais não são excluídas junto. Em **Ordens de serviço → Ordens excluídas**, o gestor pode restaurar o mesmo par como pendente. A restauração é bloqueada se as datas já estiverem ocupadas por outra hospedagem.

Na conferência, as quantidades começam com o esperado e a condição **Conforme**, mas os checks continuam desmarcados até a conferência explícita. Marcar o check não exige alterar o contador, e alterar a quantidade mantém o check. As condições são **Conforme**, **Danificado** e **Quantidade divergente**; divergência acompanha automaticamente a contagem e volta a Conforme quando corrigida. Danos e divergências exigem observação.

As ações são **Salvar Rascunho** e **Enviar para aprovação**. O rascunho guarda as respostas e os arquivos das fotos neste dispositivo, por usuário e vistoria. O único campo **Fotos da vistoria** aceita câmera ou seleção de imagens, até 8 por tentativa, JPG/PNG/WebP de até 10 MB cada. Se o modelo exigir fotografia, uma foto geral da tentativa atende à exigência, sem enviar fotos separadas por tarefa. Correções exigem foto nova quando houver exigência fotográfica; fotos anteriores permanecem no histórico.

O envio confirma respostas, snapshot e status em uma transação. Fotos têm identificadores estáveis e recibos verificados pela API. Em caso de falha, o alerta aparece dentro da vistoria, respostas e arquivos permanecem no rascunho e o reenvio retoma as fotos pendentes. Após confirmação, aparece **Enviado para aprovação com sucesso!**. Uma falha de conexão depois de o servidor confirmar pode ser reenviada sem criar nova submissão.

Aplique `202610150011_execution_and_order_management.sql` uma vez, após a 010, antes de publicar este frontend e a API de evidências. As regras antigas permanecem para execuções históricas; o novo fluxo é ativado no envio pela nova interface. Nenhuma migração remota foi aplicada nesta entrega.

A execução exibe um resumo único com programação, hóspedes, estadia, modelo e responsável. Mensagens da execução aparecem sobre todo o modal: **Retomar vistoria** fecha o erro e retorna ao preenchimento preservado; **Concluir atividade** fecha a confirmação de envio. Esse botão encerra a tela, mantendo a atividade aguardando aprovação do gestor. Não há nova migração de banco para esse ajuste visual.
