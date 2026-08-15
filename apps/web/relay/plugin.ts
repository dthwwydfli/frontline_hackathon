import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
// Imported from the built package, not source: this file is bundled by Vite's
// own config loader, where the `@core` source alias is not yet in effect.
import { RelayHub } from "@common-thread/core";

export const RELAY_PATH = "/ct-mesh";

/** First non-internal IPv4 address — the one a phone on the hotspot can reach. */
export function lanAddress(): string | undefined {
  return lanCandidates()[0]?.address;
}

export interface LanCandidate {
  name: string;
  address: string;
  /** CIDR prefix length, e.g. 24. Undefined when the OS did not report one. */
  prefix?: number;
}

export function lanCandidates(): LanCandidate[] {
  const out: LanCandidate[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }
      out.push({
        name,
        address: address.address,
        prefix: address.cidr
          ? Number(address.cidr.split("/")[1])
          : undefined,
      });
    }
  }
  return out;
}

/**
 * A hotspot hands out a small private range (/24 or tighter). A wide subnet
 * means a managed router, and managed Wi-Fi almost always enables client
 * isolation — which silently blocks phone → laptop, the exact failure that
 * looks like "couldn't connect to server" on a scanned QR.
 */
export function looksManaged(candidate: LanCandidate | undefined): boolean {
  return candidate?.prefix !== undefined && candidate.prefix < 24;
}

/**
 * Runs the LAN mesh relay on Vite's own HTTP server.
 *
 * One process, one port, one URL for the QR code — a separate relay server
 * would be a second thing to fail in front of an audience.
 */
export function commonThreadRelay(): Plugin {
  const hub = new RelayHub();
  let joinUrl: string | undefined;

  const attach = (server: ViteDevServer | PreviewServer) => {
    const httpServer = server.httpServer;
    if (!httpServer) {
      return;
    }

    const wss = new WebSocketServer({ noServer: true });

    httpServer.on(
      "upgrade",
      (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        // Anything else (notably Vite's own HMR socket) is left alone.
        if (!request.url?.startsWith(RELAY_PATH)) {
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      },
    );

    wss.on("connection", (ws: WebSocket) => {
      const relaySocket = {
        send: (data: string) => ws.send(data),
        close: () => ws.close(),
      };
      hub.connect(relaySocket);
      ws.on("message", (data) => hub.handleMessage(relaySocket, data));
      ws.on("close", () => hub.disconnect(relaySocket));
      ws.on("error", () => hub.disconnect(relaySocket));
    });

    const announce = () => {
      const address = httpServer.address();
      const port =
        typeof address === "object" && address ? address.port : undefined;
      const candidates = lanCandidates();
      const primary = candidates[0];
      if (!primary || !port) {
        server.config.logger.warn(
          "\n  Common Thread relay: no reachable LAN interface. " +
            "Start a hotspot, then restart.\n",
        );
        return;
      }
      joinUrl = `http://${primary.address}:${port}`;
      hub.setJoinUrl(joinUrl);
      server.config.logger.info("\n  Common Thread mesh relay ready\n");

      if (candidates.length > 1) {
        server.config.logger.info(
          `  Other interfaces: ${candidates
            .slice(1)
            .map((c) => `${c.name} http://${c.address}:${port}`)
            .join(", ")}\n`,
        );
      }

      if (looksManaged(primary)) {
        server.config.logger.warn(
          `  Heads up: ${primary.name} is on a /${primary.prefix} managed network.\n` +
            "  Managed Wi-Fi usually blocks device-to-device traffic (client\n" +
            "  isolation), so phones will fail with \"couldn't connect to server\".\n" +
            "  Use a phone hotspot or laptop Internet Sharing instead.\n",
        );
      }
    };

    if (httpServer.listening) {
      announce();
    } else {
      httpServer.on("listening", announce);
    }
  };

  return {
    name: "common-thread-relay",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
