/**
 * LectureForge seed: a realistic advanced-ML study set.
 *
 * Demo account:  demo@lectureforge.app / demo-password
 *
 * Creates one fully-processed study set ("Backpropagation & Optimization")
 * built from three sources (lecture video, slide deck, recitation notes),
 * with chunk-level citations on every artifact, FSRS-scheduled cards,
 * a mixed-type quiz, derivation/code exercises, attempts, progress metrics,
 * study sessions, and a tutor conversation — plus a second study set caught
 * mid-processing so the dashboard shows live job state.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { getEmbeddings, toVectorLiteral } from "@/lib/ai/embeddings";

const prisma = new PrismaClient();

const DAY = 86_400_000;
const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * DAY + h * 3_600_000);
const inDays = (d: number) => new Date(Date.now() + d * DAY);

async function main() {
  console.log("Seeding LectureForge demo data…");

  // Idempotent: wipe the demo account (cascades to everything it owns).
  await prisma.user.deleteMany({ where: { email: "demo@lectureforge.app" } });

  const user = await prisma.user.create({
    data: {
      email: "demo@lectureforge.app",
      name: "Demo Student",
      passwordHash: await bcrypt.hash("demo-password", 12),
      preferences: { theme: "system" },
    },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: "Demo workspace",
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  /* ------------------------------------------------------------------ */
  /* Study set 1 — fully processed                                       */
  /* ------------------------------------------------------------------ */
  const studySet = await prisma.studySet.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      title: "Backpropagation & Optimization",
      course: "CS 583 — Deep Learning",
      subject: "Machine learning",
      learnerLevel: "GRADUATE",
      examDate: inDays(18),
      language: "en",
      outputTypes: ["GUIDE", "FLASHCARDS", "QUIZ", "EXERCISES", "AUDIO_RECAP", "TUTOR"],
      settings: {
        detailLevel: "detailed",
        citationStrictness: "strict",
        sourceOnlyMode: true,
        includeExternal: false,
      },
      createdAt: daysAgo(21),
    },
  });

  /* --- Sources ------------------------------------------------------- */

  const video = await prisma.source.create({
    data: {
      studySetId: studySet.id,
      type: "VIDEO",
      title: "Lecture 6 — Backpropagation and Automatic Differentiation",
      description: "Computational graphs, the chain rule, reverse-mode AD, and why backprop is cheap.",
      status: "READY",
      durationSec: 2895,
      language: "en",
      consentConfirmedAt: daysAgo(21),
      metadata: { filename: "lecture06-backprop.mp4", sizeBytes: 731_504_640, mimeType: "video/mp4", transcriptProvider: "whisper", diarized: true },
      createdAt: daysAgo(21),
    },
  });
  const slides = await prisma.source.create({
    data: {
      studySetId: studySet.id,
      type: "SLIDES",
      title: "lecture06-slides.pdf",
      description: "24 slides: computational graphs → chain rule → reverse-mode AD → checkpointing.",
      status: "READY",
      language: "en",
      metadata: { filename: "lecture06-slides.pdf", sizeBytes: 4_301_824, mimeType: "application/pdf", pageCount: 24, format: "pdf" },
      createdAt: daysAgo(21),
    },
  });
  const notes = await prisma.source.create({
    data: {
      studySetId: studySet.id,
      type: "NOTE",
      title: "Recitation notes — optimization methods",
      description: "Hand-written recitation notes on SGD, momentum, RMSProp, and Adam.",
      status: "READY",
      language: "en",
      metadata: { filename: "recitation-optimization.pdf", sizeBytes: 1_204_224, mimeType: "application/pdf", pageCount: 6, format: "pdf" },
      createdAt: daysAgo(14),
    },
  });

  /* --- Lecture transcript (diarized, realistic timeline) ------------ */

  type Seg = { speaker: string; text: string; sec: number };
  const lecture: Seg[] = [
    { speaker: "Instructor", text: "Last time we defined the computational graph as a directed acyclic graph whose nodes are operations and whose edges carry tensors.", sec: 12 },
    { speaker: "Instructor", text: "Today we answer the question every framework answers implicitly: how do we compute the gradient of a scalar loss with respect to millions of parameters using only one backward pass?", sec: 38 },
    { speaker: "Instructor", text: "The workhorse is the chain rule. If z depends on y and y depends on x, then the derivative of z with respect to x factorizes as dz/dx equals dz/dy times dy/dx.", sec: 96 },
    { speaker: "Instructor", text: "In vector form this becomes a Jacobian product. For f from R^n to R^m, the Jacobian J has shape m by n, and the chain rule composes Jacobians by matrix multiplication.", sec: 152 },
    { speaker: "Instructor", text: "Here is the key asymmetry: multiplying a Jacobian by a vector on the left, J times v, costs the same as evaluating the original function — but forming J explicitly can be exponentially larger.", sec: 214 },
    { speaker: "Instructor", text: "Reverse-mode automatic differentiation computes exactly these Jacobian-vector products. One backward sweep over the graph yields the gradient of a single scalar output with respect to every intermediate quantity.", sec: 278 },
    { speaker: "Instructor", text: "Forward mode, by contrast, propagates tangents from inputs to outputs. It is efficient when you have few inputs and many outputs; deep learning is the opposite regime — millions of inputs, one scalar loss.", sec: 341 },
    { speaker: "Instructor", text: "So backpropagation is nothing mysterious: it is reverse-mode AD applied to the computational graph of a neural network loss. The mystery is only why it is so cheap.", sec: 405 },
    { speaker: "Student", text: "Is the cost really the same as the forward pass? What about memory?", sec: 462 },
    { speaker: "Instructor", text: "Excellent question. Compute is roughly two to three times the forward cost, but memory is the real price: every intermediate activation needed by a derivative rule must be stored until the backward pass.", sec: 478 },
    { speaker: "Instructor", text: "Activation checkpointing trades the two: recompute intermediate activations during the backward sweep instead of storing them. You pay roughly one extra forward pass to cut activation memory dramatically.", sec: 545 },
    { speaker: "Instructor", text: "Let me now write out the two-layer network example. Forward: h equals sigma of W1 x, and y-hat equals W2 h. Loss L is the squared error.", sec: 610 },
    { speaker: "Instructor", text: "Backward: dL over dy-hat is y-hat minus y. Then dL over W2 is that row vector times h transposed, and dL over h is W2 transposed times dL over dy-hat.", sec: 688 },
    { speaker: "Instructor", text: "Finally dL over W1 uses the local derivative of sigma: dL over z1 equals dL over h hadamard sigma prime of z1, and dL over W1 is that times x transposed.", sec: 760 },
    { speaker: "Instructor", text: "Notice each step multiplies an incoming gradient by a local Jacobian. The framework never symbolically differentiates; it just chains vector-Jacobian products.", sec: 823 },
    { speaker: "Instructor", text: "Once gradients exist, we hand them to an optimizer. Plain gradient descent steps against the gradient, but the choice of optimizer changes how fast and how reliably we converge.", sec: 890 },
    { speaker: "Instructor", text: "Momentum accumulates an exponential moving average of gradients and steps along it, damping oscillation across ravines. RMSProp normalizes by a running estimate of the second moment.", sec: 960 },
    { speaker: "Instructor", text: "Adam combines both: a bias-corrected first moment estimate and a bias-corrected second moment estimate, and steps along their ratio. Read the recitation notes for the exact update equations.", sec: 1030 },
    { speaker: "Instructor", text: "One warning before you leave: Adam's default learning rate of 1e-3 is not a law of nature. Always sweep it. The optimizer is only as good as its schedule.", sec: 1108 },
  ];

  const transcript = await prisma.transcript.create({
    data: {
      sourceId: video.id,
      language: "en",
      provider: "whisper-1",
      status: "READY",
      wordCount: lecture.reduce((n, s) => n + s.text.split(/\s+/).length, 0),
      segmentCount: lecture.length,
      metadata: { durationSec: 2895, diarized: true },
    },
  });
  // Segments: each spans until the next utterance (last one runs 20s).
  for (let i = 0; i < lecture.length; i++) {
    const startSec = lecture[i].sec;
    const endSec = i + 1 < lecture.length ? lecture[i + 1].sec - 2 : startSec + 20;
    await prisma.transcriptSegment.create({
      data: {
        transcriptId: transcript.id,
        idx: i,
        startMs: startSec * 1000,
        endMs: endSec * 1000,
        speaker: lecture[i].speaker,
        text: lecture[i].text,
        confidence: 0.86 + (i % 7) * 0.015,
        ...(i === 8 ? { flagged: true, note: "Audio dips — verify wording" } : {}),
        ...(i === 12 ? { edited: true } : {}),
      },
    });
  }

  /* --- Chunks + citation anchors ------------------------------------- */

  type ChunkDraft = {
    source: typeof video;
    kind: "TRANSCRIPT" | "SLIDE" | "NOTE";
    ordinal: number;
    heading?: string;
    content: string;
    page?: number;
    startMs?: number;
    endMs?: number;
    speaker?: string;
  };

  const chunkDrafts: ChunkDraft[] = [
    // Video chunks (time ranges map onto the transcript above).
    { source: video, kind: "TRANSCRIPT", ordinal: 0, heading: "Computational graphs", content: "A computational graph is a directed acyclic graph whose nodes are operations and whose edges carry tensors. Evaluating the network is a topological sweep of this graph. The central question of the lecture: how to compute the gradient of a scalar loss with respect to millions of parameters in a single backward pass.", startMs: 12_000, endMs: 90_000, speaker: "Instructor" },
    { source: video, kind: "TRANSCRIPT", ordinal: 1, heading: "Chain rule and Jacobians", content: "The chain rule factorizes derivatives along graph paths: dz/dx = dz/dy · dy/dx. In vector form, each node contributes its Jacobian, and the chain rule composes Jacobians by matrix multiplication. For f: R^n → R^m the Jacobian has shape m×n; forming it explicitly can be exponentially larger than multiplying by it.", startMs: 96_000, endMs: 210_000, speaker: "Instructor" },
    { source: video, kind: "TRANSCRIPT", ordinal: 2, heading: "Reverse-mode AD", content: "Reverse-mode automatic differentiation computes Jacobian-vector products without materializing Jacobians. One backward sweep over the graph yields the gradient of a single scalar output with respect to every intermediate quantity, at a cost comparable to the forward evaluation. Forward mode propagates tangents input→output and suits few-input/many-output regimes; deep learning is the opposite: millions of parameters, one scalar loss.", startMs: 214_000, endMs: 402_000, speaker: "Instructor" },
    { source: video, kind: "TRANSCRIPT", ordinal: 3, heading: "Compute vs memory", content: "Backpropagation's compute cost is roughly two to three times the forward pass, but memory is the real price: every intermediate activation needed by a derivative rule must be stored until the backward pass. Activation checkpointing trades compute for memory by recomputing intermediates during the backward sweep — roughly one extra forward pass for a dramatic cut in activation memory.", startMs: 462_000, endMs: 606_000, speaker: "Instructor" },
    { source: video, kind: "TRANSCRIPT", ordinal: 4, heading: "Two-layer network backprop", content: "Two-layer example. Forward: h = σ(W₁x), ŷ = W₂h, L = squared error. Backward: ∂L/∂ŷ = ŷ − y; ∂L/∂W₂ = (∂L/∂ŷ)·hᵀ; ∂L/∂h = W₂ᵀ·(∂L/∂ŷ); ∂L/∂W₁ = ((∂L/∂h) ⊙ σ′(z₁))·xᵀ. Each step multiplies an incoming gradient by a local Jacobian — the framework chains vector-Jacobian products and never differentiates symbolically.", startMs: 610_000, endMs: 886_000, speaker: "Instructor" },
    { source: video, kind: "TRANSCRIPT", ordinal: 5, heading: "From gradients to optimizers", content: "Once gradients exist, an optimizer decides the step. Momentum accumulates an exponential moving average of gradients and steps along it, damping oscillation across ravines. RMSProp normalizes the step by a running estimate of the second moment. Adam combines a bias-corrected first-moment estimate with a bias-corrected second-moment estimate and steps along their ratio. Adam's default learning rate of 1e-3 is not a law of nature — always sweep it.", startMs: 890_000, endMs: 1_134_000, speaker: "Instructor" },
    // Slide chunks (pages).
    { source: slides, kind: "SLIDE", ordinal: 0, heading: "Lecture roadmap", page: 3, content: "Roadmap: (1) computational graphs, (2) chain rule review, (3) forward- vs reverse-mode AD, (4) backprop on a two-layer network, (5) memory cost and checkpointing, (6) a first look at optimizers." },
    { source: slides, kind: "SLIDE", ordinal: 1, heading: "Modes of automatic differentiation", page: 9, content: "Forward mode: carry tangents ẋ alongside primal values; cost per independent input column. Reverse mode: one adjoint pass per scalar output; cost independent of the number of inputs. Table from the slides: n inputs, m outputs — forward needs n sweeps, reverse needs m sweeps." },
    { source: slides, kind: "SLIDE", ordinal: 2, heading: "Pitfalls in implementation", page: 14, content: "Common bugs: (1) using the same tensor buffer for forward and backward; (2) forgetting to detach in evaluation loops, keeping the graph alive; (3) in-place operations that destroy values the backward pass needs; (4) mixing up element-wise (Hadamard) and matrix products when routing gradients." },
    { source: slides, kind: "SLIDE", ordinal: 3, heading: "Checkpointing trade-off", page: 17, content: "Checkpoint every sqrt(L) blocks of an L-block network: memory drops from O(L) activations to O(sqrt(L)) at the cost of one extra forward evaluation per backward pass. Quote from the slide: 'memory is the price of exact gradients.'" },
    { source: slides, kind: "SLIDE", ordinal: 4, heading: "Optimizer zoo", page: 21, content: "Optimizer summary table: SGD (step ∝ −ηg), Momentum (v ← βv + g; step ∝ −ηv), RMSProp (s ← ρs + (1−ρ)g²; step ∝ −η g/√(s+ε)), Adam (both moments, bias-corrected; step ∝ −η m̂/(√v̂+ε))." },
    // Note chunks.
    { source: notes, kind: "NOTE", ordinal: 0, heading: "SGD with momentum", page: 1, content: "From recitation: momentum rewrites SGD as a heavy-ball method. vₜ = βvₜ₋₁ + gₜ; θₜ₊₁ = θₜ − ηvₜ. Typical β = 0.9. Interpretation: exponential moving average of gradients attenuates high-frequency oscillation while preserving the consistent downhill direction across ravines." },
    { source: notes, kind: "NOTE", ordinal: 1, heading: "RMSProp and Adam updates", page: 3, content: "RMSProp: sₜ = ρsₜ₋₁ + (1−ρ)gₜ²; θₜ₊₁ = θₜ − η gₜ/√(sₜ+ε), typical ρ = 0.9. Adam: mₜ = β₁mₜ₋₁ + (1−β₁)gₜ, vₜ = β₂vₜ₋₁ + (1−β₂)gₜ², bias corrections m̂ₜ = mₜ/(1−β₁ᵗ), v̂ₜ = vₜ/(1−β₂ᵗ), step θₜ₊₁ = θₜ − η m̂ₜ/(√v̂ₜ+ε). Defaults β₁ = 0.9, β₂ = 0.999, ε = 1e−8." },
    { source: notes, kind: "NOTE", ordinal: 2, heading: "Practical guidance", page: 5, content: "Recitation advice: never tune optimizer hyperparameters before the loss is correct; verify gradients with finite differences on a tiny model; remember that Adam is not uniformly better — on some convex problems plain SGD with a good schedule generalizes better." },
  ];

  const embeddings = getEmbeddings();
  const anchorsByChunk = new Map<string, string>();
  for (const d of chunkDrafts) {
    const chunk = await prisma.extractedChunk.create({
      data: {
        sourceId: d.source.id,
        ordinal: d.ordinal,
        kind: d.kind,
        heading: d.heading,
        content: d.content,
        page: d.page,
        startMs: d.startMs,
        endMs: d.endMs,
        speaker: d.speaker,
        tokenCount: Math.ceil(d.content.length / 4),
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "extracted_chunks" SET embedding = $1::vector WHERE id = $2`,
      toVectorLiteral((await embeddings.embed([d.content]))[0]),
      chunk.id,
    );
    const anchor = await prisma.citationAnchor.create({
      data: {
        sourceId: d.source.id,
        chunkId: chunk.id,
        sourceType: d.source.type,
        startMs: d.startMs,
        endMs: d.endMs,
        page: d.page,
        excerpt: d.content.slice(0, 180),
      },
    });
    anchorsByChunk.set(`${d.source.id}:${d.ordinal}`, anchor.id);
  }
  const A = (source: typeof video, ordinal: number) => anchorsByChunk.get(`${source.id}:${ordinal}`)!;

  /* --- Study guide ---------------------------------------------------- */

  const guide = await prisma.studyGuide.create({
    data: {
      studySetId: studySet.id,
      style: "LECTURE_NOTES",
      status: "READY",
      version: 2,
      title: "Backpropagation & Optimization — lecture notes",
      generatedAt: daysAgo(20),
      metadata: { summary: "Reverse-mode AD, the two-layer backprop example, memory trade-offs, and a first pass over optimizers." },
      createdAt: daysAgo(20),
    },
  });

  type SectionDraft = {
    kind: PrismaSectionKind;
    title: string;
    content: string;
    claimType?: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
    confidence?: number;
    warnings?: string[];
    learningObjective?: string;
    parentOrdinal?: number;
    anchors?: string[];
  };
  type PrismaSectionKind = "OBJECTIVES" | "VOCABULARY" | "CONCEPT" | "DEFINITION" | "EQUATIONS" | "DERIVATION" | "WORKED_EXAMPLE" | "MISCONCEPTIONS" | "PREREQUISITES" | "RECALL" | "SUMMARY";

  const sectionDrafts: SectionDraft[] = [
    {
      kind: "OBJECTIVES",
      title: "What you should be able to do",
      content: `- State the chain rule in scalar and Jacobian form and explain *when* each is cheap\n- Explain why reverse-mode AD matches the deep-learning regime (many inputs, one scalar output)\n- Derive the backward pass for a two-layer network by hand\n- Quantify the compute/memory trade-off of backprop and of activation checkpointing\n- Write the update equations for momentum, RMSProp, and Adam`,
      learningObjective: "Navigate the full pipeline from computational graph to optimizer step",
      anchors: [A(video, 0), A(slides, 0)],
    },
    {
      kind: "PREREQUISITES",
      title: "Prerequisites you actually need",
      content: "- Matrix calculus: Jacobians, transposes, and the shape game\n- The gradient as the vector of partial derivatives of a scalar\n- Big-O comfort: you will reason about cost *per sweep*, not constants\n- Basic NumPy: you will trace a small backward pass in code",
      claimType: "SOURCE_GROUNDED",
      confidence: 0.88,
      anchors: [A(video, 1)],
    },
    {
      kind: "VOCABULARY",
      title: "Vocabulary",
      content: "Key terms introduced this lecture, in order of appearance.",
      learningObjective: "Define the lecture's core terms precisely",
      anchors: [A(slides, 0)],
    },
    { kind: "DEFINITION", title: "Computational graph", content: "A **directed acyclic graph** whose nodes are operations and whose edges carry tensors. Evaluating a network is a topological sweep of this graph.", parentOrdinal: 2, anchors: [A(video, 0)] },
    { kind: "DEFINITION", title: "Adjoint", content: "The cotangent (row-vector) quantity ∂L/∂(intermediate) propagated during reverse-mode AD. Multiplying an adjoint by a local Jacobian gives the adjoint one step earlier in the graph.", parentOrdinal: 2, anchors: [A(video, 2)] },
    { kind: "DEFINITION", title: "Activation checkpointing", content: "Storing only every k-th intermediate activation and recomputing the rest during the backward sweep, trading roughly one extra forward pass for a large cut in activation memory.", parentOrdinal: 2, anchors: [A(video, 3), A(slides, 3)] },
    {
      kind: "EQUATIONS",
      title: "The chain rule, scalar and matrix form",
      content: `Scalar form:\n\n$$\\frac{\\partial z}{\\partial x} = \\frac{\\partial z}{\\partial y}\\cdot\\frac{\\partial y}{\\partial x}$$\n\nMatrix form — the pattern behind every backward step:\n\n$$\\frac{\\partial L}{\\partial x} = \\frac{\\partial L}{\\partial y}\\, J_y(x), \\qquad J_y(x) \\in \\mathbb{R}^{m\\times n}$$\n\nThe deep-learning asymmetry: $J$ can be astronomically large to store, but $J^\\top v$ (or $v^\\top J$) costs about as much as one evaluation of $y(x)$.`,
      learningObjective: "Apply the chain rule in Jacobian form",
      claimType: "SOURCE_GROUNDED",
      confidence: 0.94,
      anchors: [A(video, 1)],
    },
    {
      kind: "CONCEPT",
      title: "Forward mode vs reverse mode",
      content: `Both modes compute exact derivatives — the difference is *which* product they form and how cost scales:\n\n| | Forward mode | Reverse mode |\n|---|---|---|\n| Propagates | tangents $\\dot{x}$ (columns of $J$) | adjoints $\\bar{x}$ (rows of $J$) |\n| Sweeps needed | one per independent input ($n$) | one per scalar output ($m$) |\n| Sweet spot | few inputs, many outputs | many inputs, few outputs |\n\nDeep learning has millions of parameters and (usually) one scalar loss — the reverse-mode regime. This is why "backprop is cheap" is a statement about *shape*, not magic.`,
      learningObjective: "Choose the right AD mode for a given input/output regime",
      claimType: "SOURCE_GROUNDED",
      confidence: 0.92,
      anchors: [A(video, 2), A(slides, 1)],
    },
    {
      kind: "DERIVATION",
      title: "Backprop through a two-layer network",
      content: `Forward pass:\n\n$$z_1 = W_1 x,\\quad h = \\sigma(z_1),\\quad \\hat{y} = W_2 h,\\quad L = \\tfrac12\\lVert \\hat{y} - y\\rVert^2$$\n\nBackward pass — each line is one adjoint times one local Jacobian:\n\n$$\\bar{\\hat{y}} = \\hat{y} - y$$\n$$\\bar{W_2} = \\bar{\\hat{y}}\\, h^\\top, \\qquad \\bar{h} = W_2^\\top \\bar{\\hat{y}}$$\n$$\\bar{z_1} = \\bar{h} \\odot \\sigma'(z_1), \\qquad \\bar{W_1} = \\bar{z_1}\\, x^\\top$$\n\nCheck every shape as you go: if $\\bar{W_2}$ doesn't have the shape of $W_2$, the expression is wrong before it is even inaccurate.`,
      learningObjective: "Derive gradients for a two-layer network by hand",
      claimType: "SOURCE_GROUNDED",
      confidence: 0.96,
      anchors: [A(video, 4)],
    },
    {
      kind: "WORKED_EXAMPLE",
      title: "Tracing one backward step in NumPy",
      content: "```python\nx = np.array([1.0, 2.0]); y = np.array([0.5])\nW1 = np.array([[0.1, -0.2], [0.3, 0.4]])   # 2x2\nW2 = np.array([[0.5, -0.1]])               # 1x2\nz1 = W1 @ x\nh = 1 / (1 + np.exp(-z1))                  # sigmoid\ny_hat = W2 @ h\n\nd_yhat = y_hat - y                          # dL/d y_hat\nd_W2 = np.outer(d_yhat, h)                  # dL/d W2\nd_h = W2.T @ d_yhat\nd_z1 = d_h * h * (1 - h)                    # sigmoid'(z) = s(z)(1-s(z))\nd_W1 = np.outer(d_z1, x)\n```\nRun it and you get `d_W1[0,0] ≈ 1.66e-4`. Verify with `numerical_grad` in the exercise below.",
      learningObjective: "Implement the backward pass in code and verify it numerically",
      claimType: "SOURCE_GROUNDED",
      confidence: 0.9,
      anchors: [A(video, 4), A(slides, 2)],
    },
    {
      kind: "EQUATIONS",
      title: "Optimizer update equations",
      content: `**Momentum**\n\n$$v_t = \\beta v_{t-1} + g_t, \\qquad \\theta_{t+1} = \\theta_t - \\eta\\, v_t$$\n\n**RMSProp**\n\n$$s_t = \\rho s_{t-1} + (1-\\rho)\\, g_t^2, \\qquad \\theta_{t+1} = \\theta_t - \\eta\\, \\frac{g_t}{\\sqrt{s_t + \\varepsilon}}$$\n\n**Adam** — both moments, both bias corrections:\n\n$$\\hat{m}_t = \\frac{m_t}{1-\\beta_1^{\\,t}}, \\qquad \\hat{v}_t = \\frac{v_t}{1-\\beta_2^{\\,t}}, \\qquad \\theta_{t+1} = \\theta_t - \\eta\\, \\frac{\\hat{m}_t}{\\sqrt{\\hat{v}_t} + \\varepsilon}$$`,
      learningObjective: "Write the update equations for momentum, RMSProp, and Adam",
      claimType: "SOURCE_GROUNDED",
      confidence: 0.95,
      anchors: [A(video, 5), A(notes, 1)],
    },
    {
      kind: "MISCONCEPTIONS",
      title: "Misconceptions to unlearn",
      content: `- **"Backprop symbolically differentiates the loss."** It never builds a symbolic formula — it chains vector-Jacobian products over stored intermediates.\n- **"Backprop is cheap."** Compute is ~2–3× the forward pass; *memory* is the real price, since every activation a derivative rule needs must survive until the backward sweep.\n- **"Adam is strictly better."** The recitation notes are blunt: on some convex problems plain SGD with a good schedule generalizes better, and Adam's default $\\eta = 10^{-3}$ is not a law of nature.\n- **"In-place edits are free."** In-place operations can destroy values the backward pass still needs (slide 14).`,
      learningObjective: "Avoid the classic backprop and optimizer pitfalls",
      claimType: "SOURCE_GROUNDED",
      confidence: 0.91,
      warnings: ["The generalization comparison between Adam and SGD summarizes the recitation notes' advice; it is a rule of thumb, not a theorem."],
      anchors: [A(video, 3), A(slides, 2), A(notes, 2)],
    },
    {
      kind: "RECALL",
      title: "Self-check questions",
      content: "1. Why does reverse mode need only one sweep for a scalar loss, regardless of parameter count?\n2. Where do the savings in activation checkpointing come from, and what do you pay?\n3. In the two-layer derivation, why is $\\bar{h} = W_2^\\top \\bar{\\hat{y}}$ a transpose while $\\bar{W_2}$ is an outer product?\n4. What problem of momentum does RMSProp's normalizer address?",
      claimType: "INFERENCE",
      confidence: 0.74,
      learningObjective: "Self-assess before moving to the quiz",
      anchors: [A(video, 2), A(video, 4), A(video, 5)],
    },
    {
      kind: "SUMMARY",
      title: "Summary",
      content: "Backpropagation is reverse-mode automatic differentiation applied to a network's computational graph: one backward sweep of adjoint × local-Jacobian products yields every parameter gradient at forward-pass scale cost, with activation memory as the price — and checkpointing as the escape hatch. Optimizers then decide what to do with those gradients: momentum averages them, RMSProp normalizes them, Adam does both with bias correction.",
      claimType: "SOURCE_GROUNDED",
      confidence: 0.93,
      anchors: [A(video, 5), A(slides, 4)],
    },
  ];

  const sectionIds: string[] = [];
  for (let i = 0; i < sectionDrafts.length; i++) {
    const d = sectionDrafts[i];
    const section = await prisma.studyGuideSection.create({
      data: {
        guideId: guide.id,
        parentId: d.parentOrdinal != null ? sectionIds[d.parentOrdinal] : null,
        ordinal: i,
        kind: d.kind,
        title: d.title,
        content: d.content,
        claimType: d.claimType ?? "SOURCE_GROUNDED",
        confidence: d.confidence ?? 0.9,
        warnings: d.warnings ?? [],
        learningObjective: d.learningObjective,
        anchors: { connect: (d.anchors ?? []).map((id) => ({ id })) },
        createdAt: daysAgo(20),
      },
    });
    sectionIds.push(section.id);
  }

  /* --- Flashcards ----------------------------------------------------- */

  const deck = await prisma.flashcardDeck.create({
    data: { studySetId: studySet.id, name: "Backprop & optimizers — core", algorithm: "fsrs-4.5", generatedFrom: { focus: null }, createdAt: daysAgo(19) },
  });

  type CardDraft = {
    type: "BASIC" | "CLOZE" | "EQUATION" | "CONCEPTUAL" | "CODE_COMPLETION";
    front: string;
    back: string;
    tags: string[];
    anchor: string;
    context?: string;
    state: "NEW" | "REVIEW";
    stability?: number;
    difficulty?: number;
    reps: number;
    lapses: number;
    lastReviewedAt?: Date;
    dueInDays: number; // negative = overdue
  };

  const cardDrafts: CardDraft[] = [
    { type: "BASIC", front: "Why does reverse-mode AD suit deep learning?", back: "DL has millions of inputs (parameters) and (usually) one scalar output. Reverse mode needs one sweep per *output*; forward mode needs one per *input*.", tags: ["ad", "concept"], anchor: A(video, 2), state: "REVIEW", stability: 18.4, difficulty: 4.9, reps: 6, lapses: 1, lastReviewedAt: daysAgo(3), dueInDays: 1 },
    { type: "BASIC", front: "What does activation checkpointing trade?", back: "Roughly one extra forward pass (compute) for a large reduction in stored activations (memory). sqrt(L) checkpoints give O(√L) memory for an L-block network.", tags: ["memory"], anchor: A(slides, 3), state: "REVIEW", stability: 9.2, difficulty: 5.6, reps: 4, lapses: 2, lastReviewedAt: daysAgo(6), dueInDays: -1 },
    { type: "EQUATION", front: "Write the momentum update equations.", back: "$v_t = \\beta v_{t-1} + g_t$; $\\theta_{t+1} = \\theta_t - \\eta v_t$ (typical $\\beta = 0.9$).", tags: ["optimizers"], anchor: A(notes, 0), state: "REVIEW", stability: 24.1, difficulty: 4.1, reps: 7, lapses: 0, lastReviewedAt: daysAgo(2), dueInDays: 3 },
    { type: "EQUATION", front: "Write Adam's bias-corrected step.", back: "$\\theta_{t+1} = \\theta_t - \\eta\\, \\hat{m}_t / (\\sqrt{\\hat{v}_t} + \\varepsilon)$ with $\\hat{m}_t = m_t/(1-\\beta_1^t)$, $\\hat{v}_t = v_t/(1-\\beta_2^t)$.", tags: ["optimizers"], anchor: A(notes, 1), state: "REVIEW", stability: 6.8, difficulty: 6.2, reps: 3, lapses: 1, lastReviewedAt: daysAgo(8), dueInDays: -2 },
    { type: "CLOZE", front: "Backprop's compute cost is roughly {{2–3×}} the forward pass, but {{memory}} is the real price.", back: "2–3×; memory (every activation a derivative rule needs must be stored).", tags: ["cost"], anchor: A(video, 3), state: "NEW", reps: 0, lapses: 0, dueInDays: 0 },
    { type: "CLOZE", front: "Forward mode propagates {{tangents}}; reverse mode propagates {{adjoints}}.", back: "Tangents (columns of J) forward; adjoints (rows of J) backward.", tags: ["ad"], anchor: A(slides, 1), state: "NEW", reps: 0, lapses: 0, dueInDays: 0 },
    { type: "CONCEPTUAL", front: "In $\\bar{h} = W_2^\\top \\bar{\\hat{y}}$, why a transpose?", back: "Routing a gradient *through* a linear map uses the adjoint (transpose) of that map; only multiplying *along* the map ($\\bar{W_2} = \\bar{\\hat{y}} h^\\top$) uses the outer-product form. Check shapes.", tags: ["backprop"], anchor: A(video, 4), state: "REVIEW", stability: 4.5, difficulty: 6.7, reps: 3, lapses: 1, lastReviewedAt: daysAgo(1), dueInDays: 0 },
    { type: "CONCEPTUAL", front: "Why can forming a Jacobian explicitly be catastrophically expensive?", back: "It can be exponentially larger than the function's own cost — but multiplying by it ($J^\\top v$) costs about one function evaluation. AD exploits exactly this.", tags: ["ad"], anchor: A(video, 1), state: "NEW", reps: 0, lapses: 0, dueInDays: 0 },
    { type: "CODE_COMPLETION", front: "```python\n# dL/dh through layer W2, given d_yhat\nd_h = ______\n```", back: "`d_h = W2.T @ d_yhat`", tags: ["code", "backprop"], anchor: A(video, 4), context: "From the two-layer worked example in the lecture (11:20–13:06).", state: "NEW", reps: 0, lapses: 0, dueInDays: 0 },
    { type: "CODE_COMPLETION", front: "```python\n# sigmoid's local derivative, given h = sigmoid(z1)\nd_z1 = d_h * ______\n```", back: "`h * (1 - h)` — since σ′(z) = σ(z)(1 − σ(z)).", tags: ["code"], anchor: A(video, 4), state: "NEW", reps: 0, lapses: 0, dueInDays: 0 },
    { type: "BASIC", front: "Two things momentum fixes/changes vs plain SGD?", back: "Damps oscillation across ravines (high-frequency components) while keeping the consistent downhill direction — an EMA of gradients.", tags: ["optimizers"], anchor: A(notes, 0), state: "REVIEW", stability: 31.0, difficulty: 3.8, reps: 8, lapses: 0, lastReviewedAt: daysAgo(4), dueInDays: 6 },
    { type: "BASIC", front: "What problem of momentum does RMSProp address?", back: "The ever-growing (or mis-scaled) step in persistent directions — RMSProp normalizes each coordinate by a running second-moment estimate.", tags: ["optimizers"], anchor: A(notes, 1), state: "REVIEW", stability: 2.9, difficulty: 6.9, reps: 2, lapses: 1, lastReviewedAt: daysAgo(10), dueInDays: -3 },
  ];

  for (const c of cardDrafts) {
    await prisma.flashcard.create({
      data: {
        deckId: deck.id,
        type: c.type,
        front: c.front,
        back: c.back,
        context: c.context,
        tags: c.tags,
        state: c.state,
        stability: c.stability,
        difficulty: c.difficulty,
        reps: c.reps,
        lapses: c.lapses,
        lastReviewedAt: c.lastReviewedAt,
        dueAt: c.state === "NEW" ? daysAgo(0, -1) : inDays(c.dueInDays),
        algorithm: "fsrs-4.5",
        anchors: { connect: [{ id: c.anchor }] },
        createdAt: daysAgo(19),
      },
    });
  }

  /* --- Quiz (one question per type) ------------------------------------ */

  const quiz = await prisma.quiz.create({
    data: {
      studySetId: studySet.id,
      title: "Backpropagation fundamentals",
      status: "READY",
      config: { count: 8, difficulty: "adaptive", promptVersion: "seed", adaptiveReason: "Mixed mastery across topics — sampling every difficulty." },
      generatedAt: daysAgo(18),
      createdAt: daysAgo(18),
    },
  });

  type QDraft = {
    type: "MULTIPLE_CHOICE" | "MULTI_SELECT" | "SHORT_ANSWER" | "ORDERING" | "MATCHING" | "DERIVATION_STEPS" | "CODE_TRACING" | "NUMERICAL";
    stem: string;
    options?: { id: string; text: string }[];
    answer: object;
    explanation: string;
    distractorRationale?: object;
    learningObjective: string;
    difficulty: "EASY" | "MEDIUM" | "HARD" | "ADVANCED";
    anchor: string;
  };

  const qDrafts: QDraft[] = [
    {
      type: "MULTIPLE_CHOICE",
      stem: "Backpropagation computes gradients by…",
      options: [
        { id: "opt1", text: "chaining vector-Jacobian products over the computational graph" },
        { id: "opt2", text: "symbolically differentiating the loss formula, then simplifying" },
        { id: "opt3", text: "finite differences at every parameter" },
        { id: "opt4", text: "sampling random directions and estimating directional derivatives" },
      ],
      answer: { correctIds: ["opt1"] },
      explanation: "The lecture is explicit: the framework never differentiates symbolically — it chains adjoint × local-Jacobian products over stored intermediates (13:43).",
      distractorRationale: { opt2: "No symbolic formula is ever built.", opt3: "Finite differences cost one forward pass per parameter — used only to *verify* gradients.", opt4: "That describes SPSA-style estimation, not backprop." },
      learningObjective: "Explain what backprop actually computes",
      difficulty: "MEDIUM",
      anchor: A(video, 4),
    },
    {
      type: "MULTI_SELECT",
      stem: "Which statements about forward- vs reverse-mode AD are true? (select all)",
      options: [
        { id: "opt1", text: "Forward mode propagates tangents from inputs to outputs" },
        { id: "opt2", text: "Reverse mode needs one sweep per scalar output regardless of input count" },
        { id: "opt3", text: "Deep learning is a few-inputs/many-outputs regime, so forward mode wins" },
        { id: "opt4", text: "Multiplying a Jacobian by a vector costs about as much as evaluating the original function" },
      ],
      answer: { correctIds: ["opt1", "opt2", "opt4"] },
      explanation: "Deep learning is the *opposite* regime (millions of inputs, one scalar loss), which is precisely why reverse mode wins (slide 9, 05:38).",
      distractorRationale: { opt3: "Backwards — DL has many inputs and one scalar output." },
      learningObjective: "Choose the right AD mode for a given regime",
      difficulty: "MEDIUM",
      anchor: A(slides, 1),
    },
    {
      type: "SHORT_ANSWER",
      stem: "In the two-layer example with h = σ(W₁x), ŷ = W₂h: what is ∂L/∂W₂ in terms of the adjoint $\\bar{\\hat{y}}$ and h?",
      options: [],
      answer: { text: ["(d_yhat) h^T", "outer(d_yhat, h)", "ȳ hᵀ", "(ŷ − y)hᵀ"] },
      explanation: "$\\bar{W_2} = \\bar{\\hat{y}}\\, h^\\top$ — an outer product, because the parameter appears as the *left* factor of a linear map (11:28).",
      learningObjective: "Derive gradients for a two-layer network by hand",
      difficulty: "HARD",
      anchor: A(video, 4),
    },
    {
      type: "ORDERING",
      stem: "Order one training iteration from first to last.",
      options: [
        { id: "opt1", text: "Forward pass: compute activations and the loss" },
        { id: "opt2", text: "Initialize/refresh the adjoint at the loss node" },
        { id: "opt3", text: "Backward pass: propagate adjoints to every parameter" },
        { id: "opt4", text: "Optimizer step: update parameters from gradients" },
      ],
      answer: { order: ["opt1", "opt2", "opt3", "opt4"] },
      explanation: "Forward → seed adjoint → backward sweep → optimizer step. The optimizer is the consumer of gradients, not part of backprop itself.",
      learningObjective: "Outline the full training iteration",
      difficulty: "EASY",
      anchor: A(slides, 0),
    },
    {
      type: "MATCHING",
      stem: "Match each optimizer to its defining mechanism.",
      options: [
        { id: "opt1", text: "SGD + momentum" },
        { id: "opt2", text: "RMSProp" },
        { id: "opt3", text: "Adam" },
      ],
      answer: { pairs: [
        { optionId: "opt1", value: "EMA of gradients; steps along the average" },
        { optionId: "opt2", value: "Normalizes each coordinate by a running second moment" },
        { optionId: "opt3", value: "Both moments, bias-corrected" },
      ] },
      explanation: "From the recitation notes (p. 1–3): momentum averages, RMSProp normalizes, Adam does both with bias correction.",
      learningObjective: "Distinguish the classic optimizers by update rule",
      difficulty: "MEDIUM",
      anchor: A(notes, 1),
    },
    {
      type: "DERIVATION_STEPS",
      stem: "Order the derivation of $\\bar{W_1}$ for the two-layer network.",
      options: [
        { id: "opt1", text: "$\\bar{\\hat{y}} = \\hat{y} - y$" },
        { id: "opt2", text: "$\\bar{h} = W_2^\\top\\, \\bar{\\hat{y}}$" },
        { id: "opt3", text: "$\\bar{z_1} = \\bar{h} \\odot \\sigma'(z_1)$" },
        { id: "opt4", text: "$\\bar{W_1} = \\bar{z_1}\\, x^\\top$" },
      ],
      answer: { order: ["opt1", "opt2", "opt3", "opt4"] },
      explanation: "Adjoints flow output→loss-adjoint→through W₂→through σ→into W₁. Each step multiplies the incoming adjoint by exactly one local Jacobian (12:40).",
      learningObjective: "Derive gradients for a two-layer network by hand",
      difficulty: "HARD",
      anchor: A(video, 4),
    },
    {
      type: "CODE_TRACING",
      stem: "```python\nx = np.array([1.0, 2.0])\nW1 = np.array([[0.1, -0.2], [0.3, 0.4]])\nW2 = np.array([[0.5, -0.1]])\nz1 = W1 @ x\nh = 1 / (1 + np.exp(-z1))\ny_hat = W2 @ h\nprint(h.shape, z1[1])\n```\nWhat does this print?",
      options: [
        { id: "opt1", text: "(2,) 1.1" },
        { id: "opt2", text: "(2, 1) 1.1" },
        { id: "opt3", text: "(2,) 0.4" },
        { id: "opt4", text: "(1, 2) 1.1" },
      ],
      answer: { correctIds: ["opt1"] },
      explanation: "W1 @ x with x a 1-D array of shape (2,) yields shape (2,); z1[1] = 0.3·1 + 0.4·2 = 1.1. Shape-reading is the first skill of backprop debugging.",
      distractorRationale: { opt2: "No second axis — 1-D input stays 1-D through @.", opt3: "That's W1[1,0]·x[0] alone, forgetting the second term.", opt4: "Transposed." },
      learningObjective: "Trace shapes through a forward pass in code",
      difficulty: "EASY",
      anchor: A(video, 4),
    },
    {
      type: "NUMERICAL",
      stem: "Continuing the code above with y = 0.5: compute $\\bar{W_2}[0,0]$, the (0,0) entry of the gradient w.r.t. W₂. (ŷ = W₂·h ≈ 0.1288, h ≈ [0.5250, 0.7503].)",
      options: [],
      answer: { numeric: { value: -0.1858, tolerance: 0.005 } },
      explanation: "$\\bar{\\hat{y}} = \\hat{y} - y = 0.1288 - 0.5 = -0.3712$; $\\bar{W_2}[0,0] = \\bar{\\hat{y}} \\cdot h_0 = -0.3712 \\times 0.5250 \\approx -0.1858$.",
      learningObjective: "Compute one entry of a gradient by hand",
      difficulty: "ADVANCED",
      anchor: A(video, 4),
    },
  ];

  const questionIds: string[] = [];
  for (let i = 0; i < qDrafts.length; i++) {
    const q = await prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        ordinal: i,
        type: qDrafts[i].type,
        stem: qDrafts[i].stem,
        options: (qDrafts[i].options ?? undefined) as object | undefined,
        answer: qDrafts[i].answer,
        explanation: qDrafts[i].explanation,
        distractorRationale: qDrafts[i].distractorRationale,
        learningObjective: qDrafts[i].learningObjective,
        difficulty: qDrafts[i].difficulty,
        warnings: [],
        anchors: { connect: [{ id: qDrafts[i].anchor }] },
      },
    });
    questionIds.push(q.id);
  }

  /* --- Exercises -------------------------------------------------------- */

  const exerciseSet = await prisma.exerciseSet.create({
    data: {
      studySetId: studySet.id,
      title: "Derivations & implementation",
      status: "READY",
      config: { types: ["derivation", "code_completion", "conceptual_transfer"], difficulty: "hard" },
      createdAt: daysAgo(17),
    },
  });

  await prisma.exercise.create({
    data: {
      exerciseSetId: exerciseSet.id,
      ordinal: 0,
      type: "DERIVATION",
      title: "Backprop through softmax + cross-entropy",
      prompt: `Derive the gradient of the cross-entropy loss $L = -\\log p_y$ with respect to the logits $z$, where $p = \\mathrm{softmax}(z)$.\n\nShow every step: the derivative of the softmax Jacobian, the collapse when combined with $\\log$, and the final compact form. Then explain in one sentence why frameworks fuse these two ops into one backward kernel.`,
      prerequisites: ["Chain rule in Jacobian form", "The two-layer derivation from lecture 6"],
      assumptions: ["Unnormalized log-probabilities z ∈ R^K", "Correct class index y", "Exact arithmetic (no numerical-stability tricks needed for the math)"],
      requiredKnowledge: ["Softmax definition $p_i = e^{z_i}/\\sum_j e^{z_j}$", "∂ log f = f′/f"],
      expectedOutput: "A step-by-step derivation ending at ∂L/∂z = p − e_y (one-hot e_y), plus one sentence on kernel fusion.",
      estimatedMinutes: 25,
      difficulty: "HARD",
      grounded: true,
      hints: [
        "Start from ∂L/∂p_j — the loss depends on p only through p_y.",
        "The softmax Jacobian is ∂p_i/∂z_j = p_i(δ_ij − p_j).",
        "The sum over i of ∂L/∂p_i · ∂p_i/∂z_j collapses because ∑_i p_i = 1.",
      ],
      solution: `1. $\\partial L/\\partial p_i = -\\frac{1}{p_y}\\delta_{iy}$.\n\n2. Softmax Jacobian: $\\partial p_i/\\partial z_j = p_i(\\delta_{ij} - p_j)$.\n\n3. Chain rule: $\\partial L/\\partial z_j = \\sum_i \\frac{\\partial L}{\\partial p_i}\\frac{\\partial p_i}{\\partial z_j} = -\\frac{1}{p_y} p_y(\\delta_{yj} - p_j) = p_j - \\delta_{yj}$.\n\n4. Compact form: $\\boxed{\\partial L/\\partial z = p - e_y}$.\n\n**Fusion:** the combined backward rule needs only $p$ and the label — no K×K Jacobian is ever formed, and the subtraction is numerically benign, so frameworks register one fused backward kernel instead of composing log∘softmax.`,
      rubric: {
        criteria: [
          { id: "c1", description: "States ∂L/∂p correctly", weight: 0.2 },
          { id: "c2", description: "Derives the softmax Jacobian", weight: 0.3 },
          { id: "c3", description: "Chains to p − e_y with the ∑p=1 collapse", weight: 0.3 },
          { id: "c4", description: "Explains kernel fusion", weight: 0.2 },
        ],
      },
      warnings: [],
      anchors: { connect: [{ id: A(video, 4) }, { id: A(video, 1) }] },
    },
  });

  await prisma.exercise.create({
    data: {
      exerciseSetId: exerciseSet.id,
      ordinal: 1,
      type: "CODE_COMPLETION",
      title: "Numerical gradient check",
      prompt: `Complete the missing lines so the check passes:\n\n\`\`\`python\ndef numerical_grad(f, x, eps=1e-5):\n    grad = np.zeros_like(x)\n    it = np.nditer(x, flags=["multi_index"])\n    while not it.finished:\n        ix = it.multi_index\n        # (1) perturb x[ix] by +eps and -eps, evaluating f each time\n        # (2) central difference into grad[ix]\n        it.iternext()\n    return grad\n\ng = numerical_grad(lambda w: loss_two_layer(w, x, y), W1)\nassert np.allclose(g, analytic_d_W1, atol=1e-4)\n\`\`\`\n\nThen run it against the two-layer network from the lecture notes and report the maximum absolute mismatch.`,
      prerequisites: ["The two-layer NumPy example from the guide"],
      assumptions: ["f is deterministic", "eps = 1e-5 is small enough for double precision", "x is a float array"],
      requiredKnowledge: ["Central differences: (f(x+ε) − f(x−ε)) / 2ε", "np.nditer with multi_index"],
      expectedOutput: "The two completed lines and a reported max |mismatch| < 1e-4.",
      estimatedMinutes: 15,
      difficulty: "MEDIUM",
      grounded: true,
      hints: [
        "Save x[ix], add eps, evaluate, restore, subtract eps, evaluate, restore.",
        "Central difference: (f_plus − f_minus) / (2·eps).",
        "float64 + eps=1e-5 usually lands at ~1e-8 to 1e-6 absolute error — well under the assert.",
      ],
      solution: `\`\`\`python\nwhile not it.finished:\n    ix = it.multi_index\n    orig = x[ix]\n    x[ix] = orig + eps; f_plus = f(x)\n    x[ix] = orig - eps; f_minus = f(x)\n    x[ix] = orig\n    grad[ix] = (f_plus - f_minus) / (2 * eps)\n    it.iternext()\n\`\`\`\nAgainst the lecture's two-layer network the analytic and numeric $\\\\bar{W_1}$ agree to ~3e-9 max absolute mismatch (float64). If yours is ~1e-2, your analytic gradient is wrong — this check is exactly how you find it.`,
      rubric: {
        criteria: [
          { id: "c1", description: "Perturbs and restores the entry", weight: 0.3 },
          { id: "c2", description: "Correct central-difference formula", weight: 0.4 },
          { id: "c3", description: "Reports the mismatch", weight: 0.3 },
        ],
      },
      warnings: [],
      anchors: { connect: [{ id: A(video, 4) }, { id: A(slides, 2) }] },
    },
  });

  await prisma.exercise.create({
    data: {
      exerciseSetId: exerciseSet.id,
      ordinal: 2,
      type: "CONCEPTUAL_TRANSFER",
      title: "Design a memory-aware training loop",
      prompt: `You must train a 100-block transformer on a GPU whose memory fits only 20 blocks' worth of activations. Using the checkpointing idea from the lecture, decide how many blocks to checkpoint, describe the training-loop restructure, and estimate the added compute as a percentage.\n\nThen identify one situation where you would *not* make this trade-off.`,
      prerequisites: ["The compute-vs-memory discussion from lecture 6"],
      assumptions: ["Uniform block sizes", "Gradients and parameters fit comfortably", "One extra forward per backward is acceptable"],
      requiredKnowledge: ["O(√L) checkpointing result from slide 17"],
      expectedOutput: "A short design (≈150 words) with the checkpoint count, loop restructure, compute overhead estimate, and one counter-scenario.",
      estimatedMinutes: 20,
      difficulty: "ADVANCED",
      grounded: false,
      hints: [
        "√100 = 10 — what does segmenting into 10 groups of 10 give you?",
        "Recompute happens per segment during the backward sweep, not for the whole network at once.",
        "When is activation memory not the binding constraint? (Think small models, or latency-bound serving.)",
      ],
      solution: `Checkpoint 10 segment boundaries (every 10th block): peak activation memory drops from 100 blocks to ~10 stored + 10 recomputed = 20 — exactly the budget. The loop restructure: run forward storing only segment outputs; during backward, for each segment (in reverse), re-run forward from its stored boundary, then run the backward for those 10 blocks.\n\nCompute overhead: one extra forward per segment's backward ⇒ roughly +1 forward overall ⇒ ~30–50% more time per iteration (forward is ~⅓–½ of a training step), the standard quote from the lecture.\n\n**Not worth it when:** the model already fits (pure overhead), or in latency-bound inference/serving where throughput of the forward pass matters more than training memory.`,
      rubric: {
        criteria: [
          { id: "c1", description: "Correct checkpoint count via √L", weight: 0.3 },
          { id: "c2", description: "Sound loop restructure", weight: 0.3 },
          { id: "c3", description: "Reasonable overhead estimate", weight: 0.2 },
          { id: "c4", description: "A genuine counter-scenario", weight: 0.2 },
        ],
      },
      warnings: ["Transfer exercise: the √L rule is from your sources; the 100-block application is new."],
      anchors: { connect: [{ id: A(slides, 3) }, { id: A(video, 3) }] },
    },
  });

  /* --- Attempts, progress metrics, sessions ----------------------------- */

  // A believable attempt history: strong on concepts, weak on optimizers.
  const history: { q: number; score: number; ago: number }[] = [
    { q: 0, score: 1, ago: 13 }, { q: 0, score: 1, ago: 9 }, { q: 0, score: 1, ago: 5 },
    { q: 1, score: 0.67, ago: 12 }, { q: 1, score: 1, ago: 8 },
    { q: 2, score: 0, ago: 11 }, { q: 2, score: 1, ago: 6 }, { q: 2, score: 1, ago: 3 },
    { q: 3, score: 1, ago: 12 }, { q: 3, score: 1, ago: 7 },
    { q: 4, score: 0.33, ago: 10 }, { q: 4, score: 0.33, ago: 6 }, { q: 4, score: 0.67, ago: 2 },
    { q: 5, score: 0.5, ago: 9 }, { q: 5, score: 0.75, ago: 4 },
    { q: 6, score: 1, ago: 9 }, { q: 6, score: 1, ago: 5 },
    { q: 7, score: 0, ago: 8 }, { q: 7, score: 0, ago: 4 },
  ];
  for (const h of history) {
    const q = qDrafts[h.q];
    await prisma.attempt.create({
      data: {
        userId: user.id,
        studySetId: studySet.id,
        subjectType: "QUIZ_QUESTION",
        subjectId: questionIds[h.q],
        response: {},
        score: h.score,
        feedback: { summary: h.score >= 0.8 ? "Correct." : h.score >= 0.5 ? "Partially correct." : "Not quite." },
        durationMs: 30_000 + h.q * 7_000,
        createdAt: daysAgo(h.ago, -2),
      },
    });
  }

  const metricDrafts: { topic: string; mastery: number; attempts: number; correct: number; ago: number }[] = [
    { topic: "Explain what backprop actually computes", mastery: 0.95, attempts: 3, correct: 3, ago: 5 },
    { topic: "Choose the right AD mode for a given regime", mastery: 0.84, attempts: 2, correct: 2, ago: 8 },
    { topic: "Derive gradients for a two-layer network by hand", mastery: 0.71, attempts: 3, correct: 2, ago: 3 },
    { topic: "Outline the full training iteration", mastery: 1.0, attempts: 2, correct: 2, ago: 7 },
    { topic: "Distinguish the classic optimizers by update rule", mastery: 0.44, attempts: 3, correct: 1, ago: 2 },
    { topic: "Trace shapes through a forward pass in code", mastery: 1.0, attempts: 2, correct: 2, ago: 5 },
    { topic: "Compute one entry of a gradient by hand", mastery: 0.0, attempts: 2, correct: 0, ago: 4 },
  ];
  for (const m of metricDrafts) {
    await prisma.progressMetric.create({
      data: { userId: user.id, studySetId: studySet.id, topic: m.topic, mastery: m.mastery, attempts: m.attempts, correct: m.correct, lastActivityAt: daysAgo(m.ago) },
    });
  }

  const sessionDrafts: { kind: "FLASHCARD_REVIEW" | "QUIZ" | "EXERCISE" | "TUTOR" | "READING"; min: number; ago: number }[] = [
    { kind: "READING", min: 52, ago: 20 }, { kind: "FLASHCARD_REVIEW", min: 11, ago: 19 },
    { kind: "READING", min: 40, ago: 18 }, { kind: "QUIZ", min: 17, ago: 12 },
    { kind: "FLASHCARD_REVIEW", min: 9, ago: 11 }, { kind: "TUTOR", min: 14, ago: 9 },
    { kind: "QUIZ", min: 15, ago: 8 }, { kind: "READING", min: 35, ago: 7 },
    { kind: "FLASHCARD_REVIEW", min: 8, ago: 6 }, { kind: "EXERCISE", min: 46, ago: 5 },
    { kind: "QUIZ", min: 12, ago: 4 }, { kind: "TUTOR", min: 10, ago: 3 },
    { kind: "FLASHCARD_REVIEW", min: 7, ago: 2 }, { kind: "QUIZ", min: 13, ago: 1 },
  ];
  for (const s of sessionDrafts) {
    const startedAt = daysAgo(s.ago, -3);
    await prisma.studySession.create({
      data: { userId: user.id, studySetId: studySet.id, kind: s.kind, startedAt, endedAt: new Date(startedAt.getTime() + s.min * 60_000), metrics: {} },
    });
  }

  /* --- Tutor conversation ------------------------------------------------ */

  const conversation = await prisma.tutorConversation.create({
    data: { studySetId: studySet.id, userId: user.id, title: "Why is backprop 'cheap'?", hintsUsed: 1, createdAt: daysAgo(9) },
  });
  await prisma.tutorMessage.createMany({
    data: [
      { conversationId: conversation.id, role: "USER", content: "I keep hearing backprop is 'cheap' — cheap compared to what? It still touches every parameter, right?", mode: "answer", metadata: {}, createdAt: daysAgo(9, -1) },
      {
        conversationId: conversation.id,
        role: "ASSISTANT",
        claimType: "SOURCE_GROUNDED",
        mode: "answer",
        content: "Cheap compared to *any* alternative that also gets you exact gradients.\n\n- **vs forming Jacobians:** an explicit Jacobian can be exponentially larger than the function itself, but a Jacobian-*vector* product costs about one function evaluation.\n- **vs finite differences:** those need one forward pass *per parameter* — backprop gets all of them in one sweep.\n- **the bill:** compute ≈ 2–3× one forward pass. The real price is **memory**, because every activation a derivative rule needs must survive until the backward sweep — that's what checkpointing addresses.",
        metadata: { retrievalScores: [0.91, 0.87, 0.84] },
        createdAt: daysAgo(9),
      },
    ],
  });
  const reply = await prisma.tutorMessage.findFirst({ where: { conversationId: conversation.id, role: "ASSISTANT" } });
  if (reply) {
    await prisma.tutorMessage.update({ where: { id: reply.id }, data: { anchors: { connect: [{ id: A(video, 2) }, { id: A(video, 1) }, { id: A(video, 3) }] } } });
  }

  /* --- Job history -------------------------------------------------------- */

  const jobDrafts: { type: "INGEST_SOURCE" | "GENERATE_GUIDE" | "GENERATE_FLASHCARDS" | "GENERATE_QUIZ" | "GENERATE_EXERCISES"; sourceId?: string; ago: number }[] = [
    { type: "INGEST_SOURCE", sourceId: video.id, ago: 21 },
    { type: "GENERATE_GUIDE", ago: 20 },
    { type: "GENERATE_FLASHCARDS", ago: 19 },
    { type: "GENERATE_QUIZ", ago: 18 },
    { type: "GENERATE_EXERCISES", ago: 17 },
  ];
  for (const j of jobDrafts) {
    await prisma.generationJob.create({
      data: {
        studySetId: studySet.id,
        sourceId: j.sourceId,
        type: j.type,
        status: "SUCCEEDED",
        stage: "complete",
        progress: 100,
        payload: {},
        startedAt: daysAgo(j.ago, -1),
        finishedAt: daysAgo(j.ago),
        createdAt: daysAgo(j.ago, -1),
      },
    });
  }

  /* --- Study plan --------------------------------------------------------- */

  await prisma.studyPlan.create({
    data: {
      studySetId: studySet.id,
      targetDate: inDays(18),
      items: [
        { date: inDays(0).toISOString().slice(0, 10), kind: "review", label: "Clear the 3 overdue cards (optimizers focus)", minutes: 10, reason: "FSRS: most overdue cards are optimizer updates — also your weakest topic (44%)." },
        { date: inDays(1).toISOString().slice(0, 10), kind: "quiz", label: "Re-quiz on gradient computation", minutes: 15, reason: "Mastery 0% on hand-computing one gradient entry." },
        { date: inDays(2).toISOString().slice(0, 10), kind: "exercise", label: "Finish the softmax derivation", minutes: 25, reason: "Exercise started but unsolved for 5 days." },
        { date: inDays(3).toISOString().slice(0, 10), kind: "reading", label: "Re-read recitation notes pp. 1–3", minutes: 30, reason: "Weak optimizer distinction traces to these pages." },
      ],
    },
  });

  /* ------------------------------------------------------------------ */
  /* Study set 2 — mid-processing (shows live dashboard state)           */
  /* ------------------------------------------------------------------ */

  const studySet2 = await prisma.studySet.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      title: "Graph Neural Networks — guest lecture",
      course: "CS 583 — Deep Learning",
      subject: "Machine learning",
      learnerLevel: "GRADUATE",
      language: "en",
      outputTypes: ["GUIDE", "FLASHCARDS", "QUIZ"],
      settings: { includeExternal: false },
      createdAt: daysAgo(0, -1),
    },
  });
  const yt = await prisma.source.create({
    data: {
      studySetId: studySet2.id,
      type: "YOUTUBE",
      title: "Guest lecture — message passing on graphs",
      status: "PROCESSING",
      externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      consentConfirmedAt: daysAgo(0, -1),
      metadata: { videoId: "dQw4w9WgXcQ", estimatedProcessingSec: 120 },
      createdAt: daysAgo(0, -1),
    },
  });
  await prisma.generationJob.create({
    data: {
      studySetId: studySet2.id,
      sourceId: yt.id,
      type: "INGEST_SOURCE",
      status: "RUNNING",
      stage: "transcribing",
      progress: 55,
      // demoFrozen: this row is a permanent "mid-processing" fixture, not real
      // work — orphan recovery (src/lib/queue/recovery.ts) must never re-run it
      // (it would attempt a real YouTube fetch and finish the demo state).
      payload: { sourceId: yt.id, demoFrozen: true },
      startedAt: daysAgo(0, -1),
      createdAt: daysAgo(0, -1),
    },
  });

  console.log(`Seeded. Sign in with:\n  email:    demo@lectureforge.app\n  password: demo-password`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
