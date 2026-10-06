const REPO = "https://api.github.com/repos/teitrand/fergeruter";
const DISPATCH_URL =
  "https://api.github.com/repos/teitrand/fergeruter/actions/workflows/log-signalturar.yml/dispatches";
const RUNS_URL = `${REPO}/actions/workflows/log-signalturar.yml/runs?per_page=5`;

// GitHub gjev opp etter om lag 15 minutt og merkjer workflowen failure
// («not acquired by Runner of type hosted») sjølv om ingen steg køyrde.
// 12 minutt er etter den tregaste køyringa som likevel fekk runner
// (om lag 10 minutt 5. okt 2026) og før den grensa. Veggtida på cron er 15 minutt.
export const RUNNER_GIVE_UP_MS = 12 * 60 * 1000;
export const FIRST_CHECK_MS = 15 * 1000;
const AFTER_CANCEL_MS = 2 * 1000;

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "fergeruter-signaltur-cron",
    "Content-Type": "application/json",
  };
}

async function readJson(response) {
  if (!response || typeof response.json !== "function") return {};
  try {
    return await response.json();
  } catch {
    return {};
  }
}

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
        headers: headers(token),
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

function jobHasRunner(job) {
  if (!job) return false;
  if (job.runner_id) return true;
  return (job.steps || []).length > 0;
}

export function classifyRun(run, jobs) {
  const acquired = (jobs || []).some(jobHasRunner);
  if (run && run.status === "completed") {
    if (run.conclusion === "success") return "success";
    // Steg har køyrt: ekte feil i loggen, ikkje ein runner som aldri kom.
    if (acquired) return "failed";
    return "poisoned";
  }
  if (acquired) return "acquired";
  return "waiting";
}

function pickRun(runs, sinceMs) {
  const fresh = (runs || []).filter((run) => {
    if (!run || run.event !== "workflow_dispatch") return false;
    const created = Date.parse(run.created_at || "");
    return Number.isFinite(created) && created >= sinceMs - 15000;
  });
  fresh.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return fresh.find((run) => run.status !== "completed") || fresh[0] || null;
}

async function github(fetchImpl, token, url, method = "GET") {
  const response = await fetchImpl(url, { method, headers: headers(token) });
  return response;
}

async function loadRun(fetchImpl, token, sinceMs) {
  const response = await github(fetchImpl, token, RUNS_URL);
  const body = await readJson(response);
  if (response.status !== 200) {
    throw new Error(`Klarte ikkje lese køyringar (${response.status}).`);
  }
  return pickRun(body.workflow_runs, sinceMs);
}

async function loadJobs(fetchImpl, token, runId) {
  const response = await github(fetchImpl, token, `${REPO}/actions/runs/${runId}/jobs`);
  const body = await readJson(response);
  if (response.status !== 200) {
    throw new Error(`Klarte ikkje lese jobbar (${response.status}).`);
  }
  return body.jobs || [];
}

async function cancelRun(fetchImpl, token, runId) {
  const response = await github(fetchImpl, token, `${REPO}/actions/runs/${runId}/cancel`, "POST");
  if (response.status !== 202 && response.status !== 204 && response.status !== 409) {
    throw new Error(`Klarte ikkje avbryte køyring ${runId} (${response.status}).`);
  }
}

async function rerunWorkflow(fetchImpl, token, runId, sleep, log) {
  // Avbrot svarar 202 før køyringa er ferdig. Rerun feilar til ho er det.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await github(fetchImpl, token, `${REPO}/actions/runs/${runId}/rerun`, "POST");
    if (response.status === 201) {
      log(`Starta køyring ${runId} på nytt (forsøk ${attempt}).`);
      return true;
    }
    log(`Rerun svarte ${response.status} (forsøk ${attempt}).`);
    if (attempt < 5) await sleep(Math.min(2000 * attempt, 8000));
  }
  return false;
}

async function sleepUntil(sleep, now, target) {
  const wait = target - now();
  if (wait > 0) await sleep(wait);
}

export async function recoverUnacquiredRun({
  token,
  fetchImpl = fetch,
  log = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  startedAtMs,
  firstCheckMs = FIRST_CHECK_MS,
  giveUpMs = RUNNER_GIVE_UP_MS,
} = {}) {
  if (!token) return false;
  const sinceMs = startedAtMs;
  await sleepUntil(sleep, now, sinceMs + firstCheckMs);

  let run = await loadRun(fetchImpl, token, sinceMs);
  if (!run) {
    log("Fann ikkje køyringa etter dispatch.");
    return false;
  }
  let state = classifyRun(run, await loadJobs(fetchImpl, token, run.id));
  if (state === "acquired" || state === "success") {
    log("Køyringa har runner.");
    return true;
  }
  if (state === "waiting") {
    await sleepUntil(sleep, now, sinceMs + giveUpMs);
    run = await loadRun(fetchImpl, token, sinceMs);
    if (!run) {
      log("Køyringa forsvann før avbrot.");
      return false;
    }
    state = classifyRun(run, await loadJobs(fetchImpl, token, run.id));
    if (state === "acquired" || state === "success") {
      log("Køyringa fekk runner før avbrot.");
      return true;
    }
  }
  if (state === "waiting") {
    log(`Ingen runner etter ${Math.round(giveUpMs / 60000)} minutt. Avbryt køyring ${run.id}.`);
    await cancelRun(fetchImpl, token, run.id);
    await sleep(AFTER_CANCEL_MS);
  } else if (state === "poisoned") {
    log(`Køyring ${run.id} vart ferdig utan runner.`);
  } else {
    log("Køyringa er ferdig. Startar ikkje på nytt.");
    return false;
  }

  // Same køyring, nytt forsøk. Det blir ikkje ein ekstra workflow-run, og
  // concurrency-gruppa held framleis éin logger om gongen.
  const retryAt = now();
  const ok = await rerunWorkflow(fetchImpl, token, run.id, sleep, log);
  if (!ok) return false;
  await sleepUntil(sleep, now, retryAt + firstCheckMs);
  const again = await loadRun(fetchImpl, token, sinceMs);
  if (!again) {
    log("Ny runde er ikkje synleg enno.");
    return true;
  }
  const againState = classifyRun(again, await loadJobs(fetchImpl, token, again.id));
  if (againState === "acquired" || againState === "success") {
    log("Ny runde har runner.");
  } else {
    log("Ny runde ventar framleis på runner.");
  }
  return true;
}

export async function runSignalturCron(options = {}) {
  const nowFn = options.now || Date.now;
  const startedAtMs = nowFn();
  const ok = await dispatchWorkflow({
    token: options.token,
    fetchImpl: options.fetchImpl,
    log: options.log,
    sleep: options.sleep,
    attempts: options.dispatchAttempts,
  });
  if (!ok) return false;
  try {
    await recoverUnacquiredRun({
      ...options,
      startedAtMs,
      now: nowFn,
    });
  } catch (error) {
    const log = options.log || console.log;
    const message = error && error.message ? error.message : String(error);
    log(`Vakta feila: ${message}`);
  }
  return true;
}

export default {
  async scheduled(event, env) {
    const cron = event && event.cron ? event.cron : "";
    console.log(`Cron ${cron} startar log-signalturar.`);
    const ok = await runSignalturCron({ token: env && env.GITHUB_TOKEN });
    if (!ok) {
      throw new Error("Fekk ikkje starta log-signalturar.");
    }
  },
};
