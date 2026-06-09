import { App, ItemView, Plugin, WorkspaceLeaf, Notice, Modal, TFile } from 'obsidian';

const VIEW_TYPE_STATS_HEATMAP = "desktop-stats-heatmap-view";

// --- 基础虚词过滤库 ---
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过',
    '可以', '一个', '没有', '我们', '什么', '这个'
]);

// --- 升级版数据分析引擎 (追踪文件来源) ---
async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    // 改变数据结构，不仅记录次数，还记录出现过的文件集合
    const wordData = new Map<string, { count: number, files: Set<TFile> }>();

    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        const cleanText = content
            .replace(/```[\s\S]*?```/g, '') 
            .replace(/---[\s\S]*?---/, '')  
            .replace(/[#*`>\[\]()]/g, '');  

        const words = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{3,}\b/g) || [];
        for (const word of words) {
            const w = word.toLowerCase();
            if (!STOP_WORDS.has(w)) {
                if (!wordData.has(w)) {
                    wordData.set(w, { count: 0, files: new Set() });
                }
                const entry = wordData.get(w)!;
                entry.count++;
                entry.files.add(file);
            }
        }
    }

    return Array.from(wordData.entries())
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 80) // 缩减到 Top 80 确保页面留白比例完美
                .map(([word, data]) => ({ word, value: data.count, files: Array.from(data.files) }));
}

// --- 颜色引擎 ---
function getTextOpacity(value: number, max: number): number {
    const ratio = Math.min(value / max, 1);
    return 0.45 + (ratio * 0.55); // 提高基础透明度，确保浅色模式极度清晰
}

// --- 核心新功能：沉浸式上下文溯源 Modal ---
class WordContextModal extends Modal {
    word: string;
    files: TFile[];

    constructor(app: App, word: string, files: TFile[]) {
        super(app);
        this.word = word;
        this.files = files;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Modal 整体样式优化
        this.modalEl.style.maxWidth = '800px';
        this.modalEl.style.width = '90vw';
        this.modalEl.style.borderRadius = '20px';
        this.modalEl.style.padding = '32px';

        // 标题区
        contentEl.createEl('h2', { 
            text: `「${this.word}」的知识图谱`,
            attr: { style: 'margin: 0 0 8px 0; font-size: 1.8em; font-weight: 800; color: var(--interactive-accent); font-family: "PingFang SC", "Arial Black", sans-serif;' }
        });
        contentEl.createEl('p', {
            text: `共在 ${this.files.length} 篇笔记中被提及`,
            attr: { style: 'margin: 0 0 24px 0; color: var(--text-muted); font-size: 1em;' }
        });

        // 结果列表容器
        const listContainer = contentEl.createDiv({
            attr: { style: 'max-height: 60vh; overflow-y: auto; padding-right: 10px; display: flex; flex-direction: column; gap: 16px;' }
        });

        for (const file of this.files) {
            const content = await this.app.vault.cachedRead(file);
            
            // 截取上下文正则匹配 (前后各取 35 个字符)
            const safeWord = this.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 防止正则崩溃
            const regex = new RegExp(`.{0,35}${safeWord}.{0,35}`, 'gi');
            const matches = content.match(regex) || [];

            if (matches.length > 0) {
                const card = listContainer.createDiv({
                    attr: { style: 'background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s ease;' }
                });
                
                card.addEventListener('mouseenter', () => {
                    card.style.borderColor = 'var(--interactive-accent)';
                    card.style.transform = 'translateY(-2px)';
                    card.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.05)';
                });
                card.addEventListener('mouseleave', () => {
                    card.style.borderColor = 'var(--background-modifier-border)';
                    card.style.transform = 'translateY(0)';
                    card.style.boxShadow = 'none';
                });

                // 点击卡片直接打开对应笔记
                card.addEventListener('click', async () => {
                    const leaf = this.app.workspace.getLeaf(false);
                    await leaf.openFile(file);
                    this.close(); // 跳转后自动关闭弹窗
                });

                // 笔记标题
                card.createEl('div', {
                    text: `📄 ${file.basename}`,
                    attr: { style: 'font-weight: 700; font-size: 1.1em; margin-bottom: 12px; color: var(--text-normal);' }
                });

                // 渲染匹配到的片段 (最多展示 3 处)
                const displayMatches = matches.slice(0, 3);
                for (let match of displayMatches) {
                    const snippetDiv = card.createDiv({ attr: { style: 'font-size: 0.95em; color: var(--text-muted); line-height: 1.6; margin-bottom: 8px; background: var(--background-primary); padding: 8px 12px; border-radius: 8px;' } });
                    
                    // 高亮关键词
                    const parts = match.split(new RegExp(`(${safeWord})`, 'gi'));
                    snippetDiv.appendChild(document.createTextNode('"...'));
                    parts.forEach(part => {
                        if (part.toLowerCase() === this.word.toLowerCase()) {
                            const span = snippetDiv.createEl('span', { text: part, attr: { style: 'color: #fff; background-color: var(--interactive-accent); padding: 2px 6px; border-radius: 4px; font-weight: bold; margin: 0 2px;' } });
                        } else {
                            snippetDiv.appendChild(document.createTextNode(part));
                        }
                    });
                    snippetDiv.appendChild(document.createTextNode('..."'));
                }
            }
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

// --- 桌面端视图 ---
class DesktopStatsHeatmapView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS_HEATMAP; }
    getDisplayText() { return "知识洞察"; }
    getIcon() { return "key"; } 

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-typographic-dashboard');

        // 顶级容器排版优化：拉大间距，提升高级感
        container.setAttr('style', `
            padding: 40px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Arial Black", sans-serif;
            -webkit-font-smoothing: antialiased;
            background-color: var(--background-secondary);
        `);

        // 顶部操作栏
        const headerDiv = container.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; flex-shrink: 0;' } });
        headerDiv.createEl("h1", { text: "Knowledge Insights", attr: { style: 'margin: 0; font-size: 2.2em; font-weight: 800; letter-spacing: -1px; color: var(--text-normal);' } });
        const refreshBtn = headerDiv.createEl("button", { text: "重新扫描神经元", attr: { style: 'padding: 10px 24px; cursor: pointer; background-color: var(--interactive-accent); color: var(--text-on-accent); border-radius: 30px; border: none; font-size: 1em; font-weight: 600; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 4px 16px rgba(0, 122, 255, 0.25);' } });
        
        refreshBtn.addEventListener('mouseenter', () => refreshBtn.style.transform = 'translateY(-2px) scale(1.02)');
        refreshBtn.addEventListener('mouseleave', () => refreshBtn.style.transform = 'translateY(0) scale(1)');

        // 核心画板：更纯粹的留白，更大的间隙
        const wordsCanvas = container.createDiv({ 
            attr: { style: 'display: flex; flex-wrap: wrap; gap: 24px 36px; justify-content: center; align-content: center; align-items: center; background-color: var(--background-primary); border-radius: 32px; padding: 60px; box-shadow: 0 16px 48px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02); flex: 1;' } 
        });

        const renderData = async () => {
            refreshBtn.innerText = "扫描中...";
            refreshBtn.disabled = true;
            refreshBtn.style.opacity = '0.6';
            wordsCanvas.empty();
            
            const heatmapWords = await analyzeVaultData(this.app);

            if (heatmapWords.length === 0) {
                wordsCanvas.createEl("div", { text: "暂无足够的数据积累...", attr: { style: 'color: var(--text-muted); font-size: 1.2em;' } });
                return;
            }

            const maxWordCount = heatmapWords[0].value;

            // 渲染饱满、透气、绝不挤压的热力词
            heatmapWords.forEach(({word, value, files}) => {
                const wordEl = wordsCanvas.createDiv();
                wordEl.setText(word);
                
                const opacity = getTextOpacity(value, maxWordCount);
                // 字号映射：16px 到 54px 的巨大张力
                const fontSize = Math.max(16, Math.min(54, 14 + (value/maxWordCount)*40));
                
                wordEl.setAttr("style", `
                    color: rgba(0, 122, 255, ${opacity}); 
                    font-size: ${fontSize}px;
                    font-weight: 800; /* 强制极粗、饱满字体 */
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    line-height: 1.2;
                    user-select: none;
                    letter-spacing: 0.5px;
                    white-space: nowrap; /* 核心修复：绝对防止词语被折断拧在一起 */
                    word-break: keep-all;
                `);
                
                wordEl.addEventListener('mouseenter', () => {
                    wordEl.style.transform = 'scale(1.1) translateY(-4px)';
                    wordEl.style.color = 'rgba(0, 122, 255, 1)';
                    wordEl.style.textShadow = `0 12px 24px rgba(0, 122, 255, 0.3)`;
                });
                
                wordEl.addEventListener('mouseleave', () => {
                    wordEl.style.transform = 'scale(1) translateY(0)';
                    wordEl.style.color = `rgba(0, 122, 255, ${opacity})`;
                    wordEl.style.textShadow = 'none';
                });

                // 点击触发上下文 Modal
                wordEl.addEventListener('click', () => {
                    new WordContextModal(this.app, word, files).open();
                });
            });

            refreshBtn.innerText = "重新扫描神经元";
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
        };

        refreshBtn.addEventListener('click', renderData);
        setTimeout(renderData, 150); 
    }
}

// --- 插件主入口 ---
export default class DesktopStatsPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS_HEATMAP, (leaf) => new DesktopStatsHeatmapView(leaf));
        
        this.addRibbonIcon('key', '打开知识洞察', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-typographic-insights',
            name: '打开知识洞察',
            callback: () => {
                this.activateView();
            }
        });
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_STATS_HEATMAP);
    }

    async activateView() {
        const { workspace } = this.app;
        
        let existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_STATS_HEATMAP);
        for (let i = 0; i < existingLeaves.length; i++) {
            existingLeaves[i].detach(); 
        }

        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_STATS_HEATMAP, active: true });
            workspace.revealLeaf(leaf);
        }
    }
}
