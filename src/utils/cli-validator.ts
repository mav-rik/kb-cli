import { defineErrorInterceptor, definePipeFn, TPipePriority } from 'moost'
import { isAnnotatedType, ValidatorError, type TValidatorOptions } from '@atscript/typescript/utils'

// Like @atscript/moost-validator's validatorPipe, but skips when the param is
// marked @Optional and the supplied value is undefined. CLI flags resolve to
// `undefined` when absent, and a primitive type alias like `WikiName` has no
// "optional" property of its own — its top-level validator would reject
// undefined. Pairing the pipe with the @Optional mate flag gives us "validate
// the value if present" semantics on every flag/option.
export const cliValidatorPipe = (opts?: Partial<TValidatorOptions>) =>
  definePipeFn((value, metas) => {
    const type = metas?.targetMeta?.type
    if (metas?.targetMeta?.optional && (value === undefined || value === null)) return value
    if (isAnnotatedType(type) && typeof type.validator === 'function') {
      type.validator(opts).validate(value)
    }
    return value
  }, TPipePriority.VALIDATE)

// CLI counterpart to @atscript/moost-validator's validationErrorTransform.
// The HTTP one wraps in HttpError (carrying status + body); on CLI we wrap
// in a plain Error whose `.message` is the joined field paths — wooks-cli's
// adapter reads `.message` to print "ERROR: <msg>" and exits 1. Without an
// Error wrapper, wooks crashes on `undefined.message`.
export const cliValidationErrorTransform = () =>
  defineErrorInterceptor((err, reply) => {
    if (err instanceof ValidatorError) {
      const msg = err.errors
        .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
        .join('\n')
      // Skip Error's constructor: it captures a V8 stack trace we don't need.
      // wooks-cli only reads `.message`; `instanceof Error` still holds.
      const out = Object.create(Error.prototype) as Error
      out.message = msg
      reply(out)
    }
  })
