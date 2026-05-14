import { ValidatorError, type Validator, type TValidatorOptions } from '@atscript/typescript/utils'

/**
 * Atscript-annotated type contract used by `.validator()`-bearing DTOs.
 * Both .as interfaces (compiled to classes) and .as type aliases (compiled
 * to declared namespaces) expose a static `validator()` factory; this is
 * the minimal shape that covers both.
 */
interface AnnotatedTypeLike {
  validator: (opts?: Partial<TValidatorOptions>) => Validator<unknown>
}

/**
 * Run the shared (HTTP + CLI) DTO validator over a value. Returns a
 * formatted multi-line error string on failure, null on success. Uses
 * `unknownProps: 'ignore'` so callers can pass slightly-wider shapes
 * (e.g. `DocInput` against `AddDocBody`) without spurious failures.
 *
 * Same error formatter on every CLI command — drifting between commands
 * is exactly what the atscript DTO refactor was meant to prevent.
 */
export function validateAgainstDto<T>(dto: AnnotatedTypeLike, value: T): string | null {
  const v = dto.validator({ unknownProps: 'ignore', errorLimit: 20 })
  try {
    v.validate(value)
    return null
  } catch (err) {
    if (err instanceof ValidatorError) {
      return err.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('\n')
    }
    throw err
  }
}
