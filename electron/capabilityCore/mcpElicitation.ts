export type BooleanElicitationInput = {
  message: string
  title: string
  description: string
  meta?: Record<string, unknown>
}

export function buildBooleanElicitationParams(input: BooleanElicitationInput): Record<string, unknown> {
  return {
    message: input.message,
    ...(input.meta ? { _meta: input.meta } : {}),
    requestedSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', title: input.title, description: input.description },
      },
      required: ['confirm'],
    },
  }
}
