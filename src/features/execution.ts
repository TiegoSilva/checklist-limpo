import type { Item, Response } from '../domain';
import type { Draft, ExecutionPhoto } from '../lib/client';

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
  },
) {
  const state = {
    ...draft,
    photos: (draft.photos ?? []).map((p) => ({ ...p })),
  };
  await dependencies.persist(state);
  for (const photo of state.photos) {
    if (photo.uploaded) continue;
    await dependencies.upload(photo);
    photo.uploaded = true;
    await dependencies.persist({
      ...state,
      photos: state.photos.map((p) => ({ ...p })),
    });
  }
  await dependencies.submit(state);
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
        message: 'Informe uma quantidade inteira entre 0 e 9999.',
      };
    if (
      (response.condition === 'divergent' ||
        response.condition === 'damaged' ||
        response.answer === 'issue') &&
      (response.note?.trim().length ?? 0) < 5
    )
      return {
        itemId: item.id,
        message: 'Descreva o problema em pelo menos 5 caracteres.',
      };
  }
  if (items.some((i) => i.evidence_required) && !hasPhoto)
    return {
      message: 'Adicione pelo menos uma foto ou vídeo da vistoria antes de enviar.',
    };
  return null;
}
