export class OperationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OperationError';
  }
}
export function describeError(error: unknown) {
  if (error instanceof OperationError)
    return `${error.message} Código: ${error.code}.`;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (
    /413|entity.*large|exceeded.*size|maximum.*size|size.*exceed/i.test(message)
  )
    return 'O arquivo excede o limite permitido pelo armazenamento. Confira o limite global e o bucket no Supabase. Código: STORAGE_FILE_LIMIT.';
  if (
    /expected pattern|did not match|unexpected token|JSON|load failed|failed to fetch|networkerror/i.test(
      message,
    )
  )
    return 'Não foi possível interpretar a resposta ou conectar ao servidor. Verifique a conexão e tente novamente. Código: NETWORK_OR_RESPONSE.';
  if (/quota|storage.*full/i.test(message))
    return 'O armazenamento deste aparelho está cheio. Libere espaço e tente salvar novamente. Código: LOCAL_STORAGE_FULL.';
  if (/jwt|token.*expired|sessão inválida/i.test(message))
    return 'Sua sessão expirou. Salve o rascunho e entre novamente. Código: SESSION_EXPIRED.';
  return message || 'Não foi possível confirmar a operação. Tente novamente.';
}
export async function readApiResponse(response: globalThis.Response) {
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OperationError(
      `API_RESPONSE_${response.status}`,
      `O servidor retornou uma resposta inválida (HTTP ${response.status}). A API pode estar indisponível ou desatualizada. Nenhum envio foi confirmado.`,
    );
  }
  if (!response.ok)
    throw new OperationError(
      String(body.code ?? `API_HTTP_${response.status}`),
      typeof body.error === 'string'
        ? body.error
        : 'O servidor recusou a operação.',
    );
  return body;
}
