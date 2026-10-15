import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  CloudOff,
  FileClock,
  House,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
  AlertTriangle,
  LoaderCircle,
  SlidersHorizontal,
  Building2,
} from 'lucide-react';
import { configured, supabase, loadData, rpc, clearDrafts } from './lib/client';
import {
  emptyData,
  dateTime,
  dayKey,
  download,
  type Activity,
  type Service,
} from './domain';
import { Empty, Form, Modal, Badge } from './components';
import { enablePush, disablePush } from './lib/push';
import { MemberEditor, ServiceDetail } from './management';
import TemplateEditor from './features/TemplateEditor';
import ActivityDetail from './features/ActivityDetail';
import Reports from './features/Reports';
import LoginPage from './features/LoginPage';
import ChecklistCatalog from './features/ChecklistCatalog';
import ChecklistPreviewDialog from './features/ChecklistPreview';
import InventoryEditor from './features/InventoryEditor';
import StayAgenda from './features/StayAgenda';
import WorkOrderEditor from './features/WorkOrderEditor';
import { serviceWindow } from './features/OrderStayContext';
import { DeletedOrders } from './features/OrderManagement';

const navigation = [
  { path: '/', label: 'Visão geral', icon: LayoutDashboard },
  { path: '/meu-dia', label: 'Meu dia', icon: CalendarDays },
  { path: '/atividades', label: 'Agenda de execução', icon: ClipboardList },
  { path: '/aprovacoes', label: 'Aprovações', icon: ClipboardCheck },
  { path: '/propriedades', label: 'Propriedades', icon: House },
  { path: '/servicos', label: 'Ordens de serviço', icon: Wrench },
];
const management = [
  { path: '/inventario', label: 'Inventário', icon: ListChecks },
  { path: '/checklists', label: 'Modelos de checklist', icon: Settings2 },
  { path: '/equipe', label: 'Equipe e acessos', icon: Users },
  { path: '/relatorios', label: 'Relatórios', icon: ActivityIcon },
  { path: '/auditoria', label: 'Auditoria', icon: FileClock },
];
const isDone = (a: Activity) => ['completed', 'cancelled'].includes(a.status);
const today = () => dayKey(new Date());

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!configured);
  const [sessionError, setSessionError] = useState('');
  const qc = useQueryClient();

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    let authEventReceived = false;
    const unavailable =
      'Não foi possível verificar seu acesso. Entre novamente.';
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted || authEventReceived) return;
        setSession(error ? null : data.session);
        setSessionError(error ? unavailable : '');
        setReady(true);
      })
      .catch(() => {
        if (!mounted || authEventReceived) return;
        setSession(null);
        setSessionError(unavailable);
        setReady(true);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      authEventReceived = true;
      setSession(nextSession);
      setSessionError('');
      setReady(true);
      if (!nextSession) qc.clear();
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [qc]);

  // O portal e suas consultas só são montados depois de restaurar a sessão.
  if (!ready || !session)
    return <LoginPage loading={!ready} sessionError={sessionError} />;
  return <Portal key={session.user.id} session={session} />;
}

function Portal({ session }: { session: Session }) {
  const [sidebar, setSidebar] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [property, setProperty] = useState('');
  const [filter, setFilter] = useState('Hoje');
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState('');
  const [service, setService] = useState<Service | null>(null);
  const [calendar, setCalendar] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['operation', session?.user.id],
    queryFn: loadData,
    enabled: Boolean(session),
    refetchInterval: 60000,
  });
  const data = query.data ?? emptyData;
  const user = session?.user.id ?? '';
  const profile = data.profiles.find((p) => p.id === user);
  const memberships = data.memberships.filter((m) => m.user_id === user);
  const manager = memberships.some((m) =>
    m.roles.some((r) => r === 'admin' || r === 'manager'),
  );
  const admin = memberships.some((m) => m.roles.includes('admin'));
  useEffect(() => {
    if (
      session &&
      !query.isPending &&
      memberships.length > 0 &&
      !manager &&
      path === '/'
    )
      navigate('/meu-dia', { replace: true });
  }, [session, query.isPending, memberships.length, manager, path, navigate]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.style.fontSize = `${profile?.font_scale ?? Number(localStorage.getItem('aja-font') ?? 100)}%`;
  }, [profile?.font_scale]);
  useEffect(() => {
    if (!supabase || !user) return;
    const channel = supabase
      .channel(`operation-${user}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activities' },
        () => qc.invalidateQueries({ queryKey: ['operation'] }),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient=eq.${user}`,
        },
        () => qc.invalidateQueries({ queryKey: ['operation'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'units' },
        () => qc.invalidateQueries({ queryKey: ['operation'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_orders' },
        () => qc.invalidateQueries({ queryKey: ['operation'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agenda_changes' },
        () => qc.invalidateQueries({ queryKey: ['operation'] }),
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [user, qc]);
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(''), 5000);
      return () => clearTimeout(t);
    }
  }, [message]);
  const run = useCallback(
    async (
      fn: () => Promise<unknown>,
      success = 'Dados confirmados pelo servidor.',
    ) => {
      setBusy(true);
      setError('');
      try {
        await fn();
        await qc.invalidateQueries({ queryKey: ['operation'] });
        setMessage(success);
        return true;
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Não foi possível salvar. Tente novamente.',
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );
  const needSession = () => {
    if (!profile?.active) {
      setError(
        'Seu perfil está desativado. Entre em contato com o administrador.',
      );
      return false;
    }
    return true;
  };
  const open = (type: string) => {
    if (needSession()) setModal(type);
  };
  const unitName = (id: string) =>
    data.units.find((u) => u.id === id)?.name ?? 'Unidade';
  const propertyName = (unit: string) => {
    const u = data.units.find((u) => u.id === unit);
    return (
      data.properties.find((p) => p.id === u?.property_id)?.name ??
      'Empreendimento'
    );
  };
  const person = (id: string | null) =>
    id
      ? (data.profiles.find((p) => p.id === id)?.name ?? 'Colaborador')
      : 'Sistema';
  const visible = data.activities.filter(
    (a) =>
      (!property ||
        data.units.find((u) => u.id === a.unit_id)?.property_id === property) &&
      `${unitName(a.unit_id)} ${propertyName(a.unit_id)} ${a.title} ${person(a.assignee)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const inPeriod = (a: { status: string; due_at: string }) => {
    if (filter === 'Concluídas')
      return ['completed', 'approved'].includes(a.status);
    if (filter === 'Atrasadas')
      return (
        !['completed', 'approved', 'cancelled'].includes(a.status) &&
        new Date(a.due_at) < new Date()
      );
    const day = dayKey(new Date(a.due_at));
    const offset = filter === 'Amanhã' ? 1 : filter === 'Semana' ? 7 : 0;
    const end = new Date();
    end.setDate(end.getDate() + offset);
    return (
      (day >= today() && day <= dayKey(end)) ||
      (!['completed', 'approved', 'cancelled'].includes(a.status) &&
        day < today() &&
        filter === 'Hoje')
    );
  };
  const daily = visible.filter(inPeriod);
  const myActivities = daily.filter((a) => a.assignee === user);
  const approvals = visible.filter(
    (a) => a.status === 'review' && a.assignee !== user,
  );
  const taskOrders = data.service_orders.filter(
    (s) =>
      !s.deleted_at &&
      !s.activity_id &&
      (!property ||
        data.units.find((u) => u.id === s.unit_id)?.property_id === property) &&
      `${s.title} ${unitName(s.unit_id)} ${person(s.assignee)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const dailyTasks = taskOrders.filter(inPeriod);
  const taskApprovals = taskOrders.filter(
    (s) => s.status === 'review' && s.assignee !== user,
  );
  const active = selected
    ? data.activities.find((a) => a.id === selected)
    : null;
  const counts = {
    pending:
      visible.filter((a) => a.status === 'pending').length +
      taskOrders.filter((s) => s.status === 'assigned').length,
    progress:
      visible.filter((a) => a.status === 'in_progress').length +
      taskOrders.filter((s) => s.status === 'in_progress').length,
    review: approvals.length + taskApprovals.length,
    ready: data.units.filter(
      (u) =>
        (!property || u.property_id === property) &&
        u.operational_status === 'ready',
    ).length,
  };
  const notifications = data.notifications.filter((n) => !n.read_at).length;
  const options = {
    units: data.units.map((u) => ({
      value: u.id,
      label: `${propertyName(u.id)} · ${u.name}`,
    })),
    properties: data.properties.map((p) => ({ value: p.id, label: p.name })),
    people: data.profiles
      .filter((p) => p.active)
      .map((p) => ({ value: p.id, label: p.name })),
  };
  const headTitle =
    path === '/'
      ? 'Sua operação, em dia.'
      : path === '/meu-dia'
        ? 'Meu dia'
        : path === '/aprovacoes'
          ? 'Aguardando minha aprovação'
          : path === '/notificacoes'
            ? 'Notificações'
            : path === '/perfil'
              ? 'Seu perfil'
              : ([...navigation, ...management].find((n) => n.path === path)
                  ?.label ?? 'Página não encontrada');
  const actionLabel =
    path === '/propriedades'
      ? 'Novo empreendimento'
      : path === '/servicos'
        ? 'Nova ordem de serviço'
        : path === '/inventario'
          ? 'Novo item'
          : path === '/equipe'
            ? 'Adicionar colaborador'
            : path === '/checklists'
              ? 'Novo modelo'
              : 'Nova ordem de check-in';
  const actionModal =
    path === '/propriedades'
      ? 'property'
      : path === '/servicos'
        ? 'service'
        : path === '/inventario'
          ? 'inventory'
          : path === '/equipe'
            ? 'member'
            : path === '/checklists'
              ? 'template'
              : 'checkin';
  const activityCard = (a: Activity) => (
    <article key={a.id} className="activity-card">
      <div
        className={`activity-symbol ${a.kind === 'inspection' ? 'blue' : ''}`}
      >
        {a.kind === 'inspection' ? (
          <ClipboardCheck size={21} />
        ) : (
          <Sparkles size={21} />
        )}
      </div>
      <div className="activity-content">
        <div className="card-eyebrow">{propertyName(a.unit_id)}</div>
        <h3>{unitName(a.unit_id)}</h3>
        <p>{a.title}</p>
        <div className="card-meta">
          <span>
            <Clock3 size={14} />
            {dateTime(a.due_at)}
          </span>
          <span>
            <Users size={14} />
            {a.occupancy} hóspedes
          </span>
        </div>
        <div className="card-person">
          <span className="avatar tiny">{person(a.assignee).slice(0, 1)}</span>
          {person(a.assignee)}
        </div>
      </div>
      <div className="activity-end">
        <Badge status={a.status} />
        {a.priority !== 'normal' && (
          <span className="priority">
            <AlertTriangle size={13} />
            {a.priority === 'urgent' ? 'Urgente' : 'Alta prioridade'}
          </span>
        )}
        <button className="text-button" onClick={() => setSelected(a.id)}>
          {a.status === 'review'
            ? 'Revisar'
            : a.status === 'pending'
              ? 'Iniciar atividade'
              : isDone(a)
                ? 'Ver histórico'
                : 'Continuar'}
          <ArrowRight size={16} />
        </button>
      </div>
    </article>
  );

  const orderCard = (s: Service) => (
    <button
      className="service-row"
      key={s.id}
      onClick={() =>
        s.activity_id ? setSelected(s.activity_id) : setService(s)
      }
    >
      <span className="section-icon">
        {s.execution_mode === 'checklist' ? (
          <ClipboardList size={20} />
        ) : (
          <Wrench size={20} />
        )}
      </span>
      <div>
        <strong>{s.title}</strong>
        <small>
          {unitName(s.unit_id)} · {person(s.assignee)} · {serviceWindow(s)}
        </small>
        <small>
          {s.execution_mode === 'checklist'
            ? 'Checklist de um modelo'
            : 'Tarefa simples'}
          {s.template_id
            ? ` · ${data.checklist_template_versions.find((t) => t.id === s.template_id)?.name ?? 'Modelo'} · v${data.checklist_template_versions.find((t) => t.id === s.template_id)?.version ?? '—'}`
            : ''}
          {s.checkin_order_id || s.parent_order_id
            ? ` · Check-in #${(s.checkin_order_id || s.parent_order_id)!.slice(0, 8)}`
            : ''}
        </small>
        {s.blocking && (
          <small className="error-text">Impede a liberação da unidade</small>
        )}
      </div>
      <Badge status={s.status} />
      <ChevronRight size={17} />
    </button>
  );
  const executionList = (activities: Activity[], tasks: Service[]) =>
    [...activities, ...tasks]
      .sort((a, b) => a.due_at.localeCompare(b.due_at))
      .map((row) => ('items' in row ? activityCard(row) : orderCard(row)));

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Ir para o conteúdo
      </a>
      {sidebar && (
        <button
          className="sidebar-overlay"
          aria-label="Fechar menu"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
        <NavLink to="/" className="brand" onClick={() => setSidebar(false)}>
          <div className="brand-icon">
            <House size={26} />
            <Check size={13} />
          </div>
          <div>
            <strong>
              AJA<span>ANFITRIÃO</span>
            </strong>
            <small>Gestão que acolhe.</small>
          </div>
        </NavLink>
        <div className="workspace">
          <span className="workspace-icon">A</span>
          <div>
            <strong>{data.organizations[0]?.name ?? 'AJA Anfitrião'}</strong>
            <small>Espaço de trabalho</small>
          </div>
          <ShieldCheck size={17} />
        </div>
        <span className="nav-caption">OPERAÇÃO</span>
        <nav aria-label="Navegação principal">
          {navigation
            .filter((n) => manager || !['/', '/aprovacoes'].includes(n.path))
            .map((n) => (
              <NavLink
                key={n.path}
                to={n.path}
                end={n.path === '/'}
                onClick={() => setSidebar(false)}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.path === '/aprovacoes' && counts.review > 0 && (
                  <b>{counts.review}</b>
                )}
              </NavLink>
            ))}
        </nav>
        {manager && (
          <>
            <span className="nav-caption">GESTÃO</span>
            <nav aria-label="Gestão">
              {management
                .filter((n) => n.path !== '/equipe' || admin)
                .map((n) => (
                  <NavLink
                    key={n.path}
                    to={n.path}
                    onClick={() => setSidebar(false)}
                  >
                    <n.icon size={18} />
                    <span>{n.label}</span>
                  </NavLink>
                ))}
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="care-note">
            <div>
              <Sparkles size={18} />
              <strong>Cuidado em cada detalhe.</strong>
            </div>
            <p>
              Uma operação organizada.
              <br />
              Uma boa estadia, sempre.
            </p>
          </div>
          <NavLink className="help-link" to="/perfil">
            <CircleHelp size={18} />
            Preferências e ajuda
          </NavLink>
          <button className="user-button" onClick={() => setModal('account')}>
            <span className="avatar">{profile?.name.slice(0, 1) ?? 'A'}</span>
            <span>
              <strong>{profile?.name ?? 'Bem-vindo à AJA'}</strong>
              <small>
                {session
                  ? manager
                    ? 'Gestão da operação'
                    : 'Colaborador'
                  : 'Configure seu acesso'}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={22} />
            </button>
            <span>Espaço de trabalho</span>
            <ChevronRight size={14} />
            <strong>{path === '/' ? 'Visão geral' : headTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection ${online ? '' : 'offline'}`}>
              <span />
              {online
                ? session
                  ? 'Conectado'
                  : 'Ambiente local'
                : 'Sem conexão'}
            </span>
            <NavLink
              className="icon-button notification-button"
              to="/notificacoes"
              aria-label={`Notificações, ${notifications} não lidas`}
            >
              <Bell size={20} />
              {notifications > 0 && <i>{notifications}</i>}
            </NavLink>
            <button
              className="avatar"
              aria-label="Abrir conta"
              onClick={() => setModal('account')}
            >
              {profile?.name.slice(0, 1) ?? 'A'}
            </button>
          </div>
        </header>
        <main id="main">
          <div className="page-intro">
            <div>
              <div className="eyebrow">
                {new Intl.DateTimeFormat('pt-BR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  timeZone: 'America/Sao_Paulo',
                }).format(new Date())}
              </div>
              <h1>{headTitle}</h1>
              <p>
                {path === '/'
                  ? `Olá${profile ? ', ' + profile.name.split(' ')[0] : ''}. Cada detalhe pronto para a próxima chegada.`
                  : path === '/meu-dia'
                    ? 'Tudo o que você precisa fazer, em um só lugar.'
                    : path === '/aprovacoes'
                      ? 'Seu olhar é a última etapa antes de receber bem.'
                      : 'Organização, clareza e cuidado em cada etapa.'}
              </p>
            </div>
            {manager &&
              [
                '/',
                '/atividades',
                '/propriedades',
                '/servicos',
                '/inventario',
                '/equipe',
                '/checklists',
              ].includes(path) && (
                <button
                  className="button primary"
                  onClick={() => open(actionModal)}
                >
                  <Plus size={18} />
                  {actionLabel}
                </button>
              )}
          </div>
          {session &&
            !query.isPending &&
            !query.error &&
            memberships.length === 0 && (
              <div className="setup-banner">
                <Building2 size={25} />
                <div>
                  <strong>
                    Bem-vindo! Sua conta ainda não tem organização.
                  </strong>
                  <p>
                    Peça acesso ao administrador ou crie sua própria
                    organização.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal('bootstrap')}
                >
                  Criar organização
                </button>
              </div>
            )}
          {!online && (
            <div className="alert">
              <CloudOff size={20} />
              Sem conexão. Rascunhos podem ser salvos neste dispositivo;
              conclusões exigem confirmação do servidor.
            </div>
          )}
          {(query.error || error) && (
            <div role="alert" className="alert error">
              <AlertTriangle size={20} />
              <span>{error || query.error?.message}</span>
              <button
                className="icon-button"
                aria-label="Limpar erro e tentar novamente"
                onClick={() => {
                  setError('');
                  void query.refetch();
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {query.isPending && session && (
            <p className="loading">
              <LoaderCircle className="spin" size={18} />
              Carregando sua operação…
            </p>
          )}
          {[
            '/',
            '/meu-dia',
            '/atividades',
            '/aprovacoes',
            '/propriedades',
            '/servicos',
            '/inventario',
            '/relatorios',
          ].includes(path) && (
            <div className="filter-bar">
              <label className="search-input">
                <Search size={17} />
                <input
                  aria-label="Buscar na operação"
                  placeholder="Buscar propriedade, atividade ou pessoa…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="select-filter">
                <House size={16} />
                <select
                  aria-label="Filtrar empreendimento"
                  value={property}
                  onChange={(e) => setProperty(e.target.value)}
                >
                  <option value="">Todos os empreendimentos</option>
                  {options.properties.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="filter-end">
                <SlidersHorizontal size={16} />
                Filtros
              </span>
            </div>
          )}
          {path === '/' && (
            <>
              <section className="stats" aria-label="Indicadores da operação">
                {[
                  {
                    title: 'Atividades pendentes',
                    value: counts.pending,
                    icon: ClipboardList,
                    note: 'Para colocar em movimento',
                    color: 'gold',
                  },
                  {
                    title: 'Em andamento',
                    value: counts.progress,
                    icon: Clock3,
                    note: 'Cuidado acontecendo agora',
                    color: 'blue',
                  },
                  {
                    title: 'Aguardando aprovação',
                    value: counts.review,
                    icon: ClipboardCheck,
                    note: 'Precisam do seu olhar',
                    color: 'orange',
                  },
                  {
                    title: 'Unidades prontas',
                    value: counts.ready,
                    icon: House,
                    note: 'Tudo pronto para receber',
                    color: 'green',
                  },
                ].map((s, i) => (
                  <button
                    key={s.title}
                    className={`stat-card stat-${s.color}`}
                    onClick={() => {
                      setFilter('Hoje');
                      setModal(i === 2 ? 'approval-summary' : 'stats-' + i);
                    }}
                  >
                    <div>
                      <span>{s.title}</span>
                      <s.icon size={20} />
                    </div>
                    <strong>{s.value.toString().padStart(2, '0')}</strong>
                    <small>
                      <span />
                      {s.note}
                    </small>
                  </button>
                ))}
              </section>
              <div className="dashboard-grid">
                <div className="dashboard-main">
                  <section className="panel approval-panel">
                    <div className="section-heading">
                      <div className="heading-with-icon">
                        <span className="section-icon warm">
                          <ClipboardCheck size={19} />
                        </span>
                        <div>
                          <h2>
                            Aguardando minha aprovação{' '}
                            <span className="count-pill">
                              {approvals.length + taskApprovals.length}
                            </span>
                          </h2>
                          <p>
                            A última conferência para uma estadia impecável.
                          </p>
                        </div>
                      </div>
                      <NavLink to="/aprovacoes" className="text-button">
                        Ver todas
                        <ArrowRight size={15} />
                      </NavLink>
                    </div>
                    {approvals.length + taskApprovals.length ? (
                      executionList(approvals, taskApprovals).slice(0, 3)
                    ) : (
                      <Empty
                        title="Tudo em ordem por aqui"
                        description="As arrumações enviadas pela equipe aparecerão aqui para sua revisão."
                      />
                    )}
                    <div className="panel-footer">
                      <ShieldCheck size={15} />
                      Cada liberação passa pela aprovação de um gestor.
                    </div>
                  </section>
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>O ritmo do dia</h2>
                        <p>Atividades e próximos passos da sua equipe.</p>
                      </div>
                      <NavLink to="/atividades" className="text-button">
                        Ver agenda
                        <ArrowRight size={15} />
                      </NavLink>
                    </div>
                    <div className="tabs">
                      {['Hoje', 'Amanhã', 'Atrasadas'].map((f) => (
                        <button
                          key={f}
                          className={filter === f ? 'selected' : ''}
                          onClick={() => setFilter(f)}
                        >
                          {f}
                          {f === 'Hoje' && (
                            <span>{daily.length + dailyTasks.length}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    {daily.length + dailyTasks.length ? (
                      executionList(daily, dailyTasks).slice(0, 5)
                    ) : (
                      <Empty
                        title="Um novo dia começa com organização"
                        description="Crie uma ordem de check-in para programar a chegada e o checkout."
                        action={() => open('checkin')}
                        label="Programar atividades"
                      />
                    )}
                  </section>
                </div>
                <aside className="dashboard-aside">
                  <section className="panel property-overview">
                    <div className="section-heading">
                      <h2>Suas propriedades</h2>
                      <House size={19} />
                    </div>
                    <div className="property-total">
                      <strong>
                        {data.units.length.toString().padStart(2, '0')}
                      </strong>
                      <span>unidades na operação</span>
                    </div>
                    <div className="segmented-bar">
                      {data.units.length ? (
                        data.units.map((u) => (
                          <span
                            className={`segment-${u.operational_status}`}
                            key={u.id}
                          />
                        ))
                      ) : (
                        <span className="segment-empty" />
                      )}
                    </div>
                    <ul className="property-legend">
                      {[
                        {
                          label: 'Prontas para receber',
                          value: counts.ready,
                          color: 'green',
                        },
                        {
                          label: 'Em preparação',
                          value: data.units.filter(
                            (u) => u.operational_status === 'preparing',
                          ).length,
                          color: 'gold',
                        },
                        {
                          label: 'Aguardando revisão',
                          value: data.units.filter(
                            (u) => u.operational_status === 'review',
                          ).length,
                          color: 'orange',
                        },
                        {
                          label: 'Indisponíveis',
                          value: data.units.filter((u) =>
                            ['unavailable', 'adjustment'].includes(
                              u.operational_status,
                            ),
                          ).length,
                          color: 'gray',
                        },
                      ].map((s) => (
                        <li key={s.label}>
                          <span className={`dot ${s.color}`} />
                          {s.label}
                          <strong>{s.value}</strong>
                        </li>
                      ))}
                    </ul>
                    <NavLink
                      className="button secondary full"
                      to="/propriedades"
                    >
                      Ver propriedades
                      <ArrowRight size={16} />
                    </NavLink>
                  </section>
                  <section className="care-card">
                    <span className="care-house">
                      <House size={33} />
                      <Sparkles size={18} />
                    </span>
                    <div className="eyebrow">O JEITO AJA DE RECEBER</div>
                    <h2>
                      Uma boa estadia
                      <br />
                      começa nos detalhes.
                    </h2>
                    <p>
                      Vistoriar, cuidar, conferir.
                      <br />
                      Sua equipe conectada em cada etapa.
                    </p>
                    <div className="care-steps">
                      <Check size={13} /> Cuidado <span>·</span>
                      <Check size={13} /> Confiança
                    </div>
                  </section>
                  <div className="audit-note">
                    <ShieldCheck size={19} />
                    <p>
                      <strong>Uma operação com memória.</strong>
                      <br />
                      Ações críticas ficam registradas com responsável e horário
                      oficial.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {['/', '/atividades', '/meu-dia'].includes(path) && (
            <StayAgenda
              data={data}
              manager={manager}
              property={property}
              run={run}
            />
          )}
          {['/atividades', '/meu-dia'].includes(path) && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>
                    {path === '/meu-dia'
                      ? 'Suas atividades'
                      : 'Agenda operacional'}{' '}
                    <span className="count-pill">
                      {path === '/meu-dia'
                        ? myActivities.length +
                          dailyTasks.filter((s) => s.assignee === user).length
                        : daily.length + dailyTasks.length}
                    </span>
                  </h2>
                  <p>Atrasadas e urgentes aparecem primeiro.</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setCalendar(!calendar)}
                >
                  <CalendarDays size={16} />
                  {calendar ? 'Lista' : 'Calendário'}
                </button>
              </div>
              <div className="tabs">
                {['Hoje', 'Amanhã', 'Semana', 'Atrasadas', 'Concluídas'].map(
                  (f) => (
                    <button
                      key={f}
                      className={filter === f ? 'selected' : ''}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ),
                )}
              </div>
              {calendar && (
                <div className="week-strip">
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() + i);
                    return (
                      <div key={i}>
                        <small>
                          {new Intl.DateTimeFormat('pt-BR', {
                            weekday: 'short',
                          }).format(d)}
                        </small>
                        <strong>{d.getDate()}</strong>
                        <span>
                          {visible.filter(
                            (a) => dayKey(new Date(a.due_at)) === dayKey(d),
                          ).length +
                            taskOrders.filter(
                              (s) => dayKey(new Date(s.due_at)) === dayKey(d),
                            ).length}{' '}
                          atividades
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {(path === '/meu-dia' ? myActivities : daily).length +
              dailyTasks.filter(
                (s) => path !== '/meu-dia' || s.assignee === user,
              ).length ? (
                executionList(
                  path === '/meu-dia' ? myActivities : daily,
                  dailyTasks.filter(
                    (s) => path !== '/meu-dia' || s.assignee === user,
                  ),
                )
              ) : (
                <Empty
                  title="Nenhuma atividade neste período"
                  description={
                    path === '/meu-dia'
                      ? 'As atividades atribuídas a você aparecerão automaticamente aqui.'
                      : 'Crie uma ordem e atribua um responsável para começar.'
                  }
                />
              )}
            </section>
          )}
          {path === '/aprovacoes' && (
            <section className="panel">
              <div className="section-heading">
                <h2>
                  Revisões pendentes{' '}
                  <span className="count-pill">
                    {approvals.length + taskApprovals.length}
                  </span>
                </h2>
                <ShieldCheck size={20} />
              </div>
              {approvals.length + taskApprovals.length ? (
                executionList(approvals, taskApprovals)
              ) : (
                <Empty
                  title="Nenhuma revisão pendente"
                  description="Você será notificado quando uma arrumação estiver pronta para revisão."
                />
              )}
            </section>
          )}
          {path === '/propriedades' && (
            <div className="property-grid">
              {data.properties
                .filter(
                  (p) =>
                    (!property || p.id === property) &&
                    p.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((p) => (
                  <section className="panel property-card" key={p.id}>
                    <div className="property-art">
                      <Building2 size={40} />
                      <span>{p.name}</span>
                    </div>
                    <div className="property-card-body">
                      <h2>{p.name}</h2>
                      <p>{p.address || 'Endereço não informado'}</p>
                      {data.units
                        .filter((u) => u.property_id === p.id)
                        .map((u) => (
                          <div className="unit-row" key={u.id}>
                            <div>
                              <strong>{u.name}</strong>
                              <small>
                                Até {u.capacity} hóspedes · Padrão{' '}
                                {u.base_occupancy}
                              </small>
                              {u.prepared_for && (
                                <small>
                                  Última preparação: {u.prepared_for} hóspedes
                                </small>
                              )}
                            </div>
                            <Badge status={u.operational_status} />
                            <button
                              className="icon-button"
                              aria-label={`Configurar ${u.name}`}
                              onClick={() => {
                                setSelectedUnit(u.id);
                                setModal('unit-detail');
                              }}
                            >
                              <ChevronRight size={18} />
                            </button>
                          </div>
                        ))}
                      {manager && (
                        <button
                          className="button secondary full"
                          onClick={() => {
                            setProperty(p.id);
                            open('unit');
                          }}
                        >
                          <Plus size={16} />
                          Adicionar unidade
                        </button>
                      )}
                    </div>
                  </section>
                ))}
              {!data.properties.length && (
                <section className="panel">
                  <Empty
                    title="Um lugar para cada propriedade"
                    description="Cadastre seus empreendimentos e adicione as unidades, ambientes e padrões de preparação."
                    action={() => open('property')}
                    label="Cadastrar empreendimento"
                  />
                </section>
              )}
            </div>
          )}
          {path === '/servicos' && (
            <section className="panel">
              <div className="section-heading">
                <h2>Ordens de serviço</h2>
                <span className="count-pill">
                  {data.service_orders.filter((s) => !s.deleted_at).length}{' '}
                  ordens
                </span>
              </div>
              {data.service_orders
                .filter((s) => !s.deleted_at)
                .filter(
                  (s) =>
                    (!property ||
                      data.units.find((u) => u.id === s.unit_id)
                        ?.property_id === property) &&
                    `${s.title} ${unitName(s.unit_id)}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .map(orderCard)}
              {!data.service_orders.some((s) => !s.deleted_at) && (
                <Empty
                  title="Nenhuma ordem de serviço"
                  description="Crie ordens com modelos de checklist ou tarefas simples."
                  action={() => open('service')}
                  label="Abrir ordem de serviço"
                />
              )}
              {manager && (
                <DeletedOrders data={data} run={run} property={property} />
              )}
            </section>
          )}
          {path === '/inventario' && (
            <section className="panel">
              <div className="section-heading">
                <h2>Patrimônio, enxoval e consumo</h2>
                <ListChecks size={20} />
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Unidade / ambiente</th>
                      <th>Categoria</th>
                      <th>Quantidade padrão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inventory_items
                      .filter(
                        (i) =>
                          (!property ||
                            data.units.find((u) => u.id === i.unit_id)
                              ?.property_id === property) &&
                          i.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((i) => (
                        <tr key={i.id}>
                          <td>
                            <strong>{i.name}</strong>
                          </td>
                          <td>
                            {unitName(i.unit_id)} · {i.room}
                          </td>
                          <td>
                            {
                              {
                                permanent: 'Patrimônio',
                                linen: 'Enxoval',
                                consumable: 'Consumo',
                              }[i.category]
                            }
                          </td>
                          <td>{i.expected} un.</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!data.inventory_items.length && (
                <Empty
                  title="Conheça cada detalhe do seu patrimônio"
                  description="Cadastre itens por ambiente. As quantidades serão conferidas explicitamente durante a vistoria."
                  action={() => open('inventory')}
                  label="Cadastrar item"
                />
              )}
            </section>
          )}
          {path === '/checklists' && (
            <ChecklistCatalog
              run={run}
              data={data}
              onCreate={() => open('template')}
              onDuplicate={(id) => {
                setSelectedUnit(id);
                setModal('duplicate-template');
              }}
              onEdit={(id) => {
                setSelectedUnit(id);
                setModal('view-template');
              }}
              onPreview={(id) => {
                setSelectedUnit(id);
                setModal('preview-template');
              }}
            />
          )}
          {path === '/equipe' && (
            <section className="panel">
              <div className="section-heading">
                <h2>Pessoas que fazem acontecer</h2>
                <ShieldCheck size={20} />
              </div>
              {data.profiles.map((p) => (
                <div className="team-row" key={p.id}>
                  <span className="avatar">{p.name.slice(0, 1)}</span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {data.memberships
                        .filter((m) => m.user_id === p.id)
                        .flatMap((m) => m.roles)
                        .map(
                          (r) =>
                            ({
                              admin: 'Administrador',
                              manager: 'Gestor',
                              inspector: 'Vistoriador',
                              cleaner: 'Limpeza',
                            })[r],
                        )
                        .join(' · ')}
                    </small>
                  </div>
                  <Badge status={p.active ? 'ready' : 'unavailable'} />
                </div>
              ))}
              {!data.profiles.length && (
                <Empty
                  title="Uma equipe, responsabilidades claras"
                  description="Cada colaborador utiliza uma conta individual e acessa somente as propriedades autorizadas."
                />
              )}
            </section>
          )}
          {path === '/notificacoes' && (
            <section className="panel">
              <div className="section-heading">
                <h2>Central de notificações</h2>
                <span className="count-pill">{notifications} não lidas</span>
              </div>
              {[...data.notifications]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((n) => (
                  <button
                    className={`notice-row ${!n.read_at ? 'unread' : ''}`}
                    key={n.id}
                    onClick={() =>
                      void run(async () => {
                        await rpc('read_notification', { notification: n.id });
                        if (n.activity_id) setSelected(n.activity_id);
                      }, 'Notificação lida.')
                    }
                  >
                    <span className="section-icon">
                      <Bell size={19} />
                    </span>
                    <div>
                      <strong>{n.title}</strong>
                      <p>{n.message}</p>
                      <small>{dateTime(n.created_at)}</small>
                    </div>
                    {!n.read_at && <span className="dot green" />}
                  </button>
                ))}
              {!data.notifications.length && (
                <Empty
                  title="Você está em dia"
                  description="Atribuições, conclusões e solicitações de correção ficam registradas aqui."
                />
              )}
            </section>
          )}
          {path === '/auditoria' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Histórico da operação</h2>
                  <p>
                    Registros de servidor, preservados em ordem cronológica.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() =>
                    download(
                      'aja-auditoria.json',
                      JSON.stringify(data.audit_events, null, 2),
                      'application/json',
                    )
                  }
                >
                  <ArrowDownToLine size={16} />
                  Exportar
                </button>
              </div>
              {[...data.audit_events]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((e) => (
                  <details className="audit-row" key={e.id}>
                    <summary>
                      <span className="section-icon">
                        <FileClock size={18} />
                      </span>
                      <div>
                        <strong>{e.event}</strong>
                        <small>
                          {person(e.actor)} · {dateTime(e.created_at)}
                        </small>
                      </div>
                      <ChevronRight size={16} />
                    </summary>
                    <p>{e.reason}</p>
                    <small>Correlação: {e.correlation_id}</small>
                    <pre>
                      {JSON.stringify(
                        { anterior: e.before_data, posterior: e.after_data },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                ))}
              {!data.audit_events.length && (
                <Empty
                  title="A história começa na primeira ação"
                  description="Criações, atribuições, respostas, fotos e decisões serão registradas com o responsável e horário do banco."
                />
              )}
            </section>
          )}
          {path === '/relatorios' && (
            <Reports
              data={data}
              property={property}
              person={person}
              unitName={unitName}
            />
          )}
          {path === '/perfil' && (
            <section className="panel preferences">
              <div className="section-heading">
                <div>
                  <h2>Uma interface do seu jeito</h2>
                  <p>
                    Escolha o tamanho mais confortável para ler e trabalhar.
                  </p>
                </div>
                <Settings2 size={21} />
              </div>
              <label className="field">
                <span>Tamanho da fonte</span>
                <select
                  value={
                    profile?.font_scale ??
                    Number(localStorage.getItem('aja-font') ?? 100)
                  }
                  onChange={(e) => {
                    const scale = Number(e.target.value);
                    if (session)
                      void run(() => rpc('set_preferences', { scale }));
                    else {
                      localStorage.setItem('aja-font', String(scale));
                      document.documentElement.style.fontSize = `${scale}%`;
                      setMessage('Preferência salva neste navegador.');
                    }
                  }}
                >
                  {[100, 125, 150, 200].map((v, i) => (
                    <option key={v} value={v}>
                      {['Normal', 'Grande', 'Muito grande', 'Extra grande'][i]}{' '}
                      · {v}%
                    </option>
                  ))}
                </select>
              </label>
              <div className="info-card">
                <h3>Instale para ter sempre por perto</h3>
                <p>
                  No menu do navegador, escolha “Instalar aplicativo” ou
                  “Adicionar à tela de início”, quando disponível.
                </p>
                <p>
                  Rascunhos salvos neste dispositivo são identificados como
                  locais. Envie as informações para confirmar cada atividade no
                  servidor.
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setModal('setup')}
              >
                <CircleHelp size={17} />
                Configuração e documentação
              </button>
            </section>
          )}
          {path === '/perfil' && (
            <section className="panel push-settings">
              <div className="section-heading">
                <div>
                  <h2>Notificações neste dispositivo</h2>
                  <p>
                    Receba avisos quando o aplicativo estiver fechado, conforme
                    o suporte do navegador.
                  </p>
                </div>
                <Bell size={20} />
              </div>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => {
                    if (needSession())
                      void run(
                        enablePush,
                        'Notificações ativadas neste dispositivo.',
                      );
                  }}
                >
                  Ativar notificações push
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    if (needSession())
                      void run(disablePush, 'Notificações push desativadas.');
                  }}
                >
                  Desativar push
                </button>
              </div>
            </section>
          )}
          {path === '/propriedades' && manager && (
            <section className="panel quick-reservation">
              <div className="section-heading">
                <div>
                  <h2>Uma nova reserva chegou?</h2>
                  <p>
                    A ocupação define os ajustes necessários nas unidades já
                    preparadas.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => open('checkin')}
                >
                  <Plus size={16} />
                  Criar ordem de check-in
                </button>
              </div>
            </section>
          )}
          <footer className="page-footer">
            <span>
              AJA Anfitrião <span>·</span> Hospitalidade em cada detalhe.
            </span>
            <span>
              <ShieldCheck size={14} />
              Operação com rastreabilidade
            </span>
          </footer>
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          <CheckCheck size={20} />
          {message}
        </div>
      )}
      {modal === 'setup' && (
        <Modal
          title="Configuração do ambiente"
          onClose={() => setModal(null)}
          wide
        >
          <Setup />
        </Modal>
      )}
      {modal === 'account' && (
        <Modal title="Sua conta" onClose={() => setModal(null)}>
          <h3>{profile?.name}</h3>
          <p>{session?.user.email}</p>
          <NavLink
            className="button secondary full"
            to="/perfil"
            onClick={() => setModal(null)}
          >
            Preferências de acessibilidade
            <ArrowRight size={17} />
          </NavLink>
          <button
            className="button danger full"
            onClick={() =>
              void run(async () => {
                await clearDrafts();
                await supabase?.auth.signOut();
                qc.clear();
                setModal(null);
              }, 'Você saiu da conta. Rascunhos locais removidos.')
            }
          >
            <LogOut size={17} />
            Sair e limpar rascunhos
          </button>
        </Modal>
      )}
      {modal === 'bootstrap' && (
        <Modal title="Criar sua organização" onClose={() => setModal(null)}>
          <Form
            fields={[
              {
                name: 'org_name',
                label: 'Nome da organização',
                value: 'AJA Anfitrião',
              },
              { name: 'full_name', label: 'Seu nome completo' },
            ]}
            onSubmit={async (v) => {
              if (await run(() => rpc('bootstrap', v))) setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === 'property' && (
        <Modal title="Novo empreendimento" onClose={() => setModal(null)}>
          <Form
            fields={[
              {
                name: 'org_id',
                label: 'Organização',
                options: data.organizations.map((o) => ({
                  value: o.id,
                  label: o.name,
                })),
                value: data.organizations[0]?.id,
              },
              { name: 'name', label: 'Nome do empreendimento' },
              { name: 'address', label: 'Endereço', required: false },
            ]}
            onSubmit={async (v) => {
              if (
                await run(() =>
                  rpc('configure', { action: 'property', payload: v }),
                )
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === 'unit' && (
        <Modal title="Adicionar unidade" onClose={() => setModal(null)}>
          <Form
            fields={[
              {
                name: 'property_id',
                label: 'Empreendimento',
                options: options.properties,
                value: property,
              },
              { name: 'name', label: 'Nome ou identificação da unidade' },
              {
                name: 'capacity',
                label: 'Capacidade máxima de hóspedes',
                type: 'number',
                min: 1,
              },
              {
                name: 'base_occupancy',
                label: 'Ocupação-base de preparação',
                type: 'number',
                min: 1,
              },
            ]}
            onSubmit={async (v) => {
              if (
                await run(() =>
                  rpc('configure', { action: 'unit', payload: v }),
                )
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === 'unit-detail' && (
        <Modal title={unitName(selectedUnit)} onClose={() => setModal(null)}>
          <p>Ambientes cadastrados</p>
          {data.environments
            .filter((e) => e.unit_id === selectedUnit)
            .map((e) => (
              <div className="simple-row" key={e.id}>
                <House size={18} />
                {e.name}
              </div>
            ))}
          <Form
            fields={[{ name: 'name', label: 'Novo ambiente' }]}
            submit="Adicionar ambiente"
            onSubmit={async (v) => {
              await run(() =>
                rpc('configure', {
                  action: 'environment',
                  payload: { ...v, unit_id: selectedUnit },
                }),
              );
            }}
          />
        </Modal>
      )}
      {modal === 'inventory' && (
        <InventoryEditor data={data} run={run} onClose={() => setModal(null)} />
      )}
      {modal === 'member' && (
        <MemberEditor data={data} run={run} onClose={() => setModal(null)} />
      )}
      {modal === 'checkin' && (
        <WorkOrderEditor
          data={data}
          run={run}
          onClose={() => setModal(null)}
          initialType="checkin"
        />
      )}
      {modal === 'service' && (
        <WorkOrderEditor data={data} run={run} onClose={() => setModal(null)} />
      )}
      {modal === 'preview-template' &&
        (() => {
          const template = data.checklist_template_versions.find(
            (t) => t.id === selectedUnit,
          );
          return template ? (
            <ChecklistPreviewDialog
              template={template}
              unit={data.units.find((u) => u.id === template.unit_id)}
              onClose={() => setModal(null)}
            />
          ) : null;
        })()}
      {['template', 'view-template', 'duplicate-template'].includes(
        modal ?? '',
      ) && (
        <TemplateEditor
          key={modal + selectedUnit}
          data={data}
          templateId={modal === 'view-template' ? selectedUnit : undefined}
          duplicateId={
            modal === 'duplicate-template' ? selectedUnit : undefined
          }
          onClose={() => setModal(null)}
          run={run}
        />
      )}
      {(modal === 'approval-summary' || modal?.startsWith('stats-')) && (
        <Modal
          title={
            modal === 'approval-summary'
              ? 'Aguardando aprovação'
              : 'Resumo das atividades'
          }
          onClose={() => setModal(null)}
          wide
        >
          {executionList(
            modal === 'approval-summary'
              ? approvals
              : visible.filter((a) =>
                  modal === 'stats-0'
                    ? a.status === 'pending'
                    : modal === 'stats-1'
                      ? a.status === 'in_progress'
                      : false,
                ),
            modal === 'approval-summary'
              ? taskApprovals
              : taskOrders.filter((s) =>
                  modal === 'stats-0'
                    ? s.status === 'assigned'
                    : modal === 'stats-1'
                      ? s.status === 'in_progress'
                      : false,
                ),
          )}
          {modal === 'stats-3' && (
            <p>
              {counts.ready} unidades prontas. Consulte a página Propriedades
              para ver os estados operacionais.
            </p>
          )}
        </Modal>
      )}
      {active && (
        <ActivityDetail
          key={`${active.id}:${active.attempt}`}
          activity={active}
          data={data}
          user={user}
          manager={manager}
          busy={busy}
          run={run}
          onClose={() => setSelected(null)}
          unitName={unitName}
          person={person}
        />
      )}
      {service && (
        <ServiceDetail
          service={
            data.service_orders.find((s) => s.id === service.id) ?? service
          }
          data={data}
          user={user}
          manager={manager}
          run={run}
          onClose={() => setService(null)}
        />
      )}
    </div>
  );
}

function Setup() {
  return (
    <div className="setup-content">
      <p>A interface está instalada. Para iniciar a operação real:</p>
      <ol>
        <li>
          Crie um projeto Supabase e aplique{' '}
          <code>todas as migrações em supabase/migrations, em ordem</code>.
        </li>
        <li>
          Copie <code>.env.example</code> para <code>.env.local</code> e
          preencha as variáveis públicas e de servidor descritas no README.
        </li>
        <li>
          Reinicie o servidor. Crie sua conta no Supabase Auth e entre na
          plataforma.
        </li>
        <li>
          Crie a organização, cadastre propriedades, unidades e equipe; publique
          os dois tipos de checklist.
        </li>
        <li>
          Na Vercel, configure as mesmas variáveis e as variáveis de servidor
          descritas no README.
        </li>
      </ol>
      <div className="info-card">
        <ShieldCheck size={22} />
        <p>
          Sem conexão configurada, os indicadores ficam vazios e nenhuma ação é
          apresentada como salva. A chave <code>service_role</code> é usada
          exclusivamente no servidor para verificar arquivos e processar push.
          Nunca utilize o prefixo VITE_ para essa chave.
        </p>
      </div>
      <p className="muted">
        Consulte README.md e docs/IMPLEMENTACAO.md para instalação, cobertura e
        pendências de produção.
      </p>
    </div>
  );
}
