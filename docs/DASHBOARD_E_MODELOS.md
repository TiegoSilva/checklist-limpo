# Dashboard, aprovação e lista única de modelos

O dashboard começa pelas ordens de check-in e checkout programadas para hoje, por horário de início e no fuso de São Paulo. O bloco respeita os filtros de propriedade e busca, inclui ordens em aprovação ou já concluídas no dia e omite ordens canceladas ou removidas. Ele não muda ao escolher um período diferente para os demais indicadores.

A fila **Aguardando aprovação** inclui os envios do próprio usuário e da equipe aos quais ele tem acesso, inclusive de dias anteriores. As execuções de checklist aparecem uma única vez. Envios próprios abrem em **Ver envio**; a aprovação continua exigindo outro gestor autorizado no servidor. Colaboradores também têm acesso à página para acompanhar seus envios, respeitando as permissões do Supabase.

No modelo, itens com quantidade, tarefas e conferências ficam na mesma lista, com um único botão **Adicionar item**. O tipo fica em **Opções → Tipo de conferência**. A edição preserva tarefas existentes e permite mover os itens pela lista inteira. O checkout continua derivando apenas os itens com quantidade do check-in.

Os cartões de ordens usam colunas flexíveis e status abaixo do texto no celular. O formulário tem conteúdo rolável e navegação no rodapé; revisão, campos de data e opções de tipo se adaptam à largura disponível.

Validação: 110 testes passaram, incluindo regressão de envios próprios, exclusão de removidos, ausência de duplicação, fuso horário, filtros e preservação dos três tipos de item. Build de produção concluído. Conferência visual local com componentes reais e dados fictícios: 320 px, 390 px e desktop de 1280 px, fluxos de check-in e tarefa, sem gravação no servidor. Capturas em `docs/screenshots/*mobile-v3.png`, `modelo-lista-unica-mobile.png` e `dashboard-prioridade-dia-mobile.png`.

Esta atualização altera apenas o frontend e o cache da aplicação. Não exige nova migração, além das migrações anteriores já necessárias ao projeto. A publicação autenticada na Vercel e os dados reais do Supabase não foram homologados nesta conferência local.
