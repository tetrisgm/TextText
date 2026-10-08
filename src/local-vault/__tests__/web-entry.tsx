import { createRoot } from "react-dom/client";
import { WebVault } from "../WebVault";
createRoot(document.getElementById("root")!).render(<WebVault assistantHandle="test" workspaceId="workspace" name="Web test workspace" accountEmail="test@example.com" accountName="Test account" />);
