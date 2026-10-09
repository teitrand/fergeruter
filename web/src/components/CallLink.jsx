import { telHref } from "../../../packages/core/index.js";
import { useTrack } from "./track.js";

/**
 * Ringelenkje til ferja. Sender «Call ferry» med `how` (tag, note, detail, footer),
 * som bindTelLink() i vanilla-appen.
 */
export function CallLink({ phone, how, children, ...props }) {
  const track = useTrack();
  return (
    <a {...props} href={telHref(phone)} onClick={() => track("Call ferry", { how })}>
      {children}
    </a>
  );
}
