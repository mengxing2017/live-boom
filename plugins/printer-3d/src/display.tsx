import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { startDisplay } from './index.js';
function Display() {
    const stage = useRef<HTMLDivElement>(null);
    const [overlay, setOverlay] = useState({ text: '', visible: true });
    useLayoutEffect(() => startDisplay({ stage: stage.current, overlay: (text: string, visible: boolean) => setOverlay({ text, visible }) }), []);
    return <><div id="stage" ref={stage}/><div id="caption" hidden={!overlay.visible || !overlay.text}>{overlay.text}</div></>;
}
flushSync(() => createRoot(document.getElementById('root')!).render(<Display />));
