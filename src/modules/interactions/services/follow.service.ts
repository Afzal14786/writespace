import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import logger from "@config/logger";

import { notificationService } from "@modules/notification/notification.service";

import type {
  FollowResult,
  FollowUserInput,
  UnfollowUserInput,
} from "../contracts/follow.types";

import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";

import { followRepository } from "../repositories/follow.repository";

export class FollowService {
  /**
   * Verifies that the target account exists before modifying
   * the follow relationship.
   */
  private async ensureTargetUserExists(targetUserId: string): Promise<void> {
    const exists = await followRepository.userExists(targetUserId);

    if (!exists) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }
  }

  /**
   * Handles side effects after a follow relationship has been committed.
   *
   * Notification and interaction-event failures must not undo a successful
   * database operation or turn it into a failed API response.
   */
  private async handleFollowCreated(
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    // Notification and interaction-event handling are independent.
    try {
      await notificationService.sendFollowNotification(targetUserId, actorId);
    } catch (error) {
      logger.error("Failed to enqueue follow notification", {
        actorId,
        targetUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const event = interactionEventMapper.mapFollowEvent("follow.created", {
        actorId,
        targetUserId,
      });

      await interactionEventPublisher.publish(event);
    } catch (error) {
      logger.error("Failed to publish follow.created event", {
        actorId,
        targetUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Records the removal of a follow relationship after the transaction commits.
   */
  private async handleFollowRemoved(
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    try {
      const event = interactionEventMapper.mapFollowEvent("follow.removed", {
        actorId,
        targetUserId,
      });

      await interactionEventPublisher.publish(event);
    } catch (error) {
      logger.error("Failed to publish follow.removed event", {
        actorId,
        targetUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async followUser(input: FollowUserInput): Promise<FollowResult> {
    const { actorId, targetUserId } = input;

    if (actorId === targetUserId) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "You cannot follow yourself");
    }

    await this.ensureTargetUserExists(targetUserId);

    const follow = await followRepository.createFollow(actorId, targetUserId);

    /*
     * Idempotent operation:
     * the user was already following the target.
     *
     * No state changed, so no interaction event or notification
     * should be generated.
     */
    if (!follow) {
      return {
        followerId: actorId,
        followingId: targetUserId,
        isFollowing: true,
      };
    }

    await this.handleFollowCreated(actorId, targetUserId);

    return {
      followerId: follow.followerId,
      followingId: follow.followingId,
      isFollowing: true,
    };
  }

  async unfollowUser(input: UnfollowUserInput): Promise<FollowResult> {
    const { actorId, targetUserId } = input;

    if (actorId === targetUserId) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "You cannot unfollow yourself",
      );
    }

    await this.ensureTargetUserExists(targetUserId);

    const follow = await followRepository.deleteFollow(actorId, targetUserId);

    /*
     * No existing follow means no state changed.
     * Therefore no follow.removed event is created.
     */
    if (!follow) {
      return {
        followerId: actorId,
        followingId: targetUserId,
        isFollowing: false,
      };
    }

    await this.handleFollowRemoved(actorId, targetUserId);

    return {
      followerId: follow.followerId,
      followingId: follow.followingId,
      isFollowing: false,
    };
  }

  /**
   * Backward compatibility for the old POST /users/:id/follow endpoint.
   *
   * New API clients should use the explicit follow and unfollow endpoints.
   *
   * The repository performs the toggle atomically, preventing concurrent
   * requests from both reading the same relationship state before writing.
   */
  async toggleFollow(
    input: FollowUserInput,
  ): Promise<{ status: "followed" | "unfollowed" }> {
    const { actorId, targetUserId } = input;

    if (actorId === targetUserId) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "You cannot follow yourself");
    }

    await this.ensureTargetUserExists(targetUserId);

    const result = await followRepository.toggleFollow(actorId, targetUserId);

    /*
     * A conflicting writer may have changed nothing through this operation.
     * Return the current state without duplicating notifications or events.
     */
    if (!result.changed) {
      return {
        status: result.isFollowing ? "followed" : "unfollowed",
      };
    }

    if (result.isFollowing) {
      await this.handleFollowCreated(actorId, targetUserId);

      return { status: "followed" };
    }

    await this.handleFollowRemoved(actorId, targetUserId);

    return { status: "unfollowed" };
  }

  async isFollowing(
    followerId: string,
    followingId: string,
  ): Promise<boolean> {
    return followRepository.isFollowing(followerId, followingId);
  }
}

export const followService = new FollowService();
