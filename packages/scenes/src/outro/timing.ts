/**
 * Seconds after the scene has entered before the command starts typing.
 * In its own file because the browser mount needs it, and the mount must not
 * import the definition (which imports the schema, and so zod).
 */
export const TYPE_DELAY_SECONDS = 0.3;
