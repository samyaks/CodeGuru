type ErrorJson = { error?: string; code?: string };

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string = 'UNKNOWN') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function handleApiResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      error: 'Request failed',
      code: 'UNKNOWN',
    }))) as ErrorJson;
    throw new ApiError(body.error || 'Request failed', res.status, body.code || 'UNKNOWN');
  }
  return res.json() as Promise<T>;
}
