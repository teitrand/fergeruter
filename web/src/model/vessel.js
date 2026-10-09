/** Kva ferje og telefonnummer som gjeld, som vesselNameForTable/signalPhone i assets/app.js. */
import {
  activeMode,
  defaultVesselName,
  messageMode,
  messageVessel,
  resolveRoutePlan,
} from "../../../packages/core/index.js";

const DEFAULT_VESSELS = [
  { name: "M/F Geiranger", phone: "916 69 321" },
  { name: "M/F Kvernes", phone: "916 69 340" },
];

export function vesselNameForTable(table, ctx) {
  const plan = resolveRoutePlan(ctx.messages, ctx.nowMs, ctx.date);
  const fromMsg = messageVessel(plan.message);
  const after = plan.switch?.after || plan.mode;
  const before = plan.switch?.before;
  if (fromMsg) {
    if (plan.switch) {
      if (table === after) return fromMsg;
      if (table === before) return defaultVesselName(before);
    } else if (messageMode(plan.message) === table || plan.mode === table) {
      return fromMsg;
    }
  }
  return defaultVesselName(table);
}

export function vesselInfo(name, ctx) {
  const vessels = ctx.kombirute?.vessels || DEFAULT_VESSELS;
  if (!name) return null;
  return (
    vessels.find((item) => item.name.toLowerCase().includes(name.toLowerCase())) || {
      name: `M/F ${name}`,
      phone: null,
    }
  );
}

/** Telefon til ferja som køyrer turen, elles nummeret frå rutetabellen. */
export function signalPhone(leg, ctx) {
  const table = leg?.table || activeMode(ctx);
  const running = vesselInfo(vesselNameForTable(table, ctx), ctx);
  if (running?.phone) return running.phone;
  if (leg?.signal?.phone) return leg.signal.phone;
  if (table === "1135") return vesselInfo("Geiranger", ctx)?.phone || "916 69 321";
  if (table === "kombi") return "";
  return vesselInfo("Kvernes", ctx)?.phone || "916 69 340";
}
