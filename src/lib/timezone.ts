export const TIMEZONE = "America/Sao_Paulo";

/** Data de hoje (YYYY-MM-DD) no fuso de Brasília, não no fuso do servidor. */
export function hojeBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Formata uma data/hora (ISO ou Date) no fuso de Brasília, independente de onde o código roda. */
export function formatDateTimeBrasilia(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("pt-BR", { timeZone: TIMEZONE });
}

/** Timestamp compacto (AAAA-MM-DD-HHmm) no fuso de Brasília, pra nomes de arquivo. */
export function stampBrasilia(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}-${get("hour")}${get("minute")}`;
}
