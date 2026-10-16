import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Eye, EyeOff, House, LoaderCircle, LogIn } from 'lucide-react';
import { configured, supabase } from '../lib/client';

const credentials = z.object({
  email: z.string().trim().pipe(z.email('Informe um e-mail válido.')),
  password: z.string().min(1, 'Informe sua senha.'),
});

export default function LoginPage({
  loading = false,
  sessionError = '',
}: {
  loading?: boolean;
  sessionError?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof credentials>>({
    resolver: zodResolver(credentials),
    defaultValues: { email: '', password: '' },
  });

  const signIn = handleSubmit(async (values) => {
    setError('');
    if (!supabase) return;
    try {
      const { error: authError } =
        await supabase.auth.signInWithPassword(values);
      if (authError) {
        setError(
          authError.code === 'invalid_credentials'
            ? 'E-mail ou senha inválidos. Verifique os dados e tente novamente.'
            : authError.code === 'email_not_confirmed'
              ? 'Confirme seu e-mail antes de entrar. Se precisar, fale com o administrador.'
              : 'Não foi possível entrar. Verifique sua conexão e tente novamente.',
        );
      }
    } catch {
      setError(
        'Não foi possível entrar. Verifique sua conexão e tente novamente.',
      );
    }
  });

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand login-brand" aria-label="AJA Anfitrião">
          <div className="brand-icon" aria-hidden="true">
            <House size={26} />
            <Check size={13} />
          </div>
          <div>
            <strong>
              AJA<span>ANFITRIÃO</span>
            </strong>
            <small>Gestão que acolhe.</small>
          </div>
        </div>
        <h1 id="login-title">Entre na sua conta</h1>
        <p className="login-description">
          Use seu e-mail e senha para acessar.
        </p>
        {loading ? (
          <div className="login-loading" role="status">
            <LoaderCircle className="spin" size={20} aria-hidden="true" />
            Verificando acesso…
          </div>
        ) : (
          <>
            {(error || sessionError) && (
              <p className="login-error" role="alert">
                {error || sessionError}
              </p>
            )}
            {!configured && (
              <p className="login-error" role="status">
                Acesso temporariamente indisponível. Entre em contato com o
                administrador.
              </p>
            )}
            <form className="form login-form" onSubmit={signIn} noValidate>
              <label className="field" htmlFor="login-email">
                <span>E-mail</span>
                <input
                  {...register('email')}
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="seu@email.com"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={
                    errors.email ? 'login-email-error' : undefined
                  }
                  disabled={isSubmitting}
                />
                {errors.email && (
                  <small id="login-email-error" className="error-text">
                    {errors.email.message}
                  </small>
                )}
              </label>
              <div className="field">
                <label htmlFor="login-password">Senha</label>
                <span className="login-password-field">
                  <input
                    {...register('password')}
                    id="login-password"
                    type={visible ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Digite sua senha"
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={
                      errors.password ? 'login-password-error' : undefined
                    }
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
                    aria-pressed={visible}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </span>
                {errors.password && (
                  <small id="login-password-error" className="error-text">
                    {errors.password.message}
                  </small>
                )}
              </div>
              <button
                type="submit"
                className="button primary"
                disabled={isSubmitting || !configured}
              >
                {isSubmitting ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <LogIn size={18} aria-hidden="true" />
                )}
                {isSubmitting ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
            <button
              type="button"
              className="button secondary full"
              disabled={linkBusy || isSubmitting || !configured}
              onClick={async () => {
                const email = z.email().safeParse(getValues('email').trim());
                if (!email.success) {
                  setError('Preencha seu e-mail acima para receber o link.');
                  return;
                }
                setLinkBusy(true);
                setError('');
                setNotice('');
                try {
                  const result = await supabase!.auth.signInWithOtp({
                    email: email.data,
                    options: {
                      shouldCreateUser: false,
                      emailRedirectTo: window.location.origin,
                    },
                  });
                  if (result.error) throw result.error;
                  setNotice(
                    'Se a conta estiver autorizada, o link chegará ao seu e-mail. Confira também o spam.',
                  );
                } catch {
                  setError(
                    'Não foi possível solicitar o link. Tente novamente mais tarde ou fale com o administrador.',
                  );
                } finally {
                  setLinkBusy(false);
                }
              }}
            >
              {linkBusy ? 'Solicitando…' : 'Entrar com link por e-mail'}
            </button>
            {notice && (
              <p role="status" className="login-help">
                {notice}
              </p>
            )}
            <p className="login-help">
              Precisa de acesso? Fale com o administrador.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
