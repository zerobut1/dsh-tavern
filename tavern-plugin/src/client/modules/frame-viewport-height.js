// A viewport-sized card cannot determine its own iframe viewport. Use the host
// viewport as a floor for page layouts, while retaining authored local scrollers.
function tavernFrameViewportFloor() {
	var viewport = 600;
	try { viewport = window.parent.innerHeight || viewport; } catch (_) {}
	viewport = Math.max(160, Math.min(1200, viewport));
	if (document.documentElement.hasAttribute('data-dsh-tavern-viewport-page')) return viewport;
	var rootViewport = false, contentViewport = false;
	function viewportHeight(style) {
		return /(?:^|[^\d.])100(?:d|s|l)?vh\b/i.test((style.height || '') + ' ' + (style.minHeight || ''));
	}
	function visible(node) {
        // The embedding adapter resets document roots to content height. An
        // overridden author rule on body/html is not a live viewport-sized panel.
        if (node === document.body || node === document.documentElement) return false;
        for (var ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (ancestor.tagName === 'DETAILS' && !ancestor.open) {
                var summary = ancestor.querySelector('summary');
                if (!summary || !summary.contains(node)) return false;
            }
        }
		var rect = node.getBoundingClientRect();
		var style = getComputedStyle(node);
		return rect.width > window.innerWidth / 2 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
	}
	function matchesRules(rules) {
		for (var rule of Array.from(rules || [])) {
			if (rule.media && !matchMedia(rule.media.mediaText).matches) continue;
			// Full-page wizards often size only html/body, then center absolute
			// screens inside body. The content-height adapter otherwise collapses
			// that containing block and places the screen above the iframe.
			if (rule.selectorText && rule.style && (viewportHeight(rule.style) || /^100%$/.test(rule.style.height))) {
				try {
					var nodes = Array.from(document.querySelectorAll(rule.selectorText));
					if (nodes.some(node => node === document.body || node === document.documentElement)) rootViewport = true;
					if (viewportHeight(rule.style) && nodes.some(visible)) contentViewport = true;
				} catch (_) {}
			}
			if (rule.cssRules) matchesRules(rule.cssRules);
		}
	}
	for (var sheet of Array.from(document.styleSheets)) {
		try { if (!sheet.disabled && (!sheet.media.mediaText || matchMedia(sheet.media.mediaText).matches)) matchesRules(sheet.cssRules); } catch (_) {}
	}
	var collapsedRoot = document.body.getBoundingClientRect().height < 1 && (rootViewport || viewportHeight(document.body.style) || document.body.style.height === '100%');
	for (var node of document.body.querySelectorAll('*')) {
		// Check the cheap conditions first; visible() measures layout.
		var style = getComputedStyle(node);
		if (collapsedRoot && /^(absolute|fixed)$/.test(style.position) && visible(node)) {
			document.documentElement.setAttribute('data-dsh-tavern-viewport-page', '');
			return viewport;
		}
		// Full-page fixed shells have no normal-flow height at all. Floating
		// buttons or small dialogs must not enlarge the frame.
		if (!viewportHeight(node.style) && !(style.position === 'fixed' && style.top === '0px' && style.bottom === '0px')) continue;
		if (visible(node)) contentViewport = true;
	}
	return contentViewport ? viewport : 0;
}
