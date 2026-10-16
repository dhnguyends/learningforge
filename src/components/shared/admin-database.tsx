"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, CheckCircle2, Database, HardDrive, Layers, Loader2, RefreshCw, TriangleAlert, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { useAdminDatabase, useRebuildVectorIndex, type AdminDatabaseStats } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

/** 1536 → "1.5 KB", 15728640 → "15 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "")} ${units[unit]}`;
}

const num = (n: number) => n.toLocaleString();

type CourseRow = AdminDatabaseStats["segmentation"]["byCourse"][number];
type SortKey = "title" | "owner" | "sources" | "passages" | "tokens" | "vectorBytes";

/**
 * Database tab: how big the vector database and the stored files are, how
 * sources were segmented into passages, what the embeddings look like, and
 * whether the semantic-search index is healthy (with a Rebuild action).
 */
export function AdminDatabase() {
  const [refresh, setRefresh] = useState(0);
  const { data, isLoading, isFetching, error } = useAdminDatabase(refresh);

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">{error?.message ?? "Could not load database figures"}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Database</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Vector database, segmentation and embeddings behind semantic search. Updated{" "}
            {new Date(data.generatedAt).toLocaleTimeString()}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRefresh((n) => n + 1)} disabled={isFetching}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden="true" /> Refresh
        </Button>
      </div>

      <Overview stats={data} />
      <IndexHealth stats={data} />
      <Segmentation stats={data} />
      <Embeddings stats={data} />
      <Tables stats={data} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint, tone }: { icon: typeof Database; label: string; value: string; hint?: string; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        <div className={cn("rounded-lg p-2", tone === "warn" ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary")}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function Overview({ stats }: { stats: AdminDatabaseStats }) {
  const { counts, database, files, index } = stats;
  const embeddedPct = counts.passages ? Math.round((counts.embedded / counts.passages) * 100) : 100;
  const indexOk = index.present && index.valid;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Stat icon={Database} label="Database size" value={formatBytes(database.sizeBytes)} hint={`PostgreSQL ${database.postgresVersion.split(" ")[0]}`} />
      <Stat
        icon={HardDrive}
        label="Uploaded files"
        value={formatBytes(files.sizeBytes)}
        hint={`${num(files.objects)} files · ${files.driver} storage`}
      />
      <Stat icon={Layers} label="Courses · sources" value={`${num(counts.studySets)} · ${num(counts.sources)}`} hint={`${num(counts.passages)} passages`} />
      <Stat
        icon={CheckCircle2}
        label="Passages with a vector"
        value={`${embeddedPct}%`}
        hint={`${num(counts.embedded)} of ${num(counts.passages)}`}
        tone={embeddedPct < 100 ? "warn" : "ok"}
      />
      <Stat
        icon={indexOk ? CheckCircle2 : TriangleAlert}
        label="Search index"
        value={indexOk ? "Healthy" : index.present ? "Invalid" : "Missing"}
        hint={indexOk ? `HNSW · ${formatBytes(index.sizeBytes)}` : "Searches scan every passage"}
        tone={indexOk ? "ok" : "warn"}
      />
    </div>
  );
}

function IndexHealth({ stats }: { stats: AdminDatabaseStats }) {
  const { index } = stats;
  const rebuild = useRebuildVectorIndex();
  const confirm = useConfirm();
  const ok = index.present && index.valid;

  async function onRebuild() {
    const yes = await confirm({
      title: ok ? "Rebuild the search index?" : "Create the search index?",
      description: ok
        ? "The HNSW index is rebuilt from all stored vectors. Searches and imports keep working meanwhile; it takes a few seconds per thousand passages."
        : "Semantic search currently scans every passage. Creating the HNSW index makes it fast again; searches and imports keep working meanwhile.",
      confirmLabel: ok ? "Rebuild index" : "Create index",
    });
    if (!yes) return;
    try {
      const res = await rebuild.mutateAsync();
      toast.success(`Search index ${res.rebuilt ? "rebuilt" : "created"} in ${(res.ms / 1000).toFixed(1)} s (${formatBytes(res.index.sizeBytes)})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Index rebuild failed");
    }
  }

  return (
    <Card className={ok ? undefined : "border-amber-500/40"}>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
              )}
              Semantic search index
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {ok
                ? `HNSW index on the passage vectors (cosine), ${formatBytes(index.sizeBytes)} — m=${index.m}, ef_construction=${index.efConstruction}.`
                : index.present
                  ? "The index exists but is invalid (an interrupted build). Searches fall back to scanning every passage."
                  : "No vector index: every search compares the question with every passage. Fine for a few hundred passages, slow beyond."}
            </p>
          </div>
          <Button size="sm" variant={ok ? "outline" : "default"} onClick={() => void onRebuild()} disabled={rebuild.isPending}>
            {rebuild.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Wrench className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {ok ? "Rebuild index" : "Create index"}
          </Button>
        </div>
        {index.definition && <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">{index.definition}</code>}
      </CardContent>
    </Card>
  );
}

function Segmentation({ stats }: { stats: AdminDatabaseStats }) {
  const seg = stats.segmentation;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "passages", desc: true });
  const courses = useMemo(() => {
    const rows = [...seg.byCourse];
    rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
      return sort.desc ? -cmp : cmp;
    });
    return rows;
  }, [seg.byCourse, sort]);

  const header = (key: SortKey, label: string, right = false) => (
    <th scope="col" className={cn("px-4 py-2 font-medium", right && "text-right")} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "title" && key !== "owner" }))}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
      </button>
    </th>
  );

  const sizes: [string, number][] = [
    ["Smallest", seg.minTokens],
    ["Average", seg.avgTokens],
    ["95th percentile", seg.p95Tokens],
    ["Largest", seg.largestTokens],
  ];

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold">Segmentation (passages)</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Sources are split into passages of about {seg.targetTokens} tokens (hard cap {seg.maxTokens}), each embedded and searched on its
            own. {num(stats.counts.passages)} passages, {num(stats.counts.tokens)} tokens in total.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          {sizes.map(([label, value]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn("text-base font-semibold tabular-nums", value > seg.maxTokens && "text-amber-700 dark:text-amber-400")}>
                {num(value)} tokens
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Passages by source type</caption>
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Source type</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Sources</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Passages</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Tokens</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Passages / source</th>
              </tr>
            </thead>
            <tbody>
              {seg.bySourceType.map((t) => (
                <tr key={t.type} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 font-medium">{t.type}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(t.sources)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(t.passages)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(t.tokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.sources ? (t.passages / t.sources).toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Passages by course</caption>
            <thead className="border-b border-border text-left text-xs tracking-wide text-muted-foreground">
              <tr>
                {header("title", "Course")}
                {header("owner", "Owner")}
                {header("sources", "Sources", true)}
                {header("passages", "Passages", true)}
                {header("tokens", "Tokens", true)}
                {header("vectorBytes", "Vectors", true)}
              </tr>
            </thead>
            <tbody>
              {courses.map((c: CourseRow) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/study-sets/${c.id}`} className="font-medium hover:underline">
                      {c.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{c.owner}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(c.sources)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(c.passages)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(c.tokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBytes(c.vectorBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Embeddings({ stats }: { stats: AdminDatabaseStats }) {
  const e = stats.embeddings;
  const padded = e.nativeDimensions != null && e.storedDimensions != null && e.storedDimensions > e.nativeDimensions;
  const rows: [string, string][] = [
    ["Provider · model", `${e.provider} · ${e.model}`],
    ["Model dimensions", e.nativeDimensions != null ? num(e.nativeDimensions) : "—"],
    ["Stored dimensions", e.storedDimensions != null ? `${num(e.storedDimensions)} (vector column)` : "—"],
    ["Size per vector", e.bytesPerVector != null ? `${formatBytes(e.bytesPerVector)} (${num(e.bytesPerVector)} bytes)` : "—"],
    ["All vectors", formatBytes(e.totalVectorBytes)],
    ["Similarity", `${e.metric} · relevance floor ${e.minScore.toFixed(2)}`],
    ["pgvector", stats.database.pgvectorVersion ?? "not installed"],
  ];
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h3 className="text-sm font-semibold">Embeddings</h3>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-2">
          {e.byModel.map((m) => (
            <Badge key={m.model} variant={m.current ? "secondary" : "outline"} className={m.current ? undefined : "border-amber-500/50 text-amber-700 dark:text-amber-400"}>
              {m.model}: {num(m.passages)} passages{m.current ? "" : " (other model)"}
            </Badge>
          ))}
        </div>

        {(e.missing > 0 || e.stale > 0) && (
          <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              {e.missing > 0 && `${num(e.missing)} passage(s) have no vector. `}
              {e.stale > 0 && `${num(e.stale)} passage(s) were embedded with another model and are skipped by search. `}
              Run <code>npx tsx scripts/reembed.ts</code> or use Import again on the affected sources.
            </span>
          </p>
        )}

        {padded && (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            The model produces {num(e.nativeDimensions!)} dimensions; they are zero-padded to the {num(e.storedDimensions!)}-dimension column,
            so {Math.round((1 - e.nativeDimensions! / e.storedDimensions!) * 100)}% of each stored vector is padding. Storing{" "}
            {num(e.nativeDimensions!)} dimensions, or half-precision vectors (pgvector <code>halfvec</code>), would cut vector storage by half
            or more without changing search results. Informational only — nothing is changed here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Tables({ stats }: { stats: AdminDatabaseStats }) {
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <caption className="px-5 pt-4 text-left text-sm font-semibold">Largest tables</caption>
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Table</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Rows (est.)</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Data</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Indexes</th>
              <th scope="col" className="px-4 py-2 text-right font-medium" title="Large values such as vectors are stored out of line (TOAST)">
                Overflow
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {stats.tables.map((t) => (
              <tr key={t.name} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2 font-mono text-xs">{t.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{num(t.rows)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBytes(t.dataBytes)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBytes(t.indexBytes)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBytes(t.overflowBytes)}</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">{formatBytes(t.totalBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
