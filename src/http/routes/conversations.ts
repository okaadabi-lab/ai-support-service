import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { NotFoundError } from '../../errors.js';
import { conversationParamsSchema, handoffBodySchema } from '../schemas.js';
import { parseOrThrow } from '../validation.js';

export function registerConversationRoutes(app: FastifyInstance, container: Container): void {
  app.get('/v1/conversations/:id', { config: { scope: 'admin:read' } }, async (request) => {
    const { id } = parseOrThrow(conversationParamsSchema, request.params);
    const conversation = container.conversations.findById(id);
    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }
    const decisions = container.decisions.listByConversation(id);
    return {
      conversation: {
        id: conversation.id,
        channel: conversation.channel,
        customer_id: conversation.customerId,
        customer_name: conversation.customerName,
        status: conversation.status,
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
      },
      messages: container.messages.listByConversation(id).map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        external_message_id: message.externalMessageId,
        received_at: message.receivedAt,
        created_at: message.createdAt,
      })),
      decisions: decisions.map((decision) => ({
        id: decision.id,
        message_id: decision.messageId,
        action: decision.action,
        reply_text: decision.replyText,
        reasons: decision.reasons,
        intent: decision.intent,
        language: decision.language,
        classifier_source: decision.classifierSource,
        classifier_confidence: decision.classifierConfidence,
        answer_confidence: decision.answerConfidence,
        citations: decision.citations,
        retrieved: decision.retrieved,
        prompts: { classify: decision.classifyPrompt, answer: decision.answerPrompt },
        model: decision.model,
        tokens: { input: decision.inputTokens, output: decision.outputTokens },
        estimated_cost_usd: decision.estimatedCostUsd,
        latency_ms: decision.latencyMs,
        stage_latency_ms: decision.stageLatencies,
        created_at: decision.createdAt,
      })),
    };
  });

  app.post(
    '/v1/conversations/:id/handoff',
    { config: { scope: 'messages:write' } },
    async (request) => {
      const { id } = parseOrThrow(conversationParamsSchema, request.params);
      const { status } = parseOrThrow(handoffBodySchema, request.body);
      const conversation = container.conversations.setStatus(id, status);
      if (!conversation) {
        throw new NotFoundError('Conversation not found');
      }
      request.log.info({ conversationId: id, status }, 'conversation handoff');
      return {
        conversation_id: conversation.id,
        status: conversation.status,
        updated_at: conversation.updatedAt,
      };
    },
  );
}
