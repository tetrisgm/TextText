import { GET as getTenantSitemap } from "@/app/t/[handle]/sitemap.xml/route";
import { withUsernameBlog } from "@/lib/username-routes";

export const GET = withUsernameBlog(getTenantSitemap);
