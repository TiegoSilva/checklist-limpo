import { statusLabels, orderStatus } from './domain';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useId,
  type ReactNode,
} from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Inbox,
  LoaderCircle,
  X,
} from 'lucide-react';
export type ModalFeedback = {
  kind: 'error' | 'success';
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
};
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = '',
  feedback,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  feedback?: ModalFeedback | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const feedbackId = useId();
  const hasFeedback = Boolean(feedback);
  useLayoutEffect(() => {
    if (!hasFeedback || !ref.current) return;
    const dialog = ref.current;
    const scrollTop = dialog.scrollTop;
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.scrollTop = 0;
    actionRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.scrollTop = scrollTop;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    };
  }, [hasFeedback]);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${wide ? 'modal wide' : 'modal'} ${className} ${hasFeedback ? 'modal-feedback-open' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        if (feedback) feedback.onAction();
        else onClose();
      }}
    >
      <div
        className="modal-content"
        inert={hasFeedback}
        aria-hidden={hasFeedback || undefined}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
      {feedback && (
        <div
          className={`modal-feedback modal-feedback-${feedback.kind}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${feedbackId}-title`}
          aria-describedby={`${feedbackId}-message`}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              actionRef.current?.focus();
            }
          }}
        >
          <div className="modal-feedback-card">
            <span className="modal-feedback-icon">
              {feedback.kind === 'error' ? (
                <CircleAlert size={36} />
              ) : (
                <CircleCheck size={36} />
              )}
            </span>
            <h2 id={`${feedbackId}-title`}>{feedback.title}</h2>
            <p id={`${feedbackId}-message`}>{feedback.message}</p>
            <button
              ref={actionRef}
              className="button primary"
              onClick={feedback.onAction}
            >
              {feedback.actionLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
export function Empty({
  title,
  description,
  action,
  label,
}: {
  title: string;
  description: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="button secondary" onClick={action}>
          {label}
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
export type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  value?: string;
  required?: boolean;
  hint?: string;
  min?: number;
};
export function Form({
  fields,
  onSubmit,
  submit = 'Salvar',
  busy = false,
  children,
}: {
  fields: Field[];
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
  submit?: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  const shape = Object.fromEntries(
    fields.map((f) => [
      f.name,
      f.required === false
        ? z.string()
        : z.string().min(1, 'Preencha este campo.'),
    ]),
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Record<string, string>>({
    resolver: zodResolver(z.object(shape)),
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.name, f.value ?? '']),
    ),
  });
  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)}>
      {fields.map((f) => (
        <label key={f.name} className="field">
          <span>{f.label}</span>
          {f.options ? (
            <select {...register(f.name)} required={f.required !== false}>
              <option value="">Selecione</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea
              {...register(f.name)}
              rows={3}
              required={f.required !== false}
            />
          ) : (
            <input
              {...register(f.name)}
              type={f.type ?? 'text'}
              min={f.min}
              required={f.required !== false}
            />
          )}{' '}
          {f.hint && <small>{f.hint}</small>}
          {errors[f.name] && (
            <small className="error-text">
              {String(errors[f.name]?.message)}
            </small>
          )}
        </label>
      ))}
      {children}
      <button
        className="button primary"
        type="submit"
        disabled={busy || isSubmitting}
      >
        {busy || isSubmitting ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <Check size={17} />
        )}{' '}
        {submit}
      </button>
    </form>
  );
}

export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge status-${['assigned', 'pending', 'in_progress', 'correction', 'rejected', 'review', 'approved', 'completed'].includes(status) ? orderStatus(status) : status}`}
    >
      <span />
      {statusLabels[status] ?? status}
    </span>
  );
}
