import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { MeshStatus } from "@core/Transport/LanRelayMeshTransport";

/**
 * Desktop-side companion panel: one join QR plus who is currently on the mesh.
 * Never rendered on a phone — the person holding the phone already joined.
 */

const METRO_PORT = 8081;

/**
 * Where Expo Go should point.
 *
 * Derived from whatever host is serving this page, because that is the same
 * laptop running Metro. A hardcoded URL goes stale the moment the network
 * changes — which is exactly what happens when you switch to a hotspot before
 * a demo.
 *
 * Override with VITE_JOIN_URL when running Metro somewhere else.
 */
function joinUrl(status: MeshStatus): string | null {
  const override = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_JOIN_URL;
  if (override) return override;

  // The relay reports the machine's real LAN address. Prefer it over
  // window.location, which reads "localhost" when the presenter opens the page
  // on the laptop itself — a QR pointing at localhost sends every phone to
  // itself and fails.
  const fromRelay = status.joinUrl;
  if (fromRelay) {
    try {
      return `exp://${new URL(fromRelay).hostname}:${METRO_PORT}`;
    } catch {
      // Fall through to the location-based guess.
    }
  }

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return null;
  }
  return `exp://${host}:${METRO_PORT}`;
}

export function JoinPanel({ status }: { status: MeshStatus }) {
  const [qr, setQr] = useState<string | null>(null);
  const url = joinUrl(status);

  useEffect(() => {
    if (url === null) {
      setQr(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 420,
      color: { dark: "#0b1c30", light: "#ffffff" },
    }).then((dataUrl) => {
      if (!cancelled) setQr(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <aside className="join-panel">
      <div>
        <p className="eyebrow">Common Thread</p>
        <h1>Riverside Estate</h1>
        <p className="join-copy">
          Offline-first mutual aid. Neighbours post requests, offers and updates
          on a local mesh — no accounts, no cloud, no internet.
        </p>
      </div>

      <div className="join-qr" aria-label="Join Common Thread">
        {qr ? (
          <img src={qr} alt="QR code to open Common Thread in Expo Go" />
        ) : (
          <span className="qr-placeholder" aria-hidden="true" />
        )}
        <span className="install-label">Scan to join</span>
        <span className="install-description">
          {url ?? "Open this page on the network address, not localhost"}
        </span>
      </div>

      <p className="join-hint">
        Join this phone&apos;s hotspot, then scan with the Camera app (iPhone) or
        Expo Go (Android). Expo Go must already be installed — there is no
        internet on the hotspot to download it.
      </p>

      <div className="join-peers">
        <h2>On the mesh</h2>
        {status.peers.length === 0 ? (
          <p className="join-hint">No other devices connected yet.</p>
        ) : (
          <ul>
            {status.peers.map((peer) => (
              <li key={peer.peerID}>
                <span className="dot" />
                {peer.displayName || peer.peerID}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="join-note">
        Messages pass phone to phone over the local mesh. Native builds use
        Bluetooth LE; this demo uses the local network, because Expo Go cannot
        load custom native code.
      </p>
    </aside>
  );
}
