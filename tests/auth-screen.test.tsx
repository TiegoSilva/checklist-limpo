import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import LoginPage from '../src/features/LoginPage';

const backend = vi.hoisted(() => ({ configured: false, loadData: vi.fn() }));
vi.mock('../src/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/client')>()),
  get configured() {
    return backend.configured;
  },
  supabase: null,
  loadData: backend.loadData,
}));

function renderApp(path: string) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}

describe('acesso público restrito ao login', () => {
  it.each([
    '/',
    '/meu-dia',
    '/atividades',
    '/propriedades',
    '/auditoria',
    '/aprovacoes',
  ])('mostra somente login ao abrir %s sem sessão', (path) => {
    backend.configured = false;
    const html = renderApp(path);
    expect(html).toContain('Entre na sua conta');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).not.toMatch(
      /app-shell|<nav|<aside|Sua operação, em dia|Indicadores da operação|Vamos preparar sua operação|Configuração do ambiente/,
    );
    expect(backend.loadData).not.toHaveBeenCalled();
  });

  it('aguarda a restauração da sessão sem mostrar o portal', () => {
    backend.configured = true;
    const html = renderApp('/propriedades');
    expect(html).toContain('Verificando acesso');
    expect(html).not.toMatch(/app-shell|<form|<nav|<aside/);
    expect(backend.loadData).not.toHaveBeenCalled();
    backend.configured = false;
  });

  it('mantém a falha de sessão na tela de login', () => {
    const html = renderToStaticMarkup(
      <LoginPage sessionError="Não foi possível verificar seu acesso. Entre novamente." />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Entre novamente.');
    expect(html).toContain('name="password"');
    expect(html).not.toContain('app-shell');
  });
});
