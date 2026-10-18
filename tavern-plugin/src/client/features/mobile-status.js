// The phone opens the original card panel on demand in a separate host page.
function registerTavernMobileStatus(ctx) {
    const sessionId = new URLSearchParams(window.location.search).get("tavern-mobile-status");
    if (!sessionId) return;
    const executeSlash = createTavernFrameSlashExecutor(ctx);
    function MobileStatus() {
        const state = useLiveTavernView(sessionId);
        React.useEffect(function () {
            const timer = setInterval(() => liveTavernView.invalidate(sessionId), 2000);
            return () => clearInterval(timer);
        }, []);
        return React.createElement("main", { className: "dsh-tavern-mobile-status" },
            state.error ? React.createElement("p", { role: "alert" }, state.error) : null,
            state.view ? React.createElement(TavernPersistentStatusRuntime, {
                sessionId, view: state.view, panels: "status", executeSlash
            }) : React.createElement("p", { role: "status" }, "正在加载状态栏…"));
    }
    ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "dsh-tavern-mobile-status", order: 100
    }, MobileStatus)), "dsh-tavern: mobile card status");
}
