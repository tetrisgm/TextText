import { GET as getTenantFolder } from "@/app/t/[handle]/folder.json/route";
import { withUsernameBlog } from "@/lib/username-routes";

export const GET = withUsernameBlog(getTenantFolder);
