import { GET as getTenantFeed } from "@/app/t/[handle]/feed.json/route";
import { withUsernameBlog } from "@/lib/username-routes";

export const GET = withUsernameBlog(getTenantFeed);
