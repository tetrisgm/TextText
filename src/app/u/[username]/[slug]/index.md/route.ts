import { GET as getTenantPostMarkdown } from "@/app/t/[handle]/[slug]/index.md/route";
import { withUsernameBlog } from "@/lib/username-routes";

export const GET = withUsernameBlog(getTenantPostMarkdown);
