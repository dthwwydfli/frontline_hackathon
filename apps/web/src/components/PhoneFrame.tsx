import { type ReactElement, useEffect, useState } from "react";
import {
  BatteryFull as BatteryFullIcon,
  Signal as SignalIcon,
  Wifi as WifiIcon,
  type LucideProps,
} from "lucide-react";

export const OVERLAY_ID = "phone-overlay";

type IconComponent = (props: LucideProps) => ReactElement;

const BatteryFull = BatteryFullIcon as IconComponent;
const Signal = SignalIcon as IconComponent;
const Wifi = WifiIcon as IconComponent;

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Device chrome for the presentation view.
 *
 * The bezel, island and status bar are decorative and desktop-only — on a real
 * phone the app runs full-bleed inside the safe area, because drawing a phone
 * inside a phone wastes the screen and reads as broken.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  const time = useClock();
  return (
    <div className="device">
      <div className="device-screen">
        <div className="status-bar" aria-hidden="true">
          <span className="status-time">{time}</span>
          <span className="dynamic-island" />
          <span className="status-icons">
            <Signal size={14} />
            <Wifi size={14} />
            <BatteryFull size={16} />
          </span>
        </div>
        {children}
        {/* Sheets portal in here so they cover the whole screen instead of
            being clipped by whichever view is currently scrolling. */}
        <div className="phone-overlay" id={OVERLAY_ID} />
        <div className="home-indicator" aria-hidden="true" />
      </div>
    </div>
  );
}
