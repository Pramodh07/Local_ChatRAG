export type ParseFailure = {
  ok: false;
  message: string;
  status: 400 | 403 | 413;
};

export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

export function parseOk<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function parseFailed(
  message: string,
  status: ParseFailure["status"] = 400,
): ParseFailure {
  return { ok: false, message, status };
}
