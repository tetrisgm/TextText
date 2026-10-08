import { afterEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("./bridge", () => ({ vaultRequest: request }));
import { folderMoveDestination, prepareFolderMoveReview } from "./FolderMoveDialog";
const reviewPath = "/proposals/11111111-1111-4111-8111-111111111111";
afterEach(() => vi.resetAllMocks());
describe("shared folder move review", () => {
  it.each(["Notes", "Notes/Child", "../escape", "/Archive", "Archive//Notes", "Archive/.hidden"])("rejects invalid destination %s before requests", async destination => {
    await expect(prepareFolderMoveReview("Notes", destination, false)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("normalizes a destination and returns the stored web review without applying a move", async () => {
    request.mockResolvedValue({ reviewPath });
    expect(folderMoveDestination("Notes", " Archive/Notes ")).toBe("Archive/Notes");
    expect(await prepareFolderMoveReview("Notes", " Archive/Notes ", false)).toBe(reviewPath);
    expect(request).toHaveBeenCalledExactlyOnceWith("folderMoveReview", { source: "Notes", destination: "Archive/Notes" });
  });
  it("uses the desktop's authenticated workspace origin for its review link", async () => {
    request.mockResolvedValueOnce({ reviewPath }).mockResolvedValueOnce({ webURL: "https://texttext.test/vault/workspace" });
    expect(await prepareFolderMoveReview("Notes", "Archive/Notes", true)).toBe(`https://texttext.test${reviewPath}`);
    expect(request).toHaveBeenLastCalledWith("connection");
  });
  it("rejects arbitrary review URLs and unsafe desktop origins", async () => {
    request.mockResolvedValueOnce({ reviewPath: "https://other.test/review" });
    await expect(prepareFolderMoveReview("Notes", "Archive/Notes", false)).rejects.toThrow("could not be opened");
    request.mockResolvedValueOnce({ reviewPath }).mockResolvedValueOnce({ webURL: "http://other.test" });
    await expect(prepareFolderMoveReview("Notes", "Archive/Notes", true)).rejects.toThrow("invalid");
  });
});
