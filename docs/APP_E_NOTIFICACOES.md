# Instalação, vídeos e notificações no aparelho

## Ativar na produção

1. Com as migrações 001 a 012 aplicadas, execute **uma vez** `supabase/migrations/202610160013_video_and_device_push.sql` no SQL Editor do projeto correto. Não reaplique as anteriores. A migração mantém os buckets privados, adiciona os metadados de vídeo e a fila de envio por organização.
2. Confira na Vercel as variáveis Supabase já utilizadas: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Para push, configure `VITE_VAPID_PUBLIC_KEY` e `VAPID_PUBLIC_KEY` com a **mesma chave pública**, `VAPID_PRIVATE_KEY` somente no servidor e `VAPID_SUBJECT` com um endereço `mailto:` válido da operação. Preserve as chaves existentes para manter os aparelhos vinculados.
4. Se ainda não há chaves, gere um único par no seu terminal privado com `node --input-type=module -e "import webpush from 'web-push'; console.log(webpush.generateVAPIDKeys())"`. Copie os valores para as variáveis da hospedagem. Não versione nem envie a chave privada em mensagens.
5. Publique frontend e APIs juntos. Variáveis com prefixo `VITE_` exigem novo build. `/api/health` informa `pushConfigured` sem expor credenciais. Essa verificação de presença não substitui o envio de teste.
6. Entre no aparelho e abra **App no aparelho** no menu. Instale, abra pelo ícone e toque em **Ativar notificações**. Autorize o pedido do navegador e use **Enviar teste**. O app confirma a aceitação pelo provedor; confira a chegada no aparelho e as opções de Foco/som do sistema.

Nenhuma configuração ou migração remota foi aplicada nesta entrega. A instalação e a autorização de notificações devem ser feitas pelo usuário no próprio aparelho.

## Instalar

O botão abre a confirmação de instalação quando o navegador disponibiliza essa função. Caso contrário, apresenta instruções para o sistema detectado. O app detecta quando está aberto em modo instalado. Os ícones PNG, manifesto, ícone Apple e rotas da Vercel estão preparados para a instalação.

No iPhone/iPad, abra no Safari, use **Compartilhar → Adicionar à Tela de Início**, confirme e entre pelo ícone. Web Push em iOS/iPadOS exige app na tela inicial e versão compatível (16.4 ou posterior), com solicitação de permissão a partir do toque do usuário. Fontes oficiais: [WebKit sobre Web Push no iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) e [MDN sobre instalação](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt).

## Notificações

A tela distingue permissão bloqueada, navegador sem suporte, necessidade de instalar, configuração de entrega pendente e aparelho vinculado. O pedido de permissão acontece somente ao tocar em ativar. É possível conferir novamente após mudar as configurações do aparelho, desativar os avisos e enviar um teste à assinatura do aparelho atual. Ao sair da conta, a inscrição local é removida.

As ações confirmadas pela aplicação despertam a fila no servidor, com uma nova tentativa após 16 segundos para cobrir ações próximas. A função privada reivindica apenas avisos das organizações do usuário autenticado, com intervalo mínimo de 15 segundos por usuário. O envio segue a concessão e os recibos de entrega existentes. O toque no aviso foca o app; um checklist ou formulário aberto não é descartado para abrir a central.

**Mantenha um agendador de recuperação** para falhas de rede, abas fechadas antes da tentativa e eventos criados fora da interface: `GET /api/notifications` com `Authorization: Bearer <CRON_SECRET>`. A configuração de exemplo `vercel.cron.example.json` continua disponível; a frequência deve ser compatível com o plano Vercel. Esta atualização não ativa um serviço de agendamento remoto nem muda seu plano. Não prometa entrega imediata quando nenhum consumidor da fila estiver configurado.

Os avisos na tela bloqueada continuam genéricos, sem nomes de hóspedes ou dados da propriedade. O endpoint de teste só aceita uma assinatura ativa vinculada ao usuário autenticado.

## Checklist e vídeos

Antes do início, o checklist fica coberto, sem interação por toque ou teclado. O botão **Iniciar ordem de serviço** fica na cobertura. Os campos são liberados apenas após a confirmação da ação pelo servidor. Ordens futuras informam o dia disponível e ordens de outra pessoa identificam o responsável.

Em **Evidências da vistoria**, use fotos ou vídeos. São até oito arquivos no total por envio: JPG/PNG/WebP de até 10 MB por foto ou MP4/MOV/WebM de até 50 MB por vídeo. Também há suporte a vídeo nas tarefas simples. O player permite reprodução no formulário; vídeos recebidos usam link privado temporário, com opção de abrir em outra janela se necessário. A reprodução depende do codec aceito pelo navegador.

O upload vai diretamente ao Storage privado. A API autenticada confere a assinatura do arquivo, tamanho e hash antes de registrar os metadados e o recibo. Só o servidor pode certificar essa evidência. Um vídeo recebido atende a exigência de evidência visual configurada no checklist. Respostas, IDs de arquivo e arquivos pendentes permanecem no rascunho para retomada; recibos confirmados não são reenviados.

## Verificação

139 testes passaram, incluindo banco PostgreSQL local com RLS: vídeo como evidência obrigatória, limites, recibos privados, preservação das regras anteriores, escopo da organização e limite de disparos. Testes de API usam provedores simulados para conferir autenticação, bytes do arquivo e assinatura pertencente ao usuário. Build de produção validado.

Conferência visual com dados fictícios em 320/390 px e desktop. O início foi simulado sem gravar no Supabase. Um vídeo WebM fictício gerado localmente abriu no player. Permissões nativas, instalação real e entrega push em aparelho físico ainda exigem homologação após configurar a hospedagem. Capturas: `checkout-inicio-bloqueado.png`, `evidencia-video-mobile.png` e `app-no-aparelho-mobile.png` em `docs/screenshots`.
