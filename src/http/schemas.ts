import { z } from 'zod';

const identifier = z.string().trim().min(1).max(128);

export const incomingMessageSchema = z.object({
  channel: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_-]{1,31}$/, 'lowercase channel name, e.g. whatsapp'),
  external_message_id: identifier,
  customer_id: identifier,
  customer_name: z.string().trim().min(1).max(120).optional(),
  text: z.string().trim().min(1).max(4000),
  received_at: z.iso.datetime({ offset: true }),
});

export const conversationParamsSchema = z.object({
  id: z.uuid(),
});

export const handoffBodySchema = z.object({
  status: z.enum(['human', 'bot']),
});

export const metricsQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .transform((query, context) => {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (from >= to) {
      context.addIssue({
        code: 'custom',
        message: '"from" must be earlier than "to"',
        path: ['from'],
      });
      return z.NEVER;
    }
    return { from: from.toISOString(), to: to.toISOString() };
  });
