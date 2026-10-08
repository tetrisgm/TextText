import { afterEach, expect, it, vi } from "vitest";
import { VaultError } from "./bridge";
import { retryBootstrap } from "./bootstrap-retry";
afterEach(()=>vi.useRealTimers());
it("recovers temporary readiness errors but bounds retries",async()=>{
 vi.useFakeTimers();const read=vi.fn().mockRejectedValueOnce(new VaultError("busy","503")).mockResolvedValue(null);
 const result=retryBootstrap(read,new AbortController().signal);await vi.runAllTimersAsync();expect(await result).toBeNull();expect(read).toHaveBeenCalledTimes(2);
 const failed=vi.fn().mockRejectedValue(new VaultError("offline","503"));const failure=expect(retryBootstrap(failed,new AbortController().signal)).rejects.toThrow("offline");await vi.runAllTimersAsync();await failure;expect(failed).toHaveBeenCalledTimes(3);
});
it.each(["401","403","404","unauthorized","not_found","permission_denied"])("does not retry terminal %s",async code=>{
 const read=vi.fn().mockRejectedValue(new VaultError("terminal",code));await expect(retryBootstrap(read,new AbortController().signal)).rejects.toThrow("terminal");expect(read).toHaveBeenCalledTimes(1);
});
it("bounds ignored cancellation and cancels a queued retry",async()=>{
 vi.useFakeTimers();const stalled=vi.fn(()=>new Promise(()=>{}));const failure=expect(retryBootstrap(stalled,new AbortController().signal)).rejects.toThrow("longer");await vi.runAllTimersAsync();await failure;expect(stalled).toHaveBeenCalledTimes(3);
 const controller=new AbortController();const read=vi.fn().mockRejectedValue(new VaultError("offline","503"));const cancelled=expect(retryBootstrap(read,controller.signal)).rejects.toBeDefined();await vi.advanceTimersByTimeAsync(1);controller.abort();await cancelled;await vi.runAllTimersAsync();expect(read).toHaveBeenCalledTimes(1);
});

it("timeout remains retryable when transport synchronously rejects on abort",async()=>{
 vi.useFakeTimers();const read=vi.fn((signal:AbortSignal)=>new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(new DOMException("Canceled","AbortError")),{once:true})));
 const result=expect(retryBootstrap(read,new AbortController().signal)).rejects.toMatchObject({code:"408"});await vi.runAllTimersAsync();await result;expect(read).toHaveBeenCalledTimes(3);
});
