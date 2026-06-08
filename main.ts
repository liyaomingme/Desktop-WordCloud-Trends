import { App, ItemView, Plugin, WorkspaceLeaf } from 'obsidian';
import { Chart } from 'chart.js/auto';
import WordCloud from 'wordcloud';

const VIEW_TYPE_STATS = "desktop-stats-view";

// --- 基础虚词过滤库 (提升词云专业感) ---
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
            // 过滤掉无意义的虚词
            if (!STOP_WORDS.has(w)) {
                wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
            }
        }
    }

    const sortedDates = Object.keys(trendData).sort();
    return {
        chartLabels: sortedDates,
        chartValues: sortedDates.map(date => trendData[date]),
        sortedWords: Array.from(wordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 100) 
    };
}

// --- 桌面端视图 ---
class DesktopStatsView extends ItemView {
    chartInstance: any = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS; }
    getDisplayText() { return "数据看板"; }
    getIcon() { return "monitor"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-dashboard-container');

        const headerDiv = container.createDiv({ cls: 'stats-header-row' });
        headerDiv.createEl("h2", { text: "知识资产全景透视", cls: 'stats-title' });
        const refreshBtn = headerDiv.createEl("button", { text: "重新抓取数据", cls: 'stats-refresh-btn' });
        
        const contentWrapper = container.createDiv({ cls: 'stats-content-wrapper' });

        const chartDiv = contentWrapper.createDiv({ cls: 'panel-container' });
        chartDiv.createEl("h3", { text: "产出趋势", cls: 'stats-subtitle' });
        const chartWrapper = chartDiv.createDiv({ cls: 'canvas-wrapper' });
        const chartCanvas = chartWrapper.createEl("canvas", { attr: { id: "trend-chart" } });
        
        const wordDiv = contentWrapper.createDiv({ cls: 'panel-container' });
        wordDiv.createEl("h3", { text: "核心概念网络", cls: 'stats-subtitle' });
        const wordWrapper = wordDiv.createDiv({ cls: 'canvas-wrapper' });
        const wordCloudCanvas = wordWrapper.createEl("canvas", { attr: { id: "word-cloud" } });

        const renderData = async () => {
            refreshBtn.innerText = "数据计算中...";
            refreshBtn.disabled = true;
            
            const { chartLabels, chartValues, sortedWords } = await analyzeVaultData(this.app);

            // 1. 苹果风高级折线图绘制
            if (this.chartInstance) this.chartInstance.destroy();
            
            const ctx = (chartCanvas as HTMLCanvasElement).getContext('2d');
            let gradientFill = 'rgba(0, 122, 255, 0.1)';
            if (ctx) {
                gradientFill = ctx.createLinearGradient(0, 0, 0, chartWrapper.clientHeight);
                gradientFill.addColorStop(0, 'rgba(0, 122, 255, 0.35)'); // 顶部科技蓝
                gradientFill.addColorStop(1, 'rgba(0, 122, 255, 0.0)');  // 底部无缝融入背景
            }

            this.chartInstance = new Chart(chartCanvas as any, {
                type: 'line',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        label: '新增笔记数',
                        data: chartValues,
                        borderColor: '#007AFF', // 苹果生态经典蓝
                        backgroundColor: gradientFill,
                        borderWidth: 2.5,
                        pointRadius: 0, // 隐藏静态数据点
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#FFFFFF',
                        pointBorderColor: '#007AFF',
                        pointBorderWidth: 2,
                        tension: 0.4, // 极其平滑的曲线
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { 
                        legend: { display: false },
                        tooltip: { 
                            backgroundColor: 'rgba(0, 0, 0, 0.75)',
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: false,
                        }
                    },
                    scales: { 
                        x: { 
                            display: true, 
                            grid: { display: false }, // 干掉竖向网格
                            ticks: { color: '#8E8E93', maxRotation: 45 } 
                        },
                        y: { 
                            beginAtZero: true, 
                            border: { display: false }, 
                            grid: { color: 'rgba(142, 142, 147, 0.1)' }, // 极淡的高级横向辅助线
                            ticks: { precision: 0, color: '#8E8E93', padding: 10 }
                        }
                    } 
                }
            });

            // 2. 高级质感纯色渐变词云绘制
            const maxFreq = sortedWords.length > 0 ? sortedWords[0][1] : 1;
            wordCloudCanvas.width = wordWrapper.clientWidth;
            wordCloudCanvas.height = wordWrapper.clientHeight;
            
            const minSize = 16;
            const maxSize = 80;

            WordCloud(wordCloudCanvas, {
                list: sortedWords,
                gridSize: 10, // 增加间距留白，提升呼吸感
                weightFactor: function (size) { 
                    const normalized = size / maxFreq;
                    return (normalized * (maxSize - minSize)) + minSize; 
                }, 
                // 饱满厚重的无衬线字体族
                fontFamily: 'Impact, "Arial Black", "Helvetica Neue", "PingFang SC", sans-serif',
                fontWeight: '900', 
                // 动态透明度纯蓝算法
                color: function(word: string, weight: number, fontSize: number) {
                    const opacity = 0.30 + 0.70 * ((fontSize - minSize) / (maxSize - minSize));
                    return `rgba(0, 122, 255, ${opacity})`;
                },
                rotateRatio: 0, // 坚持水平排版
                shrinkToFit: true, 
                drawOutOfBound: false, 
                backgroundColor: 'transparent'
            });

            refreshBtn.innerText = "重新抓取数据";
            refreshBtn.disabled = false;
        };

        refreshBtn.addEventListener('click', renderData);
        setTimeout(renderData, 100); 
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
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_STATS, active: true });
        }
        workspace.revealLeaf(leaf);
    }
}
