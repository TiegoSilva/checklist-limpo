-- Permite a revisão da própria execução por administrador/gestor autorizado.
-- Atualiza somente as restrições de autoria das rotas existentes; todas as
-- validações de conteúdo, acesso à unidade, revisão e auditoria são preservadas.
do $migration$
declare signature text; definition text; updated text;
 author_guard text := ' or a.assignee=auth.uid() or exists(select 1 from audit_events where resource_id=a.id and actor=auth.uid() and event in(''activity.start'',''activity.save'',''activity.submit''))';
begin
 foreach signature in array array[
   'public.activity_action(uuid,integer,text,jsonb)',
   'public.activity_action_before_management(uuid,integer,text,jsonb)',
   'public.activity_action_legacy(uuid,integer,text,jsonb)'
 ] loop
   definition := pg_get_functiondef(signature::regprocedure);
   updated := replace(definition,author_guard,'');
   if updated=definition then raise exception 'Restrição de autoria não encontrada em %; migração interrompida',signature; end if;
   updated := replace(updated,'Autoaprovação proibida ou gestor não autorizado','Somente administrador ou gestor autorizado pode revisar');
   execute updated;
 end loop;
 signature := 'public.service_action_legacy(text,jsonb)';
 definition := pg_get_functiondef(signature::regprocedure);
 updated := replace(definition,' and can_unit(u,true) and s.assignee<>auth.uid() and s.status=''review''',' and can_unit(u,true) and s.status=''review''');
 if updated=definition then raise exception 'Restrição de autoria não encontrada em %',signature; end if;
 execute updated;
 signature := 'public.manage_work_order(uuid,integer,text,jsonb)';
 definition := pg_get_functiondef(signature::regprocedure);
 updated := replace(definition,'if target=''approved'' and (s.assignee=auth.uid() or exists(select 1 from audit_events where actor=auth.uid() and resource_id=a.id and event in(''activity.start'',''activity.save'',''activity.submit''))) then raise exception ''Autoaprovação proibida: outro gestor deve aprovar''; end if;','');
 if updated=definition then raise exception 'Restrição de autoria não encontrada em %',signature; end if;
 execute updated;
end $migration$;
notify pgrst,'reload schema';
