import type { InteractionEventInput } from "../contracts/interaction-event.types";
import { interactionEventRepository } from "../repositories/interaction-event.repository";

export class InteractionEventPublisher {
  /**
   * Persists an interaction event directly in PostgreSQL.
   *
   * This is a synchronous database operation, not a BullMQ job.
   * Events are retained for historical queries and future analytics.
   *
   * The originating feature handles persistence failures as best-effort
   * side effects after its primary database operation has committed.
   */
  async publish(input: InteractionEventInput) {
    const event = await interactionEventRepository.createEvent(input);

    if (!event) {
      throw new Error("Failed to create interaction event");
    }

    return event;
  }
}

export const interactionEventPublisher = new InteractionEventPublisher();
