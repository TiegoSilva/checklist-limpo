import type { Item, Response } from '../domain';
import type { Draft, ExecutionPhoto } from '../lib/client';
import { OperationError, describeError } from '../lib/errors';

export function itemResponse(item: Item, response?: Response): Response {
  const next: Response = { confirmed: false, ...response };
  if (item.mode === 'count') {
    next.found ??= item.expected ?? 0;
    next.condition =
      next.found !== (item.expected ?? 0)
        ? 'divergent'
        : next.condition === 'damaged' || next.condition === 'broken'
          ? 'damaged'
          : 'ok';
  }
  if (item.mode === 'technical') next.answer ??= 'ok';
  return next;
}
export function executionResponses(
  items: Item[],
  saved: Record<string, Response>,
  locked: string[] = [],
) {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      locked.includes(item.id) && saved[item.id]
        ? saved[item.id]
        : itemResponse(item, saved[item.id]),
    ]),
  );
}
export function updateItemResponse(
  item: Item,
  previous: Response | undefined,
  patch: Partial<Response>,
) {
  const next = { ...itemResponse(item, previous), ...patch };
  if (
    patch.confirmed === undefined &&
    ['found', 'condition', 'answer'].some((key) => Object.hasOwn(patch, key))
  )
    next.confirmed = true;
  return itemResponse(item, next);
}
export const MAX_EXECUTION_PHOTOS = 8;

// Persiste antes de enviar; IDs estáveis permitem retomar sem duplicar fotos ou submissões.
export async function sendExecution(
  draft: Draft,
  dependencies: {
    persist: (draft: Draft) => Promise<void>;
    upload: (photo: ExecutionPhoto) => Promise<void>;
    submit: (draft: Draft) => Promise<unknown>;
    prepare?: (draft: Draft) => Promise<void>;
  },
) {
  const state = {
    ...draft,
    photos: (draft.photos ?? []).map((p) => ({ ...p })),
  };
  try {
    await dependencies.persist(state);
  } catch (error) {
    throw new OperationError(
      'DRAFT_SAVE',
      `Não foi possível preservar o rascunho antes do envio. ${describeError(error)}`,
    );
  }
  if (dependencies.prepare) {
    try {
      await dependencies.prepare(state);
      state.cancelledFiles = [];
      await dependencies.persist(state);
    } catch (error) {
      throw new OperationError(
        'EVIDENCE_QUEUE',
        `Não foi possível registrar a lista de arquivos esperados. ${describeError(error)}`,
      );
    }
  }
  for (const photo of state.photos) {
    if (photo.uploaded) continue;
    try {
      await dependencies.upload(photo);
    } catch (error) {
      throw new OperationError(
        'EXECUTION_FILE',
        `Evidência ${state.photos.indexOf(photo) + 1} de ${state.photos.length}, arquivo “${photo.file.name}”: ${describeError(error)}`,
      );
    }
    photo.uploaded = true;
    await dependencies.persist({
      ...state,
      photos: state.photos.map((p) => ({ ...p })),
    });
  }
  if (state.photos.some((photo) => !photo.uploaded))
    throw new OperationError(
      'PENDING_UPLOADS',
      'Ainda há arquivos sem confirmação. Aguarde o envio antes de concluir.',
    );
  try {
    await dependencies.submit(state);
  } catch (error) {
    throw new OperationError(
      'CHECKLIST_SUBMIT',
      `Os arquivos já foram recebidos, mas o checklist não foi enviado para aprovação. ${describeError(error)}`,
    );
  }
}

export function executionIssue(
  items: Item[],
  responses: Record<string, Response>,
  hasPhoto: boolean,
  locked: string[] = [],
): { itemId?: string; message: string } | null {
  for (const item of items) {
    if (locked.includes(item.id)) continue;
    const response = itemResponse(item, responses[item.id]);
    if (item.required && !response.confirmed)
      return { itemId: item.id, message: `Confira o item: ${item.title}.` };
    if (!response.confirmed) continue;
    if (
      item.mode === 'count' &&
      (!Number.isInteger(response.found) ||
        response.found! < 0 ||
        response.found! > 9999)
    )
      return {
        itemId: item.id,
        message: `${item.room} · ${item.title}: informe uma quantidade inteira entre 0 e 9999.`,
      };
    if (
      (response.condition === 'divergent' ||
        response.condition === 'damaged' ||
        response.answer === 'issue') &&
      (response.note?.trim().length ?? 0) < 5
    )
      return {
        itemId: item.id,
        message: `${item.room} · ${item.title}: descreva o problema em pelo menos 5 caracteres.`,
      };
  }
  if (items.some((i) => i.evidence_required) && !hasPhoto)
    return {
      message:
        'Adicione pelo menos uma foto ou vídeo da vistoria antes de enviar.',
    };
  return null;
}
