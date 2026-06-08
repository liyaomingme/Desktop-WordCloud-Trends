import { App, ItemView, Plugin, WorkspaceLeaf } from 'obsidian';
import { Chart } from 'chart.js/auto';
import WordCloud from 'wordcloud';

const VIEW_TYPE_STATS = "desktop-stats-view";

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
    const trendData: Record<string, number> = {};

    for (const file of files) {
        let noteDate = parseMessyDate(file.basename);
        if (!noteDate) {
            const createTime = new Date(file.stat.ctime);
            noteDate = createTime.toISOString().split('T')[0];
        }
        trendData[noteDate] = (trendData[noteDate] || 0) + 1;

        const content = await app.vault.cachedRead(file);
        const cleanText = content
            .replace(/```[\s\S]*?```/g, '')
            .replace(/---[\s\S]*?---/, '')
            .replace(/[#*`>\[\]()]/g, '');

        const words = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{3,}\b/g) || [];
        for (const word of words) {
            const w = word.toLowerCase();
            wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
        }
    }

    const sortedDates = Object.keys(trendData).sort();
    return {
        chartLabels: sortedDates,
        chartValues: sortedDates.map(date => trendData[date]),
        sortedWords: Array.from(wordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 150) // 桌面端可展示更多词汇
    };
}

// --- 桌面端视图 ---
class DesktopStatsView extends ItemView {
    chartInstance: any = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS; }
    getDisplayText() { return "桌面端看板"; }
    getIcon() { return "monitor"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-dashboard-container');

        // 顶部栏
        const headerDiv = container.createDiv({ cls: 'stats-header-row' });
        headerDiv.createEl("h3", { text: "笔记数据全景透视", cls: 'stats-title' });
        const refreshBtn = headerDiv.createEl("button", { text: "刷新数据", cls: 'stats-refresh-btn' });
        
        // 横向分栏包裹器
        const contentWrapper = container.createDiv({ cls: 'stats-content-wrapper' });

        // 左侧：趋势图
        const chartDiv = contentWrapper.createDiv({ cls: 'canvas-container' });
        chartDiv.createEl("h4", { text: "产出趋势波折线", cls: 'stats-subtitle' });
        const chartCanvas = chartDiv.createEl("canvas", { attr: { id: "trend-chart" } });
        
        // 右侧：词云
        const wordDiv = contentWrapper.createDiv({ cls: 'canvas-container' });
        wordDiv.createEl("h4", { text: "全局核心热词", cls: 'stats-subtitle' });
        const wordCloudCanvas = wordDiv.createEl("canvas", { attr: { id: "word-cloud" } });

        const renderData = async () => {
            refreshBtn.innerText = "数据抓取中...";
            refreshBtn.disabled = true;
            
            const { chartLabels, chartValues, sortedWords } = await analyzeVaultData(this.app);

            if (this.chartInstance) this.chartInstance.destroy();
            this.chartInstance = new Chart(chartCanvas, {
                type: 'line',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        label: '笔记产量',
                        data: chartValues,
                        borderColor: '#3b82f6', 
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { 
                        x: { display: true }, // 桌面端空间大，开启 X 轴日期显示
                        y: { beginAtZero: true, ticks: { precision: 0 } }
                    } 
                }
            });

            WordCloud(wordCloudCanvas, {
                list: sortedWords,
                gridSize: Math.round(16 * wordCloudCanvas.offsetWidth / 1024),
                weightFactor: function (size) { return Math.pow(size, 0.85) * 3; }, 
                fontFamily: 'Inter, "PingFang SC", sans-serif',
                color: 'random-dark',
                rotateRatio: 0,
                backgroundColor: 'transparent'
            });

            refreshBtn.innerText = "刷新数据";
            refreshBtn.disabled = false;
        };

        refreshBtn.addEventListener('click', renderData);
        await renderData();
    }
}

export default class DesktopStatsPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS, (leaf) => new DesktopStatsView(leaf));
        this.addRibbonIcon('monitor', '打开桌面端看板', () => {
            this.activateView();
        });
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_STATS)[0];
        if (!leaf) {
            leaf = workspace.getLeaf('tab'); // 桌面端建议在新标签页打开，而非侧边栏
            await leaf.setViewState({ type: VIEW_TYPE_STATS, active: true });
        }
        workspace.revealLeaf(leaf);
    }
}
