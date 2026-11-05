import type { PrinterController } from '../state/usePrinterController';
import { Panel } from './controls';
export function MediaPanel({ controller }: { controller: PrinterController }) {
  const { run, command, setMedia, mediaFiles, setMediaFiles, license, setLicense } = controller;
  return <Panel title="自有素材与帮助" tag="RESOURCES"><button onClick={() => void run(async () => { const files = await command('media_list'); setMediaFiles(files as [
        string,
        number
    ][]); })}>读取已保存的图片</button>{mediaFiles.map(([reference, size]) => <div className="media-row" key={reference}><button onClick={() => setMedia(reference)}>选择 {reference.slice(6, 14)} · {Math.ceil(size / 1024)} KiB</button><button aria-label={`删除图像${reference.slice(6, 14)}`} onClick={() => void run(() => command('delete_media', { reference }))}>删除</button></div>)}<p className="note">被任务、历史或偏好引用的图片不可删除。导入后可在当前页面选择制作，刷新后可读取已保存图片。</p><details><summary>使用与许可</summary><p>先打开展示窗，再提交手动作品或运行离线模拟。采集使用独立展示窗；控制台预览不播音、不驱动任务。</p><p>界面、模型与运动学改编自 3d-printer-live，Copyright (c) 2026 志哥AI，MIT。React、Three.js 与 liveboom SDK 的完整许可随包提供。</p><button onClick={() => void run(async () => setLicense(String(await command('licenses'))))}>查看完整第三方许可</button>{license && <pre>{license}</pre>}</details></Panel>;
}
