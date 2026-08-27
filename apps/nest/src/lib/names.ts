import { normalize } from "robin-names";

/** `dallas`, `dallas.robin`, `bot1.goldfinch.robin` → normalized full name. */
export function toFullName(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    return normalize(
      trimmed.endsWith(".robin") ? trimmed : `${trimmed}.robin`,
    );
  } catch {
    return null;
  }
}
