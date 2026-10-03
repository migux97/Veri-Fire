import type { ApiErrorBody } from '../types';

export class ApiError extends Error {
  readonly status: number;
  // The server said the same request may work later (for example, a product still being registered on Solana).
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

const isErrorBody = (value: unknown): value is Partial<ApiErrorBody> => typeof value === 'object' && value !== null;

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) throw new ApiError(`El servidor respondió vacío (${response.status}).`, response.status);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(`El servidor respondió con un formato inválido (${response.status}).`, response.status);
  }
};

const requestJson = async <T>(url: string, init: RequestInit | undefined, fallbackError: string): Promise<T> => {
  const response = await fetch(url, init);
  const data = await readBody(response);
  if (!response.ok) {
    const body = isErrorBody(data) ? data : {};
    throw new ApiError(body.error || fallbackError, response.status, Boolean(body.retryable));
  }
  return data as T;
};

export const getJson = <T>(url: string, fallbackError: string) => requestJson<T>(url, undefined, fallbackError);

export const postJson = <T>(url: string, body: unknown, fallbackError: string) =>
  requestJson<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fallbackError);
