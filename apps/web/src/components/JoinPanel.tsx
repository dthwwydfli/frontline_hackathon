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
function joinUrl(): string {
  const override = import.meta.env.VITE_JOIN_URL as string | undefined;
  if (override) return override;
  return `exp://${window.location.hostname}:${METRO_PORT}`;
}

export function JoinPanel({ status }: { status: MeshStatus }) {
  const [qr, setQr] = useState<string | null>(null);
  const url = joinUrl();

  useEffect(() => {
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
        <span className="install-description">{url}</span>
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
