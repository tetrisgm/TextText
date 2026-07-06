import { GET as getTenantFeed } from "@/app/t/[handle]/feed.xml/route";
import { withUsernameBlog } from "@/lib/username-routes";

export const GET = withUsernameBlog(getTenantFeed);
