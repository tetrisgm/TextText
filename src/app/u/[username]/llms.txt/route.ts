import { GET as getTenantLlms } from "@/app/t/[handle]/llms.txt/route";
import { withUsernameBlog } from "@/lib/username-routes";

export const GET = withUsernameBlog(getTenantLlms);
