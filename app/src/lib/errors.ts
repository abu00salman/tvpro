/** User-facing error codes. The UI maps each code to a translated, human sentence. */
export type AppErrorCode =
  | 'invalid-url'
  | 'blocked-host'
  | 'insecure-source'
  | 'network'
  | 'auth'
  | 'empty'
  | 'too-large'
  | 'unknown';

export class AppError extends Error {
  constructor(public readonly code: AppErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'AppError';
  }
}

export const toAppError = (e: unknown): AppError =>
  e instanceof AppError ? e : new AppError('unknown', e instanceof Error ? e.message : String(e));
