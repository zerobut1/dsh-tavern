function TavernPosturePanel(props) {
    const h = React.createElement;
    const [draft, setDraft] = React.useState(null);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');
    const posture = String(props.posture || '');
    const conflict = draft !== null && draft.expected !== posture;
    function edit() { setDraft({ text: posture, expected: posture }); setError(''); }
    function cancel() { setDraft(null); setError(''); }
    async function save() {
        if (saving || props.busy || conflict || !draft) return;
        setSaving(true); setError('');
        try {
            await rpc('savePosture', { posture: draft.text, expectedPosture: draft.expected }, props.sessionId);
            setDraft(null);
            liveTavernView.invalidate(props.sessionId);
        } catch (err) {
            setError(String(err?.message || err));
            liveTavernView.invalidate(props.sessionId);
        } finally { setSaving(false); }
    }
    return h('section', { className: 'dsh-tavern-status-section', 'aria-label': '人物姿势' },
        h('div', { className: 'dsh-tavern-character-design-head' },
            h('div', { className: 'dsh-tavern-status-label' }, '人物姿势'),
            draft === null ? h('button', { type: 'button', className: 'dsh-tavern-btn', 'aria-label': '编辑人物姿势', disabled: props.busy, onClick: edit }, '编辑') : null),
        h('p', { className: 'dsh-tavern-settings-desc' }, props.enabled === false
            ? '后台维护已关闭，保存的状态暂不参与生成。'
            : '保存后用于下一轮生成，后续仍由后台继续更新。'),
        draft === null
            ? h('div', { className: posture ? 'dsh-tavern-status-now' : 'dsh-tavern-status-empty', style: { whiteSpace: 'pre-wrap' } }, posture || '尚无人物姿势，可手动填写或等待后台结算。')
            : h('div', { className: 'dsh-tavern-guide-add' },
                h('textarea', { className: 'dsh-tavern-regen-input', rows: 6, autoFocus: true, 'aria-label': '人物姿势内容', value: draft.text, disabled: saving,
                    onChange: event => setDraft({ ...draft, text: event.target.value }) }),
                conflict ? h('p', { className: 'dsh-card-error', role: 'alert' }, '人物姿势已更新，草稿已保留。') : null,
                props.busy ? h('p', { className: 'dsh-tavern-settings-desc' }, '当前正在生成或执行后台任务，结束后可保存。') : null,
                h('div', { className: 'dsh-tavern-style-actions' },
                    conflict ? h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: saving, onClick: edit }, '载入最新') : null,
                    h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: saving, onClick: cancel }, '取消'),
                    h('button', { type: 'button', className: 'dsh-card-primary', disabled: saving || props.busy || conflict || draft.text.trim() === posture, onClick: save }, saving ? '保存中…' : '保存'))),
        error ? h('p', { className: 'dsh-card-error', role: 'alert' }, error) : null);
}
