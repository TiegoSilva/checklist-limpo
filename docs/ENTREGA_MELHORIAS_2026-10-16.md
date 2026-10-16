# Entrega das melhorias — 16/10/2026

O código implementa as melhorias da avaliação e os ajustes adicionais solicitados. A ativação no Supabase remoto e a homologação em aparelhos físicos ainda precisam ser realizadas. Nenhuma migração remota, alteração de plano ou envio real de convite foi feito nesta sessão.

## O que mudou

| Proposta | Implementação                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01      | Agenda e ordens na mesma tela, com lista, calendário, filtros e recorte Meu dia; dashboard concentrado no dia.                                                                                      |
| P02      | Relatórios e CSV incluem tarefas simples e checklists, sem contar duas vezes a ordem vinculada à execução.                                                                                          |
| P03      | Consultas operacionais paginadas no servidor, filtro por propriedade e período; histórico completo carregado quando solicitado.                                                                     |
| P04      | Itens conformes compactos, detalhes recolhidos, navegação para o próximo item obrigatório não conferido e indicação contextual das pendências.                                                      |
| P05      | Testes e inspeção visual locais realizados. Homologação publicada com gestor, executor e aparelhos reais **pendente**.                                                                              |
| P06      | Comparação do inventário atual com itens importados no modelo; atualização explícita da referência no rascunho. Modelos publicados e ordens existentes preservam sua versão.                        |
| P07      | Ajuste de quantidades em lote e cópia de itens faltantes entre unidades, com validação de permissões e prevenção de duplicidade.                                                                    |
| P08      | Edição de propriedades e unidades com controle de revisão para evitar sobrescrever alterações concorrentes.                                                                                         |
| P09      | Convite da equipe pelo aplicativo, com função, organização e escopo; opção de acesso por link e definição de senha na conta. Depende do e-mail do Supabase configurado.                             |
| P10      | Busca sem acentos e com múltiplos termos nos fluxos operacionais; filtros compartilhados entre lista e calendário.                                                                                  |
| P11      | Componentes e estilos compartilhados para os fluxos administrativos novos e os controles de evidências; espaçamento e controles adequados ao celular. O CSS legado não foi integralmente reescrito. |
| P12      | Upload retomável, progresso por arquivo, confirmação de recebimento e nova tentativa sem reenviar arquivos já confirmados.                                                                          |
| P13      | Indicadores de divergências aprovadas recorrentes por unidade e item, com período e critérios explicitados.                                                                                         |

### Ajustes adicionais

- Notificações são marcadas como lidas após dois segundos com a central visível. Sair da tela ou ocultar a aba interrompe a contagem; abrir outro modal não conta como leitura da central.
- Novos checkouts e reagendamentos usam **12:00–12:30**. Os campos de horário da saída foram removidos; o gestor continua podendo alterar a data. Não foi feita alteração em massa dos horários históricos.
- Fotos aceitam até **25 MB** e vídeos até **200 MB**, com até oito evidências no checklist. O preview mostra nome, tamanho e progresso do arquivo.
- Erros identificam etapa, arquivo ou item e código de diagnóstico. A mensagem genérica da imagem não permite afirmar uma causa única; respostas inválidas da API, falhas de rede e limites de arquivo agora têm tratamento contextual.
- A vistoria só segue para aprovação depois de todos os arquivos selecionados terem upload e recibo confirmados. O banco mantém o registro dos envios esperados e também bloqueia os caminhos antigos de conclusão quando existem uploads pendentes.
- Falhas preservam o rascunho e os arquivos já confirmados. Se os arquivos locais de um envio anterior não estiverem mais no aparelho, a interface permite remover essas pendências e selecionar novamente os arquivos faltantes. Arquivos já recebidos não são apagados por essa ação.
- O overlay de erro permite retomar a vistoria; o de sucesso permite concluir a atividade na interface. O envio permanece sujeito à aprovação prevista no fluxo.

## Ativação na produção

1. Confira quais migrações já foram aplicadas. Com 001 a 014 presentes, execute **uma vez e nesta ordem** no SQL Editor do Supabase correto:
   - `supabase/migrations/202610160015_operational_improvements.sql`
   - `supabase/migrations/202610160016_team_invites.sql`
2. Verifique o **limite global de arquivos do Storage** e os buckets privados `evidence` e `service-evidence`. A migração ajusta os buckets, mas não pode elevar o limite global do projeto. Para aceitar vídeos de 200 MB, o limite global precisa permitir pelo menos esse tamanho. Segundo a [documentação do Supabase](https://supabase.com/docs/guides/storage/uploads/file-limits), o plano Free limita arquivos a 50 MB; confira o plano e a configuração antes de anunciar 200 MB como disponível na produção. Nenhuma contratação ou mudança de plano foi realizada.
3. Publique frontend e APIs da mesma revisão juntos na Vercel. Preserve as variáveis existentes: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. A chave de serviço permanece exclusiva do servidor.
4. Para convites, confira SMTP, modelos de e-mail, Site URL e URLs de redirecionamento permitidas no Supabase Auth. Teste o convite de uma conta nova e o acesso por link de uma conta existente. Veja a [referência oficial de convites](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).
5. Para notificações do aparelho, mantenha as chaves VAPID e o agendador de recuperação já descritos em [App e notificações](APP_E_NOTIFICACOES.md). Cada usuário instala e autoriza o app no próprio aparelho.

O upload usa o protocolo retomável TUS com blocos de 6 MB, conforme a [documentação do Storage](https://supabase.com/docs/guides/storage/uploads/resumable-uploads). O recebimento dos bytes e a confirmação da evidência são etapas distintas; a confirmação é obrigatória para enviar a vistoria.

## Verificação realizada e pendências

Resultado final: **176 testes aprovados em 13 arquivos**, com build de produção concluído com sucesso.

Os testes automatizados cobrem banco/RLS, paginação acima de mil registros, relatórios, notificações após dois segundos, evidências, recibos, retomada e convites com provedores simulados. A inspeção visual local usou os componentes reais com dados fictícios, incluindo agenda, modelos, edição em lote, checklist e progresso de upload.

As imagens abaixo são demonstrações locais, sem envio de arquivos ao servidor:

- [Vistoria compacta](screenshots/vistoria-compacta-2026-10-16.png)
- [Preview com tamanho e progresso simulado](screenshots/evidencia-progresso-2026-10-16.png)
- [Overlay de erro com arquivo e código de diagnóstico](screenshots/erro-evidencia-2026-10-16.png)

Antes de liberar para a equipe, valide no ambiente publicado:

- Criar check-in, conferir checkout vinculado às 12:00–12:30 e alterar sua data.
- Executar como colaborador; enviar para aprovação; revisar como gestor, incluindo a própria execução.
- Selecionar fotos e vídeos, testar arquivo grande, interromper a conexão e retomar. Confirmar que não há conclusão com upload ou recibo pendente.
- Conferir mensagens de erro, permanência das respostas e ausência de duplicação ao repetir o envio.
- Abrir notificações por menos e por mais de dois segundos; repetir com a aba oculta.
- Testar convite, login, escopos da equipe, instalação e entrega real de push em Android e iPhone.
- Comparar o relatório com as ordens reais do período e conferir a exportação CSV.

Os testes locais usam PostgreSQL embarcado e serviços simulados. Eles não confirmam a configuração remota de Auth, Storage, SMTP, Vercel ou notificações do sistema operacional.
