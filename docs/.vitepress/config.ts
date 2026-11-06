import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const repository = 'https://github.com/mengxing2017/live-boom';

const config = withMermaid(defineConfig({
  lang: 'zh-CN',
  title: 'liveboom',
  description: '本地互动桌面客户端与插件开发文档',
  cleanUrls: true,
  mermaid: { securityLevel: 'strict' },
  markdown: {
    config(md) {
      // Keep repository-relative links useful in Markdown and in the standalone site.
      md.core.ruler.after('inline', 'repository-links', state => {
        for (const block of state.tokens) for (const token of block.children ?? []) {
          if (token.type !== 'link_open') continue;
          const href = token.attrGet('href');
          if (!href?.startsWith('../')) continue;
          const [path, fragment] = href.slice(3).split('#');
          if (path === 'README.md') {
            token.attrSet('href', '/project-overview' + (fragment ? `#${fragment}` : ''));
          } else {
            const kind = path.endsWith('/') ? 'tree' : 'blob';
            token.attrSet('href', `${repository}/${kind}/main/${path.split('/').map(encodeURIComponent).join('/')}${fragment ? `#${fragment}` : ''}`);
          }
        }
      });
    }
  },
  themeConfig: {
    siteTitle: 'liveboom 文档',
    nav: [
      { text: '开发指南', link: '/plugin-development' },
      { text: '插件 API', link: '/plugin-api-reference' },
      { text: '测试与交付', link: '/plugin-testing-and-release' },
      { text: '客户端运行', link: '/project-overview' }
    ],
    sidebar: [
      {
        text: '开始使用', items: [
          { text: '文档首页', link: '/' },
          { text: '项目与开发环境', link: '/project-overview' },
          { text: '文档站使用与维护', link: '/documentation' },
          { text: '3D 制作台', link: '/printer-3d' }
        ]
      },
      {
        text: '插件开发', items: [
          { text: 'React 插件开发指南', link: '/plugin-development' },
          { text: 'API 与权限参考', link: '/plugin-api-reference' },
          { text: '测试、签名与交付', link: '/plugin-testing-and-release' }
        ]
      },
      {
        text: '维护与架构', items: [
          { text: '开发数据目录与重置', link: '/development-data-reset' },
          { text: '架构与验证记录', link: '/refactoring-validation' }
        ]
      }
    ],
    search: { provider: 'local' },
    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '切换深色模式',
    socialLinks: [{ icon: 'github', link: repository }],
    footer: { message: 'MIT · 宿主 0.2.3 / SDK 0.2.3 · 本地互动与独立插件开发' }
  }
}));

// The plugin's legacy transitive includes are not resolvable from a strict pnpm root.
// Vite can discover them through the actual Mermaid entry instead.
config.vite!.optimizeDeps!.include = ['mermaid'];

export default config;
