"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseTreeView } from "@/components/shared/course-tree";
import { useTaxonomy, type TaxonomyScope } from "@/hooks/use-api";

export default function ExplorePage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <Explore />
    </Suspense>
  );
}

/**
 * Explore: the course tree (Discipline › Subject › Course / Module › Topic)
 * with the courses filed under each topic. Users see their own courses;
 * administrators can switch to every course (?scope=all) and are the only
 * ones who file courses under topics. "Has courses" is on by default and
 * remembered per browser.
 */
function Explore() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const scope: TaxonomyScope = isAdmin && params.get("scope") === "all" ? "all" : "mine";
  const { data, isLoading, error } = useTaxonomy(scope, session !== undefined);
  const setScope = (next: TaxonomyScope) => router.replace(next === "all" ? `${pathname}?scope=all` : pathname, { scroll: false });

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Compass className="h-6 w-6 text-primary" aria-hidden="true" /> Explore
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope === "all" ? "Every course" : "Your courses"}, organised by Discipline › Subject › Course / Module › Topic.
          </p>
        </div>
        {isAdmin && (
          <div role="group" aria-label="Whose courses" className="inline-flex rounded-md border border-border p-0.5">
            {(["mine", "all"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={scope === s ? "secondary" : "ghost"}
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className="h-7"
              >
                {s === "mine" ? "My courses" : "All courses"}
              </Button>
            ))}
          </div>
        )}
      </div>

      <CourseTreeView
        key={scope}
        data={data}
        isLoading={isLoading}
        error={error}
        canClassify={isAdmin}
        hasCoursesKey="lf.explore.hasCourses"
        hasCoursesDefault
      />
    </div>
  );
}
