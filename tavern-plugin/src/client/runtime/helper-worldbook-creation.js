function tavernLegacyWorldbookPatch(patch, original) {
	function copy(value) {
		try { return structuredClone(value); }
		catch (_) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
	}
	const next = copy(original || {});
	function set(path, value) {
		const parts = path.split("."); let target = next;
		for (const key of parts.slice(0, -1)) target = target[key] || (target[key] = {});
		target[parts[parts.length - 1]] = copy(value);
	}
	const mappings = { uid: "uid", comment: "name", enabled: "enabled", content: "content", probability: "probability", type: "strategy.type", keys: "strategy.keys", filters: "strategy.keys_secondary.keys", logic: "strategy.keys_secondary.logic", scan_depth: "strategy.scan_depth", order: "position.order", exclude_recursion: "recursion.prevent_incoming", prevent_recursion: "recursion.prevent_outgoing", sticky: "effect.sticky", cooldown: "effect.cooldown", delay: "effect.delay", group: "extra.group", display_index: "extra.displayIndex" };
	for (const key of Object.keys(mappings)) if (Object.prototype.hasOwnProperty.call(patch, key)) set(mappings[key], patch[key]);
	for (const pair of [["case_sensitive", "caseSensitive"], ["match_whole_words", "matchWholeWords"]]) if (Object.prototype.hasOwnProperty.call(patch, pair[0])) set("extra." + pair[1], patch[pair[0]] === "same_as_global" ? null : patch[pair[0]]);
	if (patch.depth !== undefined && patch.depth !== null) set("position.depth", patch.depth);
	if (patch.position !== undefined) {
		const match = /^at_depth_as_(system|user|assistant)$/.exec(patch.position);
		set("position.type", match ? "at_depth" : patch.position);
		if (match) set("position.role", match[1]);
	}
	if (patch.delay_until_recursion !== undefined) set("recursion.delay_until", patch.delay_until_recursion === false ? null : patch.delay_until_recursion === true ? 1 : patch.delay_until_recursion);
	const unsupported = { use_group_scoring: "same_as_global", automation_id: null, group_prioritized: false, group_weight: 100 };
	for (const key of Object.keys(unsupported)) if (patch[key] !== undefined && patch[key] !== unsupported[key]) throw new Error("当前兼容层尚未支持世界书字段: " + key);
	return next;
}

// The legacy single-entry API is a wrapper around the same validated bulk writer.
function installTavernWorldbookCreationApi(options) {
    const win = options.window, call = options.call;
    const previousNames = win.getWorldbookNames || (() => []);
    let knownNames = [];
    win.getWorldbookNames = function () {
        return Array.from(new Set(previousNames().concat(knownNames)));
    };
    win.getLorebooks = win.getWorldbookNames;
    win.createLorebook = async function (name) {
        const result = await call("createTavernHelperWorldbook", { name: name });
        knownNames = Array.isArray(result.names) ? result.names.slice() : knownNames;
        return result.created === true;
    };
    win.createLorebookEntry = async function (name, entry) {
        const result = await win.createWorldbookEntries(name, [options.legacyWorldbookPatch(entry)]);
        return result.new_entries[0].uid;
    };
    // Message frames have a smaller facade than card-script sandboxes.
    win.TavernHelper = win.TavernHelper || {};
    for (const name of ["getLorebooks", "getWorldbookNames", "createLorebook", "createLorebookEntry"]) {
        Object.defineProperty(win.TavernHelper, name, { configurable: true, enumerable: true,
            get: () => win[name], set: value => { win[name] = value; } });
    }
}
