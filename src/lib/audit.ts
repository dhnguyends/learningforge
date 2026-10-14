import { prisma } from "@/lib/db";

export interface AuditEntry {
  userId?: string | null;
  action: string; // "ai.generation" | "source.delete" | "account.export" | "account.delete" ...
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/** Audit trail for AI generations and privacy-sensitive actions. Never throws. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: (entry.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write entry", entry.action, err);
  }
}
