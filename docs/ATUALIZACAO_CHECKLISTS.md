# Edição, itens compartilhados e prévia

## Ativar em um Supabase existente

Depois de ter aplicado as migrações 001 a 004, execute **somente** `supabase/migrations/202610140005_shared_checklist_items.sql` no SQL Editor, uma vez. Não reaplique as anteriores. Em um projeto novo, aplique todas as migrações, na ordem dos nomes. A agenda e o checkout automático também exigem a migração 006: veja [o guia da agenda](AGENDA_CHECKOUT.md).

Esta atualização cria a publicação transacional com controle de concorrência, vincula os itens com quantidade e reconcilia os padrões já cadastrados em novas versões. A autoria dessas versões automáticas aparece como **Sistema** na auditoria. Em caso de nomes iguais no mesmo ambiente, o padrão de check-in prevalece; itens exclusivos do checkout são preservados e passam a ser compartilhados. Tarefas simples e conferências técnicas continuam exclusivas de cada tipo.

As versões antigas, atividades já criadas, evidências e respostas não são alteradas. Atividades abertas continuam com o snapshot original; as alterações de configuração passam a valer para as próximas atividades. Caso a migração ainda não esteja aplicada, o novo editor apresenta erro de atualização pendente e não anuncia salvamento bem-sucedido.

## Usar

1. Entre com uma conta administrativa ou gerencial autorizada e abra **Configurar checklists**.
2. Use **Editar checklist** no padrão desejado. A lista principal mostra a última versão de cada tipo por unidade.
3. Em **Itens e quantidades**, informe o nome e ajuste o valor pelos botões `−` e `+`. O campo também aceita digitação. O ambiente padrão é Geral; ambiente, fotos, ocupação e outras regras ficam em **Opções**.
4. Cadastre tarefas de limpeza na seção separada. Elas não são copiadas para a vistoria de checkout.
5. Use **Ver prévia** para experimentar o checklist antes de salvar. Escolha a ocupação para conferir as quantidades e tarefas aplicáveis. Marcar itens ou alterar respostas nessa prévia não grava nada.
6. Clique em **Salvar alterações**. O banco cria uma nova versão do padrão editado e, quando necessário, outra do checklist vinculado, na mesma transação. Nome, quantidade, faixa de ocupação e demais opções dos itens com quantidade permanecem alinhados.
7. Use **Versões anteriores** para consultar a prévia dos padrões históricos.

É possível editar os itens com quantidade por qualquer um dos dois checklists. Alterações e remoções se refletem no outro; tarefas exclusivas são preservadas. Para evitar apagar a edição de outra pessoa, salvar uma versão desatualizada é bloqueado e exige reabrir o editor. O sistema também impede deixar vazio um checklist vinculado já publicado.

Na operação, a vistoria de checkout usa a quantidade de hóspedes da estadia encerrada. A preparação de check-in usa a próxima reserva ou o padrão-base. Por exemplo, uma regra de uma toalha por pessoa espera quatro na saída de quatro hóspedes e prepara duas para a próxima ocupação de duas pessoas.

O cadastro de inventário também usa nome e seletor de quantidade, com ambiente e categoria opcionais. Para levar esse cadastro aos padrões, utilize **Importar inventário** no editor; itens com o mesmo nome e ambiente não são importados novamente.

## Verificação

Os testes locais cobrem criação do checklist vinculado, edição e exclusão em ambos os sentidos, preservação de tarefas e snapshots, quantidades por ocupação, conflitos de edição, acesso indevido e reconciliação de padrões antigos. Testes de interface cobrem ações de edição, prévia e seletores. A integração HTTP com um Supabase de produção continua dependendo da configuração externa e da aplicação desta migração.
