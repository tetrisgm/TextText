/** File-incarnation facts. An observed absence is supplied only by a native
 * owner after authenticated manifest/pack and incorporated-baseline checks.
 * Parsing this value does not establish that authority. */
export type MirrorGeneration =
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "observed-absent" }>
  | Readonly<{ kind: "present"; generation: string }>;

export function validateMirrorGeneration(input: unknown): MirrorGeneration {
  const invalid = (): never => { throw Error("Invalid mirror generation"); };
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).some(key => typeof key !== "string") ||
      Object.values(fields).some(field => !("value" in field))) return invalid();
  const kind = fields.kind?.value;
  if (kind === "unknown" || kind === "observed-absent") {
    if (Object.keys(fields).length !== 1) return invalid();
    return Object.freeze({ kind });
  }
  if (kind !== "present" || Object.keys(fields).length !== 2 || !fields.generation) return invalid();
  const generation = fields.generation.value;
  if (typeof generation !== "string" || generation.length === 0 ||
      new TextEncoder().encode(generation).length > 512 || /[\x00-\x1f\x7f]/.test(generation) ||
      Array.from(generation).some(c => { const n = c.codePointAt(0)!; return n >= 0xd800 && n <= 0xdfff; })) return invalid();
  return Object.freeze({ kind: "present", generation });
}

/** Unknown never equals unknown for admission. No token or generation is
 * invented for files whose authenticated lifecycle marker is absent. */
export function sameMirrorGeneration(left: unknown, right: unknown): boolean {
  const a = validateMirrorGeneration(left), b = validateMirrorGeneration(right);
  if (a.kind === "unknown" || b.kind === "unknown" || a.kind !== b.kind) return false;
  return a.kind === "observed-absent" || b.kind === "present" && a.generation === b.generation;
}

export function legacyMirrorGeneration(value: string | null): MirrorGeneration {
  return value === null ? { kind: "unknown" } : validateMirrorGeneration({ kind: "present", generation: value });
}

export function validateMirrorGenerationFacts<K extends string>(input: unknown, legacy: Record<K, string | null>): Record<K, MirrorGeneration> {
  const invalid = (): never => { throw Error("Invalid mirror generation facts"); };
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Object.keys(legacy) as K[];
  if (Reflect.ownKeys(input).length !== keys.length || keys.some(key => !(key in descriptors) || !("value" in descriptors[key]))) return invalid();
  const result = {} as Record<K, MirrorGeneration>;
  for (const key of keys) {
    const value = validateMirrorGeneration(descriptors[key].value);
    if (value.kind === "present" ? legacy[key] !== value.generation : legacy[key] !== null) return invalid();
    result[key] = value;
  }
  return Object.freeze(result);
}
