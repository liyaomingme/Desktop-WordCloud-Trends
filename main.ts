import { App, ItemView, Plugin, WorkspaceLeaf, Notice, Modal, TFile, setIcon } from 'obsidian';

const VIEW_TYPE_STATS_HEATMAP = "desktop-stats-heatmap-view";

// --- 基础虚词过滤库 (加入更多中文常用虚词，保持数据精准) ---
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过',
    '可以', '一个', '没有', '我们', '什么', '这个', '如果是', '怎么', '如果',
    '可以说', '这样', '很多', '非常', '进行', '然后'
]);

// --- 升级版数据分析引擎 (追踪文件来源与上下文片段) ---
async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    // 数据结构：记录次数与出现过的文件集合
    const wordData = new Map<string, { count: number, files: Set<TFile> }>();

    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        // 极速提纯内容，忽略代码块、YAML、Markdown符号
        const cleanText = content
            .replace(/```[\s\S]*?```/g, '') 
            .replace(/---[\s\S]*?---/, '')  
            .replace(/[#*`>\[\]()]/g, '');  

        // 匹配 2 个以上的中文字符或 3 个以上的英文字符
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
                .slice(0, 75) // 缩减到 Top 75 确保页面留白比例完美
                .map(([word, data]) => ({ word, value: data.count, files: Array.from(data.files) }));
}

// --- 颜色引擎：极具张力的苹果蓝 ---
function getTextOpacity(value: number, max: number): number {
    const ratio = Math.min(value / max, 1);
    return 0.40 + (ratio * 0.60); // 提高基础透明度，确保浅色模式清晰
}

// --- 核心功能：沉浸式上下文溯源 Modal (防卡顿、防高亮失败升级) ---
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
        this.modalEl.style.maxWidth = '850px';
        this.modalEl.style.width = '92vw';
        this.modalEl.style.borderRadius = '24px';
        this.modalEl.style.padding = '40px';
        this.modalEl.style.boxShadow = '0 24px 60px rgba(0,0,0,0.06)';

        // 标题区
        contentEl.createEl('h2', { 
            text: `「${this.word}」的知识图谱`,
            attr: { style: 'margin: 0 0 10px 0; font-size: 2em; font-weight: 850; color: var(--interactive-accent); font-family: "SF Pro Display", "PingFang SC", sans-serif; letter-spacing: -0.5px;' }
        });
        contentEl.createEl('p', {
            text: `共在 ${this.files.length} 篇笔记中被提及`,
            attr: { style: 'margin: 0 0 28px 0; color: var(--text-muted); font-size: 1.1em;' }
        });

        // 结果列表容器 (防卡顿，开启异步渲染)
        const listContainer = contentEl.createDiv({
            attr: { style: 'max-height: 62vh; overflow-y: auto; padding-right: 15px; display: flex; flex-direction: column; gap: 20px;' }
        });

        // 将文件卡片分批渲染，防止弹窗瞬间卡顿
        this.app.workspace.addDomBatchUpdate(async () => {
            for (const file of this.files) {
                const content = await this.app.vault.cachedRead(file);
                
                // 截取上下文正则匹配 (前后各取 45 个字符)
                const safeWord = this.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 防止正则崩溃
                const regex = new RegExp(`.{0,45}${safeWord}.{0,45}`, 'gi');
                const matches = content.match(regex) || [];

                if (matches.length > 0) {
                    const card = listContainer.createDiv({
                        attr: { style: 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 16px; padding: 20px; cursor: pointer; transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);' }
                    });
                    
                    card.addEventListener('mouseenter', () => {
                        card.style.borderColor = 'var(--interactive-accent)';
                        card.style.transform = 'translateY(-3px)';
                        card.style.boxShadow = '0 12px 24px rgba(0, 0, 0, 0.04)';
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
                    const fileTitle = card.createEl('div', {
                        attr: { style: 'font-weight: 800; font-size: 1.25em; margin-bottom: 16px; color: var(--text-normal); font-family: "SF Pro Text", "PingFang SC", sans-serif; display: flex; align-items: center;' }
                    });
                    const fileIconSpan = fileTitle.createEl('span', { attr: { style: 'margin-right: 8px; opacity: 0.7;' } });
                    setIcon(fileIconSpan, 'document');
                    fileTitle.appendChild(document.createTextNode(file.basename));

                    // 渲染匹配到的片段 (最多展示 3 处)
                    const displayMatches = matches.slice(0, 3);
                    for (let match of displayMatches) {
                        const snippetDiv = card.createDiv({ attr: { style: 'font-size: 1em; color: var(--text-muted); line-height: 1.6; margin-bottom: 12px; background: var(--background-primary); padding: 10px 16px; border-radius: 10px;' } });
                        
                        // 高亮关键词 (优化：更温和的高亮正则)
                        const parts = match.split(new RegExp(`(${safeWord})`, 'gi'));
                        snippetDiv.appendChild(document.createTextNode('"...'));
                        parts.forEach(part => {
                            if (part.toLowerCase() === this.word.toLowerCase()) {
                                const span = snippetDiv.createEl('span', { text: part, attr: { style: 'color: #fff; background-color: var(--interactive-accent); padding: 2px 6px; border-radius: 6px; font-weight: bold; margin: 0 2px;' } });
                            } else {
                                snippetDiv.appendChild(document.createTextNode(part));
                            }
                        });
                        snippetDiv.appendChild(document.createTextNode('..."'));
                    }
                }
            }
        });
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

        // 顶级容器排版优化：拉大边距，应用极度通透的背景
        container.setAttr('style', `
            padding: 40px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
            -webkit-font-smoothing: antialiased;
            background-color: var(--background-secondary);
        `);

        // ==========================================
        // 核心修正 1：集成“扫描”按钮至 Title，全案重构审美与排版
        // ==========================================
        const headerDiv = container.createDiv({ 
            attr: { 
                style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 48px; flex-shrink: 0; cursor: pointer; user-select: none; transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);',
                title: '点击此处即可一键重新扫描神经元'
            } 
        });
        
        // 苹果风饱满、黑体极粗 Title 结构，集成防折行、防拧排版
        const titleDiv = headerDiv.createDiv({
            attr: {
                style: 'display: flex; align-items: center; white-space: nowrap;' // 核心防拧
            }
        });
        const iconSpan = titleDiv.createEl('span', { attr: { style: 'width: 32px; height: 32px; color: var(--interactive-accent); margin-right: 16px;' } });
        setIcon(iconSpan, 'heatmap'); // 更换为符合数据全景意义的日历图标
        
        // 强制饱满字重，增加视觉张力，去除长细丑态
        const titleText = titleDiv.createEl("h1", { 
            text: "Knowledge Insights", 
            attr: { 
                style: 'margin: 0; font-size: 2.25em; font-weight: 850; letter-spacing: -1px; color: var(--text-normal); font-family: "SF Pro Display", "PingFang SC", "Arial Black", sans-serif;' 
            } 
        });

        // 集成至 Title 的点击扫描逻辑与动效
        const startScanning = async () => {
            titleDiv.style.opacity = '0.5';
            titleText.innerText = "扫描中...";
            headerDiv.style.pointerEvents = 'none';
            await this.renderWords(); // 执行核心渲染
            headerDiv.style.pointerEvents = 'auto';
            titleText.innerText = "Knowledge Insights";
            titleDiv.style.opacity = '1';
        }
        
        headerDiv.addEventListener('mouseenter', () => {
            headerDiv.style.transform = 'translateY(-2px) scale(1.015)';
        });
        headerDiv.addEventListener('mouseleave', () => {
            headerDiv.style.transform = 'translateY(0) scale(1)';
        });
        
        headerDiv.addEventListener('click', startScanning);

        // 核心画板：更大的四周呼吸空间，完美复刻日历卡片留白质感
        this.wordsCanvas = container.createDiv({ 
            attr: { style: 'display: flex; flex-wrap: wrap; gap: 28px 48px; justify-content: center; align-content: center; align-items: flex-start; background-color: var(--background-primary); border-radius: 36px; padding: 72px 80px; box-shadow: 0 16px 48px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02); flex: 1;' } 
        });

        // 将核心渲染逻辑剥离至 this 方法，方便一键刷新调用
        await this.renderWords();
    }

    // 独立的热力词核心渲染方法
    async renderWords() {
        if (!this.wordsCanvas) return;
        this.wordsCanvas.empty();
        
        const heatmapWords = await analyzeVaultData(this.app);

        if (heatmapWords.length === 0) {
            this.wordsCanvas.createEl("div", { text: "暂无足够的数据积累...", attr: { style: 'color: var(--text-muted); font-size: 1.3em;' } });
            return;
        }

        const maxWordCount = heatmapWords[0].value;

        // ==========================================
        // 核心修正 2：彻底消灭“拧在一起”与丑比例，手写排版规则
        // ==========================================
        heatmapWords.forEach(({word, value, files}) => {
            const wordEl = this.wordsCanvas.createDiv();
            wordEl.setText(word);
            
            const opacity = getTextOpacity(value, maxWordCount);
            // 饱满、黑体极粗、防折行排版映射：16px 到 60px 巨大视觉张力
            const fontSize = Math.max(16, Math.min(60, 16 + (value/maxWordCount)*44));
            
            wordEl.setAttr("style", `
                color: rgba(0, 122, 255, ${opacity}); 
                font-size: ${fontSize}px;
                font-weight: 850; /* 强制苹果饱满黑体 */
                cursor: pointer;
                transition: all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                line-height: 1.1;
                user-select: none;
                letter-spacing: -0.5px;
                white-space: nowrap; /* 核心修正：绝对禁止词组内部折行 */
                word-break: keep-all; /* 核心修正：绝对禁止液冷长词被挤压拧在一起 */
                padding-top: ${10 - (value/maxWordCount)*10}px; /* 动态间距补偿，确保大字和小字永远对齐且不挤压 */
                vertical-align: top;
            `);
            
            wordEl.addEventListener('mouseenter', () => {
                wordEl.style.transform = 'scale(1.12) translateY(-6px)';
                wordEl.style.color = 'rgba(0, 122, 255, 1)';
                wordEl.style.textShadow = `0 16px 32px rgba(0, 122, 255, 0.35)`;
            });
            
            wordEl.addEventListener('mouseleave', () => {
                wordEl.style.transform = 'scale(1) translateY(0)';
                wordEl.style.color = `rgba(0, 122, 255, ${opacity})`;
                wordEl.style.textShadow = 'none';
            });

            // 点击触发防崩溃沉浸式 Modal
            wordEl.addEventListener('click', () => {
                new WordContextModal(this.app, word, files).open();
            });
        });
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
