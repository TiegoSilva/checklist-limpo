# Interface mobile e remoção de modelos

## Ativar no Supabase

Com as migrações 001 a 007 já aplicadas, execute uma vez o conteúdo de `supabase/migrations/202610150008_archive_checklists.sql` no SQL Editor do projeto correto. Em uma instalação nova, aplique todos os arquivos na ordem dos nomes. Não reaplique os anteriores. Esta entrega não aplicou SQL no projeto remoto.

A atualização adiciona os campos de arquivamento, a operação autorizada de remover/restaurar e uma proteção de banco para impedir novas execuções de modelos removidos. Não exige novas variáveis de ambiente. Publique o frontend correspondente depois da migração, usando a configuração existente da Vercel.

## Remover e restaurar

Em **Modelos de checklist**, use a lixeira do modelo e confirme **Remover modelo**. A remoção é recuperável: o modelo deixa as opções de novas ordens, mas as versões anteriores, ordens existentes, respostas e fotografias continuam preservadas. Ordens já criadas podem continuar sendo executadas e revisadas.

Use **Modelos removidos → Restaurar** para disponibilizá-lo novamente. Apenas gestores com acesso à unidade podem remover e restaurar. Se outra pessoa publicar uma nova versão durante a ação, atualize a lista antes de tentar novamente.

Check-in e checkout continuam compartilhando itens com quantidade. Remover um dos modelos não remove o outro. Editar o modelo ativo não restaura automaticamente o modelo removido. Criar um novo modelo do mesmo tipo publica uma nova versão ativa, mantendo o histórico arquivado.

## Uso no celular

- Ordens seguem **Tipo → Detalhes → Programação → Revisão**, com campos específicos para check-in, tarefa ou checklist e opções adicionais recolhidas.
- Check-in continua criando as duas ordens em uma única transação. A agenda compartilhada e a edição da saída pelo gestor permanecem disponíveis.
- Botões de avançar e voltar ficam acessíveis no rodapé do formulário; voltar preserva o preenchimento enquanto ele estiver aberto.
- Itens usam nome e quantidade na mesma linha, controles de toque maiores, checks circulares e mais espaço entre grupos. Fotos e observações ficam nas opções de cada item.
- A paleta usa fundos claros, texto escuro, cartões arredondados e destaque coral, com inspiração visual no Airbnb.

## Validação

Os testes de PostgreSQL local cobrem remoção/restauração, permissões, conflito de versão, bloqueio de novas ordens, continuidade de execuções existentes e compartilhamento sem restaurar modelos removidos. Os testes do formulário verificam os campos condicionais, cálculo de saída e montagem da ordem a partir do estado preservado entre passos.

A conferência visual usa componentes reais com dados fictícios e gravação remota desativada. Foram verificadas telas de 320 e 390 px, incluindo execução com check circular, edição em linha, confirmação de remoção e revisão de check-in. As capturas estão em `docs/screenshots/ordem-passos-mobile.png`, `ordem-revisao-mobile.png` e `checklist-mobile-v2.png`.

O teste local não substitui a homologação do fluxo autenticado no Supabase/Vercel nem a conferência do teclado em dispositivos físicos.
