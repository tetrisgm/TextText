import { GET as getTenantPosts } from "@/app/t/[handle]/posts.json/route";
import { withUsernameBlog } from "@/lib/username-routes";

export const GET = withUsernameBlog(getTenantPosts);
