import { App, ItemView, Plugin, WorkspaceLeaf } from 'obsidian';
import { Chart } from 'chart.js/auto';
import WordCloud from 'wordcloud';

const VIEW_TYPE_STATS = "stats-dashboard-view";

// --- 核心组件 1：极强兼容的日期解析引擎 ---
function parseMessyDate(dateStr: string): string | null {
    const cleanStr = dateStr.replace(/[^\d./-]/g, '');
    
    // 1. 标准格式 (2026.06.01, 2026-06-01, 2026/06/01)
    let match = cleanStr.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (match) return formatStandardDate(match[1], match[2], match[3]);

    // 2. 8位纯数字 (20260601)
    match = cleanStr.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) return formatStandardDate(match[1], match[2], match[3]);

    // 3. 6位纯数字 (260601 -> 2026-06-01)
    match = cleanStr.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (match) return formatStandardDate(`20${match[1]}`, match[2], match[3]);

    // 4. 4位极简数字 (2661 -> 2026-06-01) 
    match = cleanStr.match(/^(\d{2})(\d{1})(\d{1})$/);
    if (match) return formatStandardDate(`20${match[1]}`, match[2], match[3]);

    // 5. 5位数字歧义处理 (例如 26101 或 26112)
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

// --- 核心组件 2：数据提取与统计 ---
async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    const wordCounts = new Map<string, number>();
    const trendData: Record<string, number> = {};

    for (const file of files) {
        // A. 提取日期用于趋势图
        let noteDate = parseMessyDate(file.basename);
        if (!noteDate) {
            const createTime = new Date(file.stat.ctime);
            noteDate = createTime.toISOString().split('T')[0];
        }
        trendData[noteDate] = (trendData[noteDate] || 0) + 1;

        // B. 提取文本用于词云
        const content = await app.vault.cachedRead(file);
        const cleanText = content
            .replace(/```[\s\S]*?```/g, '') // 移除代码块
            .replace(/---[\s\S]*?---/, '')  // 移除 YAML Frontmatter
            .replace(/[#*`>\[\]()]/g, '');  // 移除常见特殊符号

        // 提取中文字符(2个字及以上) 和 英文单词(3个字母及以上)
        const words = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{3,}\b/g) || [];
        
        for (const word of words) {
            const w = word.toLowerCase();
            wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
        }
    }

    const sortedDates = Object.keys(trendData).sort();
    const chartLabels = sortedDates;
    const chartValues = sortedDates.map(date => trendData[date]);

    // 取出现频次最高的 120 个词生成词云
    const sortedWords = Array.from(wordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 120);

    return { chartLabels, chartValues, sortedWords };
}

// --- 核心组件 3：侧边栏面板视图 ---
class StatsDashboardView extends ItemView {
    chartInstance: any = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS; }
    getDisplayText() { return "知识产出洞察"; }
    getIcon() { return "line-chart"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-dashboard-container');

        const headerDiv = container.createDiv({ cls: 'stats-header-row' });
        headerDiv.createEl("h3", { text: "笔记数据看板", cls: 'stats-title' });
        const refreshBtn = headerDiv.createEl("button", { text: "刷新数据", cls: 'stats-refresh-btn' });
        
        const chartDiv = container.createDiv({ cls: 'canvas-container' });
        chartDiv.createEl("h4", { text: "产出趋势 (按日)", cls: 'stats-subtitle' });
        const chartCanvas = chartDiv.createEl("canvas", { attr: { id: "trend-chart" } });
        
        const wordDiv = container.createDiv({ cls: 'canvas-container', attr: { style: 'margin-top: 25px;' } });
        wordDiv.createEl("h4", { text: "全局核心词云", cls: 'stats-subtitle' });
        const wordCloudCanvas = wordDiv.createEl("canvas", { attr: { id: "word-cloud", width: "300", height: "300" } });

        const renderData = async () => {
            refreshBtn.innerText = "数据抓取中...";
            refreshBtn.disabled = true;
            
            const { chartLabels, chartValues, sortedWords } = await analyzeVaultData(this.app);

            // 绘制趋势波折线图
            if (this.chartInstance) this.chartInstance.destroy();
            this.chartInstance = new Chart(chartCanvas, {
                type: 'line',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        label: '每日新增笔记数',
                        data: chartValues,
                        borderColor: '#a882ff', 
                        backgroundColor: 'rgba(168, 130, 255, 0.2)',
                        borderWidth: 2,
                        pointRadius: 1, // 缩小数据点，让折线更平滑清爽
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { 
                        x: { display: false }, // 移动端隐藏 X 轴密集标签
                        y: { beginAtZero: true, ticks: { precision: 0 } } // Y轴只显示整数
                    } 
                }
            });

            // 绘制词云
            WordCloud(wordCloudCanvas, {
                list: sortedWords,
                gridSize: Math.round(16 * wordCloudCanvas.offsetWidth / 1024),
                weightFactor: function (size) { return Math.pow(size, 0.8) * 2.5; }, 
                fontFamily: 'Inter, "PingFang SC", sans-serif',
                color: 'random-dark',
                rotateRatio: 0, // 保持文字全部水平展示
                backgroundColor: 'transparent'
            });

            refreshBtn.innerText = "刷新数据";
            refreshBtn.disabled = false;
        };

        refreshBtn.addEventListener('click', renderData);
        await renderData(); // 首次打开自动渲染
    }
}

// --- 插件注册入口 ---
export default class StatsDashboardPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS, (leaf) => new StatsDashboardView(leaf));

        // 在左侧边栏添加一个一键呼出按钮
        this.addRibbonIcon('line-chart', '打开数据看板', () => {
            this.activateView();
        });
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_STATS)[0];
        
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_STATS, active: true });
        }
        workspace.revealLeaf(leaf);
    }
}
