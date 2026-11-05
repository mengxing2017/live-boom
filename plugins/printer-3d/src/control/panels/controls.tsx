import type { ReactNode } from 'react';
export const events = [['manual', '手动制作', '✎'], ['comment', '评论 666', '✉'], ['like', '点赞', '＋'], ['follow', '关注', '☆'], ['join', '进入', '↳'], ['heart', '爱心', '♡'], ['beer', '啤酒', '♧'], ['lollipop', '棒棒糖', '◎'], ['other', '其他', '◇']];
export const eventName = (value: unknown) => events.find(([key]) => key === value)?.[1] ?? String(value ?? '手动');
export const sourceName = (s: string) => s === 'demo' ? '离线模拟' : s === 'manual' ? '手动' : '旧版本地';
export function Panel({ title, tag, children, action }: {
    title: string;
    tag: string;
    children: ReactNode;
    action?: ReactNode;
}) { return <section className="panel"><header className="panel-heading"><h2>{title}<small>{tag}</small></h2>{action}</header><div className="panel-body">{children}</div></section>; }
export function Avatar({ name, src }: {
    name: unknown; src?: string;
}) { const text = String(name ?? '访客'); let h = 0; for (const c of text)
    h = (h * 31 + c.codePointAt(0)!) % 360; return <span className="avatar" style={{ background: `hsl(${h} 36% 38%)` }}>{src?<img src={src} alt={text}/>:Array.from(text).slice(0, 2).join('')}</span>; }
export function Toggle({ label, checked, onChange }: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) { return <label className="toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></label>; }
export function Choice({ label, value, options, onChange }: {
    label: string;
    value: unknown;
    options: (string | number | [
        string | number,
        string
    ])[];
    onChange: (v: string) => void;
}) { return <label className="field"><span>{label}</span><select value={String(value ?? '')} onChange={e => onChange(e.target.value)}>{options.map(option => { const [v, text] = Array.isArray(option) ? option : [option, String(option)]; return <option key={v} value={v}>{text}</option>; })}</select></label>; }
