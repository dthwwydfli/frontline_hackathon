import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { MeshStatus } from "@core/Transport/LanRelayMeshTransport";

/**
 * Desktop-side companion panel: install QRs plus who is currently on the mesh.
 * Never rendered on a phone — the person holding the phone already joined.
 */
const installTargets = [
  {
    id: "android",
    label: "Android",
    description: "Scan to install the APK",
    url: "https://expo.dev/artifacts/eas/ce6Su_9j5U5lcoe7L3TkuYYuG8QLWwIA3f2qLhzYhVg.apk",
  },
  {
    id: "ios",
    label: "iOS",
    description: "Open in Expo Go",
    url: "exp://2373ut0-dthwwydfli-8082.exp.direct",
  },
] as const;

export function JoinPanel({ status }: { status: MeshStatus }) {
  const [qrs, setQrs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      installTargets.map(async (target) => [
        target.id,
        await QRCode.toDataURL(target.url, {
          margin: 1,
          width: 320,
          color: { dark: "#0b1f1d", light: "#ffffff" },
        }),
      ]),
    ).then((entries) => {
      if (!cancelled) {
        setQrs(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

      <div className="install-grid" aria-label="Install Common Thread">
        {installTargets.map((target) => (
          <a
            className="install-card"
            href={target.url}
            key={target.id}
            rel="noreferrer"
            target="_blank"
          >
            {qrs[target.id] ? (
              <img
                src={qrs[target.id]}
                alt={`QR code for ${target.label} ${target.description}`}
              />
            ) : (
              <span className="qr-placeholder" aria-hidden="true" />
            )}
            <span className="install-label">{target.label}</span>
            <span className="install-description">{target.description}</span>
          </a>
        ))}
      </div>

      <p className="join-hint">
        iPhone needs Expo Go and this laptop running the native Expo server.
        Android installs the APK directly.
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
        Native builds use the BLE mesh. This screen no longer shares a local
        browser URL.
      </p>
    </aside>
  );
}
