import { NextResponse } from "next/server";
import { apiHandler, requireTeacher } from "@/lib/api";
import { classCsv } from "@/lib/polylingue/classes-service";

type Ctx = { params: { classId: string } };

/** The class dashboard as a CSV file (opens in Excel or LibreOffice). */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireTeacher();
  const { filename, csv } = await classCsv(session.user.id, params.classId);
  // A byte-order mark so Excel reads accents as UTF-8.
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
