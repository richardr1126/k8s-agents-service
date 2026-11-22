/** Structured console logging for the TTS code (OpenReader uses pino; console is enough here). */

type Fields = Record<string, unknown>;

export type TtsLogger = {
  info: (fields: Fields | string, msg?: string) => void;
  warn: (fields: Fields | string, msg?: string) => void;
  error: (fields: Fields | string, msg?: string) => void;
};

function line(level: "info" | "warn" | "error") {
  return (fields: Fields | string, msg?: string) => {
    const payload = typeof fields === "string" ? { msg: fields } : { ...fields, ...(msg ? { msg } : {}) };
    console[level](JSON.stringify({ scope: "tts", level, ...payload }));
  };
}

export const ttsLogger: TtsLogger = { info: line("info"), warn: line("warn"), error: line("error") };

export function errorToLog(error: unknown): { name?: string; message: string } {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}

export function logTtsError(
  logger: TtsLogger,
  input: { event: string; error: unknown; msg: string; context?: Fields; normalize?: { code?: string; errorClass?: string } },
): void {
  logger.error(
    {
      event: input.event,
      ...(input.context || {}),
      ...(input.normalize?.errorClass ? { errorClass: input.normalize.errorClass } : {}),
      error: errorToLog(input.error),
    },
    input.msg,
  );
}
