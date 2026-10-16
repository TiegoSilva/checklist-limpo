import { useState } from 'react';
import { supabase } from '../lib/client';
export default function AccountPassword() {
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  return (
    <details className="room-section">
      <summary>Definir ou alterar minha senha</summary>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) {
            setError('As senhas precisam ser iguais.');
            return;
          }
          setBusy(true);
          setError('');
          setMessage('');
          try {
            if (!supabase) throw new Error('Entre novamente.');
            const result = await supabase.auth.updateUser({ password });
            if (result.error) throw result.error;
            setMessage('Senha atualizada.');
            setPassword('');
            setConfirm('');
          } catch {
            setError(
              'Não foi possível atualizar a senha. Entre novamente pelo link de acesso e tente outra vez.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Nova senha
          <input
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          Confirmar senha
          <input
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            value={confirm}
            disabled={busy}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button className="button primary" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar minha senha'}
        </button>
      </form>
    </details>
  );
}
