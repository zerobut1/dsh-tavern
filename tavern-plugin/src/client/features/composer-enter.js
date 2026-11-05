// Route through the editor's native line-break handling. Inserting a literal
// '\n' with insertText creates a TextNode, not a deletable LineBreakNode.
function installTavernComposerEnter(host) {
    let composingUntil = 0;
    function composer(event) {
        const input = event.target?.closest?.('[data-composer-input][contenteditable="true"]');
        return input?.closest('[data-composer-seat]') === host ? input : null;
    }
    function compositionEnd(event) {
        if (composer(event)) composingUntil = Date.now() + 10;
    }
    function keydown(event) {
        if (event.key !== 'Enter' || event.defaultPrevented) return;
        const input = composer(event);
        if (!input || event.isComposing || event.keyCode === 229 || input.hasAttribute('data-composer-composing') || Date.now() < composingUntil) return;
        // Ctrl+Enter keeps DSH's native submit guards and busy-send policy.
        // Shift+Enter already inserts a line break in the native editor.
        if (event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // Only Ctrl+Enter sends; do not retain the native Cmd+Enter alias.
        if (event.metaKey) return;
        const view = input.ownerDocument.defaultView;
        const handled = !input.dispatchEvent(new view.InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'insertLineBreak'
        }));
        // Engines without beforeinput support handle Shift+Enter in keydown.
        if (!handled) input.dispatchEvent(new view.KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true
        }));
    }
    host.addEventListener('keydown', keydown, true);
    host.addEventListener('compositionend', compositionEnd, true);
    return function () {
        host.removeEventListener('keydown', keydown, true);
        host.removeEventListener('compositionend', compositionEnd, true);
    };
}

function TavernComposerEnter(props) {
    const anchor = React.useRef(null);
    React.useLayoutEffect(function () {
        const host = anchor.current?.closest('[data-composer-seat]');
        if (host) return installTavernComposerEnter(host);
    }, [props.sessionId]);
    return React.createElement('span', { ref: anchor, hidden: true });
}

function registerTavernComposerEnter(ctx, slots) {
    ctx.effect(() => slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'dsh-tavern-composer-enter', order: -310 },
        TavernComposerEnter
    )), 'dsh-tavern: Enter newline, Ctrl+Enter send');
}
