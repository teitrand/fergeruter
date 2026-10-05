const DISPATCH_URL =
  "https://api.github.com/repos/teitrand/fergeruter/actions/workflows/log-signalturar.yml/dispatches";

export async function dispatchWorkflow({
  token,
  fetchImpl = fetch,
  log = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 3,
} = {}) {
  if (!token) {
    log("Manglar GITHUB_TOKEN. Køyr: npx wrangler secret put GITHUB_TOKEN");
    return false;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(DISPATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "fergeruter-signaltur-cron",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      });
      if (response.status === 204) {
        log(`Starta log-signalturar på main (forsøk ${attempt}).`);
        return true;
      }
      let detail = "";
      try {
        detail = typeof response.text === "function" ? await response.text() : "";
      } catch {
        detail = "";
      }
      log(`Dispatch svarte ${response.status} (forsøk ${attempt}). ${detail}`.trim());
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      log(`Dispatch feila (forsøk ${attempt}): ${message}`);
    }
    if (attempt < attempts) {
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    }
  }
  return false;
}

export default {
  async scheduled(event, env) {
    const cron = event && event.cron ? event.cron : "";
    console.log(`Cron ${cron} startar log-signalturar.`);
    const ok = await dispatchWorkflow({ token: env && env.GITHUB_TOKEN });
    if (!ok) {
      throw new Error("Fekk ikkje starta log-signalturar.");
    }
  },
};
