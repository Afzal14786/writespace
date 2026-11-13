import type { Server as HttpServer } from "node:http";

import jwt from "jsonwebtoken";
import { Server as SocketIOServer } from "socket.io";

import env from "@config/env";
import logger from "@config/logger";

import type { IJwtPayload } from "@modules/auth/interface/auth.interface";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import type { NotificationInboxService } from "../services/notification-inbox.service";

type AuthenticatedSocketUser = IJwtPayload & {
  role: "user" | "admin";
};

/**
 * No client-to-server or inter-server events are currently supported.
 * Add explicit event contracts here when those features are introduced.
 */
type NoSocketEvents = Record<string, (...args: unknown[]) => void>;

type RealtimeNotificationPayload = Awaited<
  ReturnType<NotificationInboxService["getNotification"]>
>;

interface NotificationServerToClientEvents {
  "notification.connection.ready": (payload: { syncRequired: true }) => void;

  "notification.created": (payload: {
    notification: RealtimeNotificationPayload;
  }) => void;

  "notification.updated": (payload: {
    notification: RealtimeNotificationPayload;
  }) => void;

  "notification.unread-count.updated": (payload: {
    unreadCount: number;
  }) => void;
}

interface NotificationSocketData {
  authenticatedUser: AuthenticatedSocketUser;
}

type NotificationSocketServer = SocketIOServer<
  NoSocketEvents,
  NotificationServerToClientEvents,
  NoSocketEvents,
  NotificationSocketData
>;

/**
 * Extract an access token from untrusted Socket.IO handshake data.
 */
function getHandshakeAccessToken(auth: unknown): string | null {
  if (typeof auth !== "object" || auth === null || !("token" in auth)) {
    return null;
  }

  const token = auth.token;

  if (typeof token !== "string" || !token.trim()) {
    return null;
  }

  return token;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate the access-token payload using the same rules as the
 * existing Express authentication middleware.
 */
function isValidSocketJwtPayload(
  payload: unknown,
): payload is AuthenticatedSocketUser {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const data = payload as Record<string, unknown>;

  return (
    typeof data.id === "string" &&
    UUID_REGEX.test(data.id) &&
    (data.role === "user" || data.role === "admin")
  );
}

let activeSocketServer: NotificationSocketServer | null = null;

/**
 * Build the private room name from an authenticated recipient ID.
 *
 * Both connection handling and delivery handlers must use this helper
 * to keep room naming consistent.
 */
export function getNotificationUserRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Initialize the notification Socket.IO server on the existing HTTP server.
 *
 * Authentication happens before the connection is accepted. Each accepted
 * connection is assigned to a private room derived from its verified user ID.
 */
export function initializeNotificationSocketServer(
  httpServer: HttpServer,
): NotificationSocketServer {
  if (activeSocketServer) {
    throw new AppError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Notification Socket.IO server is already initialized.",
    );
  }

  const io: NotificationSocketServer = new SocketIOServer<
    NoSocketEvents,
    NotificationServerToClientEvents,
    NoSocketEvents,
    NotificationSocketData
  >(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      credentials: true,
    },
  });

  // Reject unauthenticated or invalid connections before accepting them.
  io.use((socket, next) => {
    const token = getHandshakeAccessToken(socket.handshake.auth as unknown);

    if (!token) {
      return next(
        new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          "No token provided, authorization denied.",
        ),
      );
    }

    let decoded: string | jwt.JwtPayload;

    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        algorithms: ["HS256"],
      });
    } catch {
      return next(
        new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          "Invalid or expired access token.",
        ),
      );
    }

    if (!isValidSocketJwtPayload(decoded)) {
      return next(
        new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid access token payload."),
      );
    }

    // Store only the verified identity, never the access token.
    socket.data.authenticatedUser = {
      id: decoded.id,
      role: decoded.role,
    };

    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.authenticatedUser;

    // The room is derived exclusively from the verified JWT identity.
    const userRoom = getNotificationUserRoom(user.id);

    void (async () => {
      try {
        await socket.join(userRoom);

        // REST remains authoritative; the client must sync after connecting.
        socket.emit("notification.connection.ready", {
          syncRequired: true,
        });

        logger.info("Notification socket connected", {
          userId: user.id,
          socketId: socket.id,
        });
      } catch (error) {
        logger.error("Failed to initialize notification socket connection", {
          userId: user.id,
          socketId: socket.id,
          error,
        });

        socket.disconnect(true);
      }
    })();

    socket.on("disconnect", (reason) => {
      logger.debug("Notification socket disconnected", {
        userId: user.id,
        socketId: socket.id,
        reason,
      });
    });
  });

  activeSocketServer = io;

  logger.info("Notification Socket.IO server initialized");

  return io;
}

/**
 * Provide the initialized server to channel handlers in this process.
 *
 * Access before server initialization is a programming/configuration error.
 */
export function getNotificationSocketServer(): NotificationSocketServer {
  if (!activeSocketServer) {
    throw new AppError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Notification Socket.IO server is not initialized.",
    );
  }

  return activeSocketServer;
}
