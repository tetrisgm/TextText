/** Server lifecycle only: ordinary CLI/file-engine imports retain Node's default signal behavior. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installReadDrain } = await import("./sync/engine/read-drain");
    installReadDrain();
  }
}
