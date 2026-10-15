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
  return itemResponse(item, { ...itemResponse(item, previous), ...patch });
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
