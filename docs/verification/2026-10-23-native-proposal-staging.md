# Native proposal staging identity, 2026-10-23

Native asset/template calls carried stable mutation keys but lacked stable proposal-staging identity. Retrying a lost response could create another pending review. Requests with an explicit captured workspace now derive staging identity from the allowlisted command name and key for asset add, look save, template version, retirement and application. Feed identities remain compatible. Calls without the captured workspace keep their prior restaging semantics.

Original production code fails all five new lost-stage regressions. Corrected code passes all 53 proposal tests and Mac TypeScript in `/private/tmp/texttext-feed-integrated.TunNxi`; logs `native-stage-red-five.log`, `native-stage-final.log`, `native-stage-types.log`. Existing owner/folder refusal, frozen source/hash approval, audit and completed-operation recovery tests remain passing. No fetch or mutation occurs during proposal staging; no review or durability check was bypassed.

An initial broader identity change also affected non-native post-review restaging; those failures led to the captured-workspace restriction above. This is code verification only. Native adapter and installed acceptance remain separate gates.
