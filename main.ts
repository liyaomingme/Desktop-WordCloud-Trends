import { App, ItemView, Plugin, WorkspaceLeaf, Notice } from 'obsidian';

const VIEW_TYPE_STATS_HEATMAP = "desktop-stats-heatmap-view";

// --- 基础虚词过滤库 ---
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some'
]);

// --- 日期解析引擎 ---
function parseMessyDate(dateStr: string): string | null {
    const cleanStr = dateStr.replace(/[^\d./-]/g, '');
    let match = cleanStr.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (match) return formatStandardDate(match[1], match[2], match[3]);
    match = cleanStr.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) return formatStandardDate(match[1], match[2], match[3]);
    match = cleanStr.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (match) return formatStandardDate(`20${match[1]}`, match[2], match[3]);
    match = cleanStr.match(/^(\d{2})(\d{1})(\d{1})$/);
    if (match) return formatStandardDate(`20${match[1]}`, match[2], match[3]);
    match = cleanStr.match(/^(\d{2})(\d{1,2})(\d{1,2})$/);
    if (match && cleanStr.length === 5) {
        const monthDouble = parseInt(cleanStr.substring(2, 4));
        if (monthDouble >= 10 && monthDouble <= 12) {
            return formatStandardDate(`20${match[1]}`, cleanStr.substring(2, 4), cleanStr.substring(4, 5));
        }
        return formatStandardDate(`20${match[1]}`, cleanStr.substring(2, 3), cleanStr.substring(3, 5));
    }
    return null; 
}

function formatStandardDate(year: string, month: string, day: string): string {
    const y = year.length === 2 ? `20${year}` : year;
    const m = month.padStart(2, '0');
    const d = day.padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- 数据分析引擎 ---
async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    const wordCounts = new Map<string, number>();
    const dateTrend = new Map<string, number>(); 

    for (const file of files) {
        let noteDateStr = parseMessyDate(file.basename);
        if (!noteDateStr) {
            const createTime = new Date(file.stat.ctime);
            noteDateStr = createTime.toISOString().split('T')[0];
        }
        dateTrend.set(noteDateStr, (dateTrend.get(noteDateStr) || 0) + 1);

        const content = await app.vault.cachedRead(file);
        const cleanText = content
            .replace(/```[\s\S]*?```/g, '') 
            .replace(/---[\s\S]*?---/, '')  
            .replace(/[#*`>\[\]()]/g, '');  

        const words = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{3,}\b/g) || [];
        for (const word of words) {
            const w = word.toLowerCase();
            if (!STOP_WORDS.has(w)) {
                wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
            }
        }
    }

    return {
        heatmapWords: Array.from(wordCounts.entries())
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 100)
                            .map(([word, value]) => ({ word, value })),
        dateTrend: dateTrend
    };
}

// --- 热力图网格颜色引擎 ---
function getGridHeatmapColor(value: number, max: number): string {
    if (value === 0) {
        return 'var(--background-modifier-border)'; // 适配主题的极淡描边色
    }
    const ratio = Math.min(value / max, 1);
    const opacity = 0.25 + (ratio * 0.75); 
    return `rgba(0, 122, 255, ${opacity})`;
}

// --- 热力词纯文字颜色引擎（提高文字可读性的基础透明度） ---
function getTextHeatmapColor(value: number, max: number): string {
    const ratio = Math.min(value / max, 1);
    const opacity = 0.45 + (ratio * 0.55); // 文字基础透明度更高，确保浅色主题下也能看清
    return `rgba(0, 122, 255, ${opacity})`;
}

// --- 桌面端视图 ---
class DesktopStatsHeatmapView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS_HEATMAP; }
    getDisplayText() { return "知识资产热力"; }
    getIcon() { return "calendar-days"; } 

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-heatmap-dashboard-container');

        // 应用高分辨率全屏铺满 CSS，去除繁琐的边距，贴合原生质感
        container.setAttr('style', `
            padding: 24px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
            -webkit-font-smoothing: antialiased;
            background-color: var(--background-secondary);
        `);

        // 极简顶部标题（去掉下划线，完全留白）
        const headerDiv = container.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-shrink: 0;' } });
        headerDiv.createEl("h2", { text: "知识资产全景热力", attr: { style: 'margin: 0; font-size: 1.5em; font-weight: 600; letter-spacing: -0.5px;' } });
        const refreshBtn = headerDiv.createEl("button", { text: "重新计算", attr: { style: 'padding: 6px 16px; cursor: pointer; background-color: var(--interactive-accent); color: var(--text-on-accent); border-radius: 20px; border: none; font-size: 0.85em; font-weight: 500; transition: opacity 0.2s;' } });
        
        // 核心内容区
        const contentWrapper = container.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 24px; flex: 1;' } });

        // --- 模块 1：近一年产出活跃度 (完美复刻日历卡片质感：大圆角，无描边，柔和散影) ---
        const heatmapDiv = contentWrapper.createDiv({ 
            attr: { style: 'display: flex; flex-direction: column; background-color: var(--background-primary); border-radius: 20px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.02);' } 
        });
        heatmapDiv.createEl("h3", { text: "近一年产出活跃度", attr: { style: 'margin: 0 0 20px 0; font-size: 1.05em; color: var(--text-muted); font-weight: 500;' } });
        const heatmapWrapper = heatmapDiv.createDiv({ 
            attr: { style: 'display: flex; gap: 5px; overflow-x: auto; padding-bottom: 4px; width: 100%; align-items: center; justify-content: flex-start;' } 
        });

        // --- 模块 2：核心概念印刷体矩阵 ---
        const wordsDiv = contentWrapper.createDiv({ 
            attr: { style: 'display: flex; flex-direction: column; background-color: var(--background-primary); border-radius: 20px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.02); flex: 1;' } 
        });
        wordsDiv.createEl("h3", { text: "核心概念网络", attr: { style: 'margin: 0 0 24px 0; font-size: 1.05em; color: var(--text-muted); font-weight: 500;' } });
        const wordsWrapper = wordsDiv.createDiv({ 
            attr: { style: 'display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-content: flex-start; align-items: baseline;' } 
        });

        const renderData = async () => {
            refreshBtn.innerText = "计算中...";
            refreshBtn.disabled = true;
            refreshBtn.style.opacity = '0.5';
            heatmapWrapper.empty();
            wordsWrapper.empty();
            
            const { heatmapWords, dateTrend } = await analyzeVaultData(this.app);

            // ==========================================
            // 渲染模块 1：极简网格热力图
            // ==========================================
            const endDate = new Date();
            const startDate = new Date();
            startDate.setFullYear(endDate.getFullYear() - 1); 
            startDate.setDate(startDate.getDate() - startDate.getDay()); 

            const weeks: {date: string, count: number}[][] = [];
            let currentWeek: {date: string, count: number}[] = [];
            let currDate = new Date(startDate);
            let maxGridCount = 1;

            for (const [_, count] of dateTrend.entries()) {
                if (count > maxGridCount) maxGridCount = count;
            }

            while (currDate <= endDate) {
                const dateStr = currDate.toISOString().split('T')[0];
                const count = dateTrend.get(dateStr) || 0;
                currentWeek.push({ date: dateStr, count });

                if (currDate.getDay() === 6) { 
                    weeks.push(currentWeek);
                    currentWeek = [];
                }
                currDate.setDate(currDate.getDate() + 1);
            }
            if (currentWeek.length > 0) weeks.push(currentWeek);

            weeks.forEach(week => {
                const col = heatmapWrapper.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 5px;' } });
                week.forEach(day => {
                    const bgColor = getGridHeatmapColor(day.count, maxGridCount);
                    const cell = col.createDiv({
                        // 小方块使用更精致的 12px 和更柔和的 3px 圆角
                        attr: { style: `width: 12px; height: 12px; background-color: ${bgColor}; border-radius: 3px; cursor: pointer; transition: transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1);` }
                    });
                    cell.setAttr('title', `${day.date}: 产出 ${day.count} 篇`);
                    cell.addEventListener('mouseenter', () => cell.style.transform = 'scale(1.3)');
                    cell.addEventListener('mouseleave', () => cell.style.transform = 'scale(1)');
                });
            });

            // ==========================================
            // 渲染模块 2：纯粹印刷体艺术热力词 (Typographic Word Cloud)
            // ==========================================
            const maxWordCount = heatmapWords.length > 0 ? heatmapWords[0].value : 1;

            heatmapWords.forEach(({word, value}) => {
                const wordEl = wordsWrapper.createDiv();
                wordEl.setText(word);
                
                const textColor = getTextHeatmapColor(value, maxWordCount);
                // 彻底抛弃背景，依靠字号(13px-32px)和字重(400-700)建立信息层级
                const fontSize = Math.max(13, Math.min(32, 12 + (value/maxWordCount)*20));
                const fontWeight = value > maxWordCount * 0.4 ? '700' : '500';
                
                wordEl.setAttr("style", `
                    color: ${textColor}; 
                    padding: 4px 8px; 
                    font-size: ${fontSize}px;
                    font-weight: ${fontWeight};
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
                    line-height: 1.2;
                    user-select: none;
                `);
                
                wordEl.addEventListener('mouseenter', () => {
                    // 鼠标悬浮时：文字轻微放大，并散发对应颜色的辉光，极其优雅
                    wordEl.style.transform = 'scale(1.15)';
                    wordEl.style.textShadow = `0 6px 16px rgba(0, 122, 255, 0.35)`;
                    new Notice(`【${word}】: 出现 ${value} 次`);
                });
                
                wordEl.addEventListener('mouseleave', () => {
                    wordEl.style.transform = 'scale(1)';
                    wordEl.style.textShadow = 'none';
                });
            });

            refreshBtn.innerText = "重新计算";
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
        
        this.addRibbonIcon('calendar-days', '打开产出热力看板', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-heatmap-dashboard',
            name: '打开产出热力看板',
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
