let usageChart, tempChart, memoryGauge, memoryLineChart, diskChart, netChart;
let ws;

// Historical data for line charts.
const historySize = 10;
const gpuHistory = [];
const cpuHistory = [];
const gpuTempHistory = [];
const systemTempHistory = [];
const memoryHistory = [];
const diskReadHistory = [];
const diskWriteHistory = [];
const netRxHistory = [];
const netTxHistory = [];
const pendingCommands = {};

// Docker log streaming state.
let activeLogContainerId = null;

const dockerActions = {
	'docker-start': {
		label: 'Start',
		pendingLabel: 'Starting...',
		selector: '.start-btn',
		shouldShow: (isRunning, isDashboard) => !isRunning,
		confirm: null
	},
	'docker-stop': {
		label: 'Stop',
		pendingLabel: 'Stopping...',
		selector: '.stop-btn',
		shouldShow: (isRunning, isDashboard) => isRunning && !isDashboard,
		confirm: 'Are you sure you want to stop this container?'
	},
	'docker-restart': {
		label: 'Restart',
		pendingLabel: 'Starting...',
		selector: '.restart-btn',
		shouldShow: (isRunning, isDashboard) => isRunning && isDashboard,
		confirm: 'Are you sure you want to restart this container?'
	}
};

// Consistent colors for GPU and CPU.
const GPU_COLOR = 'rgb(75, 192, 192)';
const GPU_BG_COLOR = 'rgba(75, 192, 192, 0.1)';
const CPU_COLOR = 'rgb(54, 162, 235)';
const CPU_BG_COLOR = 'rgba(54, 162, 235, 0.1)';

/* ==========================================================
   Theme system
   ========================================================== */

const themes = {
	light:        'Light',
	dark:         'Dark',
	brutalist:    'Neo-Brutalist',
	glass:        'Glass',
	solarized:    'Solarized Dark',
	dracula:      'Dracula',
	nord:         'Nord',
	nvidia:       'NVIDIA Green',
	'retro-amber':'Retro Amber',
};

let currentTheme = 'light';
let pixelRainActive = false;
let pixelRainAnimId = null;
let pixelRainResizeHandler = null;

function initTheme() {
	const select = document.getElementById('theme-select');
	for (const [id, label] of Object.entries(themes)) {
		const opt = document.createElement('option');
		opt.value = id;
		opt.textContent = label;
		select.appendChild(opt);
	}

	const saved = localStorage.getItem('dgx-theme');
	if (saved && themes[saved]) {
		currentTheme = saved;
	}
	select.value = currentTheme;
	applyTheme(currentTheme);

	select.addEventListener('change', () => {
		currentTheme = select.value;
		localStorage.setItem('dgx-theme', currentTheme);
		applyTheme(currentTheme);
	});

	// Accent color picker.
	const accentInput = document.getElementById('accent-color');
	const savedAccent = localStorage.getItem('dgx-accent');
	if (savedAccent) {
		accentInput.value = savedAccent;
		document.documentElement.style.setProperty('--accent', savedAccent);
	} else {
		// Read the theme's default accent so the picker starts correct.
		setTimeout(() => {
			accentInput.value = rgbToHex(getThemeVar('--accent'));
		}, 0);
	}
	accentInput.addEventListener('input', (e) => {
		const color = e.target.value;
		document.documentElement.style.setProperty('--accent', color);
		localStorage.setItem('dgx-accent', color);
	});

	// When theme changes, reset accent picker to theme default if no custom accent.
	select.addEventListener('change', () => {
		if (!localStorage.getItem('dgx-accent')) {
			setTimeout(() => {
				accentInput.value = rgbToHex(getThemeVar('--accent'));
			}, 50);
		}
	});
}

function applyTheme(theme) {
	document.documentElement.setAttribute('data-theme', theme);

	// Restore accent if custom.
	const savedAccent = localStorage.getItem('dgx-accent');
	if (savedAccent) {
		document.documentElement.style.setProperty('--accent', savedAccent);
	}

	updateChartTheme();

	if (theme === 'brutalist') {
		startPixelRain();
	} else {
		stopPixelRain();
	}
}

function getThemeVar(name) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function updateChartTheme() {
	const gridColor = getThemeVar('--chart-grid');
	const textColor = getThemeVar('--chart-text');
	const legendColor = getThemeVar('--chart-legend');
	const gaugeEmpty = getThemeVar('--gauge-empty');
	const gaugeLabel = getThemeVar('--gauge-label');
	const gaugeSublabel = getThemeVar('--gauge-sublabel');

	const charts = [usageChart, tempChart, memoryLineChart, diskChart, netChart];
	for (const chart of charts) {
		if (!chart) continue;
		if (chart.options.scales?.y) {
			chart.options.scales.y.grid = { color: gridColor };
			chart.options.scales.y.ticks = { color: textColor };
			if (chart.options.scales.y.title) {
				chart.options.scales.y.title.color = textColor;
			}
		}
		if (chart.options.plugins?.legend) {
			chart.options.plugins.legend.labels = { color: legendColor };
		}
		chart.update('none');
	}

	if (memoryGauge) {
		const ds = memoryGauge.data.datasets[0];
		if (ds.backgroundColor && ds.backgroundColor.length === 2) {
			ds.backgroundColor[1] = gaugeEmpty;
		}
		const ann = memoryGauge.options.plugins.annotation.annotations;
		if (ann.usedLabel) ann.usedLabel.color = gaugeLabel;
		if (ann.totalLabel) ann.totalLabel.color = gaugeSublabel;
		memoryGauge.update('none');
	}
}

/* ==========================================================
   Pixel rain (Matrix effect) - brutalist theme only
   ========================================================== */

const pixelRainChars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';

function hexToRgb(hex) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return { r, g, b };
}

function startPixelRain() {
	if (pixelRainActive) return;
	pixelRainActive = true;

	const canvas = document.getElementById('pixel-rain');
	const ctx = canvas.getContext('2d');
	const fontSize = 14;
	let columns;
	let drops;

	function resize() {
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		columns = Math.floor(canvas.width / fontSize);
		drops = new Array(columns).fill(1).map(() => Math.random() * -100);
	}

	resize();
	pixelRainResizeHandler = resize;
	window.addEventListener('resize', resize);

	let lastFrame = 0;
	const frameInterval = 1000 / 30;

	function draw(timestamp) {
		if (!pixelRainActive) return;
		if (timestamp - lastFrame < frameInterval) {
			pixelRainAnimId = requestAnimationFrame(draw);
			return;
		}
		lastFrame = timestamp;

		// Derive rain color from accent.
		const accentHex = rgbToHex(getThemeVar('--accent'));
		const { r, g, b } = hexToRgb(accentHex);

		ctx.fillStyle = 'rgba(10, 10, 10, 0.05)';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.12)`;
		ctx.font = `${fontSize}px monospace`;

		for (let i = 0; i < columns; i++) {
			const char = pixelRainChars[Math.floor(Math.random() * pixelRainChars.length)];
			ctx.fillText(char, i * fontSize, drops[i] * fontSize);
			if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
				drops[i] = 0;
			}
			drops[i] += 0.5 + Math.random() * 0.5;
		}
		pixelRainAnimId = requestAnimationFrame(draw);
	}

	pixelRainAnimId = requestAnimationFrame(draw);
}

function stopPixelRain() {
	pixelRainActive = false;
	if (pixelRainAnimId) {
		cancelAnimationFrame(pixelRainAnimId);
		pixelRainAnimId = null;
	}
	if (pixelRainResizeHandler) {
		window.removeEventListener('resize', pixelRainResizeHandler);
		pixelRainResizeHandler = null;
	}
	const canvas = document.getElementById('pixel-rain');
	if (canvas) {
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}
}

/* ==========================================================
   Loading overlay
   ========================================================== */

let loadingDismissed = false;

function dismissLoading() {
	if (loadingDismissed) return;
	loadingDismissed = true;
	const overlay = document.getElementById('loading-overlay');
	if (overlay) {
		overlay.classList.add('hidden');
		setTimeout(() => overlay.style.display = 'none', 500);
	}
}

function showLoadingError(message) {
	const overlay = document.getElementById('loading-overlay');
	if (overlay && !loadingDismissed) {
		overlay.classList.add('error');
		overlay.querySelector('.loading-text').textContent = message;
	}
}

/* ==========================================================
   Utility: format bytes/sec to human readable
   ========================================================== */

function rgbToHex(str) {
	// Convert "rgb(r, g, b)" or "#hex" to "#hex".
	if (!str) return '#4ec9b0';
	if (str.startsWith('#')) return str.length > 7 ? str.slice(0, 7) : str;
	const m = str.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (!m) return '#4ec9b0';
	return '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatBytesPerSec(bytes) {
	return `${formatBytes(bytes)}/s`;
}

/* ==========================================================
   Charts
   ========================================================== */

function createGauge(canvasId, label, maxValue) {
	const ctx = document.getElementById(canvasId).getContext('2d');
	return new Chart(ctx, {
		type: 'doughnut',
		data: {
			datasets: [{
				data: [0, maxValue],
				backgroundColor: [
					'rgb(75, 192, 192)',
					getThemeVar('--gauge-empty') || 'rgb(230, 230, 230)'
				],
				borderWidth: 0,
				circumference: 180,
				rotation: 270,
				cutout: '60%',
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			aspectRatio: 2,
			plugins: {
				legend: { display: false },
				tooltip: { enabled: false },
				annotation: {
					annotations: {
						usedLabel: {
							type: 'doughnutLabel',
							content: '0',
							font: { size: 32, weight: 'bold' },
							color: getThemeVar('--gauge-label') || 'black',
							yAdjust: 20,
							position: { x: 'center', y: '80%' }
						},
						totalLabel: {
							type: 'doughnutLabel',
							content: label,
							font: { size: 14 },
							color: getThemeVar('--gauge-sublabel') || 'gray',
							yAdjust: 20,
							position: { x: 'center', y: '0%' },
						}
					}
				}
			}
		}
	});
}

function updateGauge(chart, value, maxValue) {
	const yellowFrom = maxValue * 0.6;
	const redFrom = maxValue * 0.8;

	let color;
	if (value >= redFrom) color = 'rgb(255, 99, 132)';
	else if (value >= yellowFrom) color = 'rgb(255, 205, 86)';
	else color = 'rgb(75, 192, 192)';

	maxValue = Math.trunc(maxValue);
	if (value > maxValue) value = maxValue;

	const gaugeEmpty = getThemeVar('--gauge-empty') || 'rgb(230, 230, 230)';
	chart.data.datasets[0].data = [value, maxValue - value];
	chart.data.datasets[0].backgroundColor = [color, gaugeEmpty];
	chart.options.plugins.annotation.annotations.usedLabel.content = `${value.toFixed(1)}GB`;
	chart.options.plugins.annotation.annotations.totalLabel.content = `/${maxValue}GB`;
	chart.update('none');
}

function createIOChart(canvasId, label1, label2, color1, color2) {
	const ctx = document.getElementById(canvasId).getContext('2d');
	return new Chart(ctx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: label1,
				data: [],
				borderColor: color1,
				backgroundColor: color1.replace(')', ', 0.1)').replace('rgb', 'rgba'),
				tension: 0.4,
				fill: true,
			}, {
				label: label2,
				data: [],
				borderColor: color2,
				backgroundColor: color2.replace(')', ', 0.1)').replace('rgb', 'rgba'),
				tension: 0.4,
				fill: true,
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					title: { display: true, text: 'Bytes/s' },
					ticks: {
						callback: (v) => formatBytes(v),
					}
				},
				x: { display: false }
			},
			plugins: {
				legend: { position: 'bottom' },
				tooltip: {
					callbacks: {
						label: (ctx) => `${ctx.dataset.label}: ${formatBytesPerSec(ctx.raw)}`
					}
				}
			}
		}
	});
}

function initCharts() {
	// Usage line chart
	const usageCtx = document.getElementById('usage-chart').getContext('2d');
	usageChart = new Chart(usageCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'GPU %',
				data: [],
				borderColor: GPU_COLOR,
				backgroundColor: GPU_BG_COLOR,
				tension: 0.4,
			}, {
				label: 'CPU %',
				data: [],
				borderColor: CPU_COLOR,
				backgroundColor: CPU_BG_COLOR,
				tension: 0.4,
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: { beginAtZero: true, max: 100, title: { display: true, text: 'Usage %' } },
				x: { display: false }
			},
			plugins: { legend: { position: 'bottom' } }
		}
	});

	// Temperature line chart
	const tempCtx = document.getElementById('temp-chart').getContext('2d');
	tempChart = new Chart(tempCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'GPU C',
				data: [],
				borderColor: GPU_COLOR,
				backgroundColor: GPU_BG_COLOR,
				tension: 0.4,
			}, {
				label: 'System C',
				data: [],
				borderColor: CPU_COLOR,
				backgroundColor: CPU_BG_COLOR,
				tension: 0.4,
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: { beginAtZero: true, max: 100, title: { display: true, text: 'Temperature C' } },
				x: { display: false }
			},
			plugins: { legend: { position: 'bottom' } }
		}
	});

	memoryGauge = createGauge('memory-gauge', '/128GB', 100);

	const memoryCtx = document.getElementById('memory-chart').getContext('2d');
	memoryLineChart = new Chart(memoryCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'Memory',
				data: [],
				borderColor: 'rgb(75, 192, 192)',
				backgroundColor: 'rgba(75, 192, 192, 0.1)',
				tension: 0.4,
				segment: {
					borderColor: ctx => {
						const maxValue = ctx.chart.options.scales.y.max;
						const value = ctx.p1.parsed.y;
						if (value >= maxValue * 0.8) return 'rgb(255, 99, 132)';
						if (value >= maxValue * 0.6) return 'rgb(255, 205, 86)';
						return 'rgb(75, 192, 192)';
					}
				}
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: { beginAtZero: true, max: 128, title: { display: true, text: 'GB' } },
				x: { display: false }
			},
			plugins: { legend: { display: false } }
		}
	});

	// Disk I/O chart
	diskChart = createIOChart('disk-chart', 'Read', 'Write', 'rgb(54, 162, 235)', 'rgb(255, 159, 64)');

	// Network I/O chart
	netChart = createIOChart('net-chart', 'RX', 'TX', 'rgb(75, 192, 192)', 'rgb(153, 102, 255)');

	updateChartTheme();
}

/* ==========================================================
   Update functions
   ========================================================== */

function updateCharts(data) {
	const usedGB = data.memory.usedKB / 1000000;
	const totalGB = data.memory.totalKB / 1000000;
	const memoryUsed = parseFloat(usedGB.toFixed(1));

	gpuHistory.push(data.gpu?.usagePercent);
	cpuHistory.push(data.cpu.usagePercent);
	gpuTempHistory.push(data.gpu?.temperatureC);
	systemTempHistory.push(data.temperature.systemTemperatureC);
	memoryHistory.push(memoryUsed);

	if (gpuHistory.length > historySize) {
		gpuHistory.shift(); cpuHistory.shift(); gpuTempHistory.shift();
		systemTempHistory.shift(); memoryHistory.shift();
	}

	// Usage chart.
	usageChart.data.labels = Array.from({ length: gpuHistory.length }, (_, i) => i + 1);
	usageChart.data.datasets[0].data = [...gpuHistory];
	usageChart.data.datasets[1].data = [...cpuHistory];
	usageChart.update('none');

	// Temperature chart.
	tempChart.data.labels = Array.from({ length: gpuTempHistory.length }, (_, i) => i + 1);
	tempChart.data.datasets[0].data = [...gpuTempHistory];
	tempChart.data.datasets[1].data = [...systemTempHistory];
	tempChart.update('none');

	// Memory gauge + line.
	updateGauge(memoryGauge, memoryUsed, totalGB);
	memoryGauge.update('none');
	memoryLineChart.data.labels = Array.from({ length: memoryHistory.length }, (_, i) => i + 1);
	memoryLineChart.data.datasets[0].data = [...memoryHistory];
	memoryLineChart.update('none');

	// Browser tab title.
	const maxUsage = Math.max(data.gpu?.usagePercent ?? 0, data.cpu.usagePercent);
	const maxTemp = Math.max(data.gpu?.temperatureC ?? 0, data.temperature.systemTemperatureC);
	document.title = `DGX ${Math.trunc(usedGB).toFixed(0)}GB ${maxUsage.toFixed(0)}% ${maxTemp.toFixed(0)}C`;
}

function updateGpuInfoBar(data) {
	if (!data.gpu) return;
	const gpu = data.gpu;

	document.getElementById('gpu-pstate').textContent = gpu.performanceState || '--';

	// GPU clock — hide if 0 (N/A from nvidia-smi).
	const gfxClockEl = document.getElementById('gpu-clock-gfx');
	const gfxStatEl = gfxClockEl.closest('.gpu-stat');
	if (gpu.clockGraphicsMHz > 0) {
		gfxClockEl.textContent = `${gpu.clockGraphicsMHz} MHz`;
		gfxStatEl.style.display = '';
	} else {
		gfxStatEl.style.display = 'none';
	}

	// Memory clock — hide if 0 (N/A on GB10 unified memory).
	const memClockEl = document.getElementById('gpu-clock-mem');
	const memClockStatEl = memClockEl.closest('.gpu-stat');
	if (gpu.clockMemoryMHz > 0) {
		memClockEl.textContent = `${gpu.clockMemoryMHz} MHz`;
		memClockStatEl.style.display = '';
	} else {
		memClockStatEl.style.display = 'none';
	}

	// Power — show draw only if limit is N/A (0).
	if (gpu.powerLimitW > 0) {
		document.getElementById('gpu-power-stat').textContent =
			`${gpu.powerW?.toFixed(0) ?? '--'} / ${gpu.powerLimitW?.toFixed(0)} W`;
	} else {
		document.getElementById('gpu-power-stat').textContent =
			`${gpu.powerW?.toFixed(0) ?? '--'} W`;
	}

	// VRAM — hide if N/A (0 total = unified memory, no separate VRAM).
	const vramEl = document.getElementById('gpu-vram-stat');
	const vramStatEl = vramEl.closest('.gpu-stat');
	if (gpu.vramTotalMB > 0) {
		vramEl.textContent = `${gpu.vramUsedMB} / ${gpu.vramTotalMB} MB`;
		vramStatEl.style.display = '';
	} else {
		vramStatEl.style.display = 'none';
	}

	// Throttle reasons.
	const throttleEl = document.getElementById('gpu-throttle');
	const throttleStat = document.getElementById('throttle-stat');
	const reasons = gpu.throttleReasons || '0x0000000000000000';
	const reasonVal = parseInt(reasons, 16) || 0;
	if (reasonVal > 0 && reasons !== '0x0000000000000000') {
		const labels = [];
		if (reasonVal & 0x04) labels.push('HW Slowdown');
		if (reasonVal & 0x08) labels.push('HW Thermal');
		if (reasonVal & 0x10) labels.push('HW Power');
		if (reasonVal & 0x20) labels.push('SW Power Cap');
		if (reasonVal & 0x40) labels.push('SW Thermal');
		if (reasonVal & 0x80) labels.push('Sync Boost');
		throttleEl.textContent = labels.length ? labels.join(', ') : reasons;
		throttleStat.style.display = '';
	} else {
		throttleStat.style.display = 'none';
	}
}

function updateSystemMetrics(data) {
	if (!data.system) return;
	const sys = data.system;

	// Load average.
	if (sys.loadAverage) {
		document.getElementById('load-avg-stat').textContent =
			sys.loadAverage.map(v => v.toFixed(2)).join(' / ');
	}

	// Per-core CPU heatmap.
	if (sys.coreUsage && sys.coreUsage.length > 0) {
		updateCoreHeatmap(sys.coreUsage);
	}

	// Disk I/O history.
	diskReadHistory.push(sys.diskReadBytesPerSec || 0);
	diskWriteHistory.push(sys.diskWriteBytesPerSec || 0);
	if (diskReadHistory.length > historySize) {
		diskReadHistory.shift(); diskWriteHistory.shift();
	}
	diskChart.data.labels = Array.from({ length: diskReadHistory.length }, (_, i) => i + 1);
	diskChart.data.datasets[0].data = [...diskReadHistory];
	diskChart.data.datasets[1].data = [...diskWriteHistory];
	diskChart.update('none');

	// Network I/O history.
	netRxHistory.push(sys.netRxBytesPerSec || 0);
	netTxHistory.push(sys.netTxBytesPerSec || 0);
	if (netRxHistory.length > historySize) {
		netRxHistory.shift(); netTxHistory.shift();
	}
	netChart.data.labels = Array.from({ length: netRxHistory.length }, (_, i) => i + 1);
	netChart.data.datasets[0].data = [...netRxHistory];
	netChart.data.datasets[1].data = [...netTxHistory];
	netChart.update('none');
}

function updateCoreHeatmap(coreUsage) {
	const container = document.getElementById('core-heatmap');

	// Create cells on first call or if count changed.
	if (container.children.length !== coreUsage.length) {
		container.innerHTML = '';
		for (let i = 0; i < coreUsage.length; i++) {
			const cell = document.createElement('div');
			cell.className = 'core-cell';
			cell.innerHTML = `<span class="core-cell-id">${i}</span><span class="core-cell-value">0%</span>`;
			container.appendChild(cell);
		}
	}

	for (let i = 0; i < coreUsage.length; i++) {
		const cell = container.children[i];
		const usage = coreUsage[i];
		cell.querySelector('.core-cell-value').textContent = `${usage}%`;
		cell.style.backgroundColor = coreHeatmapColor(usage);
		// High contrast text for readability.
		cell.style.color = usage > 60 ? '#ffffff' : getThemeVar('--text');
	}
}

function coreHeatmapColor(pct) {
	if (pct < 25) {
		const low = getThemeVar('--heatmap-low') || '#e8f5e9';
		return low;
	} else if (pct < 60) {
		return getThemeVar('--heatmap-mid') || '#ffb74d';
	} else {
		return getThemeVar('--heatmap-high') || '#e53935';
	}
}

/* ==========================================================
   Docker
   ========================================================== */

function updateDocker(data) {
	const dockerSection = document.getElementById('docker-section');
	const tableBody = document.getElementById('docker-table-body');
	const template = document.getElementById('docker-row-template');

	if (!data.docker || data.docker.length === 0) {
		dockerSection.style.display = 'none';
		return;
	}

	dockerSection.style.display = 'block';
	tableBody.innerHTML = '';

	data.docker.forEach(container => {
		const clone = template.content.cloneNode(true);

		clone.querySelector('.image').textContent = container.image;
		clone.querySelector('.name').textContent = container.names;
		clone.querySelector('.ports').textContent = container.ports;
		clone.querySelector('.cpu').textContent = container.cpu;
		clone.querySelector('.memory').textContent = container.memory;
		clone.querySelector('.netio').textContent = container.netIO || '--';
		clone.querySelector('.blockio').textContent = container.blockIO || '--';
		clone.querySelector('.pids').textContent = container.pids || '--';
		clone.querySelector('.status').textContent = `${container.status}`;

		const isRunning = container.status.toLowerCase().startsWith('up ');
		const statusClass = isRunning ? 'status-running' : 'status-stopped';
		const statusLabel = isRunning ? 'Running' : 'Stopped';

		const badge = clone.querySelector('.status-badge');
		badge.textContent = statusLabel;
		badge.classList.add(statusClass);

		const isDashboard = container.names.includes('dgx_dashboard') || container.image.includes('dgx_dashboard');

		let pending = pendingCommands[container.id];
		if (pending) {
			const elapsed = Date.now() - pending.timestamp;
			if (elapsed >= 10000 || pending.wasRunning !== isRunning) {
				delete pendingCommands[container.id];
				pending = null;
			}
		}

		Object.entries(dockerActions).forEach(([command, action]) => {
			const btn = clone.querySelector(action.selector);
			let shouldShow = action.shouldShow(isRunning, isDashboard);
			let label = action.label;
			let disabled = false;

			if (pending) {
				if (pending.command === command) {
					shouldShow = true; label = action.pendingLabel; disabled = true;
				} else {
					shouldShow = false;
				}
			}

			btn.style.display = shouldShow ? 'inline-block' : 'none';
			btn.textContent = label;
			btn.disabled = disabled;
			btn.onclick = () => sendDockerCommand(btn, container.id, command, isRunning);
		});

		const logsBtn = clone.querySelector('.logs-btn');
		logsBtn.style.display = isRunning ? 'inline-block' : 'none';
		logsBtn.onclick = () => openDockerLogs(container.id, container.names);
		if (activeLogContainerId === container.id) {
			logsBtn.textContent = 'Streaming...';
			logsBtn.disabled = true;
		}

		tableBody.appendChild(clone);
	});
}

function sendDockerCommand(btn, id, command, wasRunning) {
	const action = dockerActions[command];
	if (action.confirm && !confirm(action.confirm)) return;
	if (ws && ws.readyState === WebSocket.OPEN) {
		pendingCommands[id] = { command, timestamp: Date.now(), wasRunning };
		ws.send(JSON.stringify({ command, id }));
		btn.textContent = action.pendingLabel;
		btn.disabled = true;
	}
}

/* ==========================================================
   Docker log tailing
   ========================================================== */

function openDockerLogs(containerId, containerName) {
	closeDockerLogs(false);
	const panel = document.getElementById('docker-log-panel');
	const content = document.getElementById('docker-log-content');
	const title = document.getElementById('docker-log-title');
	panel.style.display = 'block';
	content.textContent = 'Loading logs...\n';
	title.textContent = `Logs: ${containerName}`;
	activeLogContainerId = containerId;
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ command: 'docker-logs-stream', id: containerId }));
	}
}

function closeDockerLogs(hide = true) {
	if (activeLogContainerId && ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ command: 'docker-logs-stop' }));
	}
	activeLogContainerId = null;
	if (hide) {
		const panel = document.getElementById('docker-log-panel');
		if (panel) panel.style.display = 'none';
		const content = document.getElementById('docker-log-content');
		if (content) content.textContent = '';
	}
}

function appendLogLine(line) {
	const content = document.getElementById('docker-log-content');
	if (!content) return;
	content.textContent += line + '\n';
	const lines = content.textContent.split('\n');
	if (lines.length > 5000) {
		content.textContent = lines.slice(-4000).join('\n');
	}
	const scrollLock = document.getElementById('docker-log-scroll-lock');
	if (scrollLock && scrollLock.checked) {
		content.scrollTop = content.scrollHeight;
	}
}

/* ==========================================================
   WebSocket connection
   ========================================================== */

const statusDiv = document.getElementById('status');
const nvidiaSmiCrashWarningDiv = document.getElementById('nvidia-smi-crash-warning');
const progressBar = document.getElementById('progress-bar');

function startProgressBar(seconds) {
	if (!progressBar) return;
	progressBar.style.transition = 'none';
	progressBar.style.width = '100%';
	progressBar.offsetHeight; // force reflow
	progressBar.style.transition = `width ${seconds}s linear`;
	requestAnimationFrame(() => progressBar.style.width = '0%');
}

function connect() {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

	ws.onopen = () => {
		statusDiv.textContent = 'Connected';
		statusDiv.style.color = getThemeVar('--status-connected') || '#4ec9b0';
		startProgressBar(5);
	};

	ws.onmessage = (event) => {
		const data = JSON.parse(event.data);

		// Handle docker log messages.
		if (data.type === 'docker-log-line') {
			if (data.id === activeLogContainerId) {
				const content = document.getElementById('docker-log-content');
				if (content && content.textContent === 'Loading logs...\n') {
					content.textContent = '';
				}
				appendLogLine(data.line);
			}
			return;
		}
		if (data.type === 'docker-logs') {
			if (data.id === activeLogContainerId) {
				const content = document.getElementById('docker-log-content');
				if (content) content.textContent = data.logs;
			}
			return;
		}

		// Regular metrics — dismiss loading.
		dismissLoading();

		if (!data.gpu) {
			statusDiv.innerHTML = 'nvidia-smi failed to start';
			statusDiv.style.color = getThemeVar('--status-error') || '#f48771';
			nvidiaSmiCrashWarningDiv.style.display = null;
		} else {
			nvidiaSmiCrashWarningDiv.style.display = 'none';
		}

		updateCharts(data);
		updateGpuInfoBar(data);
		updateSystemMetrics(data);
		updateStorage(data);
		updateDocker(data);
		startProgressBar(data.nextPollSeconds);
	};

	ws.onerror = (error) => {
		statusDiv.textContent = 'Error';
		statusDiv.style.color = getThemeVar('--status-error') || '#f48771';
	};

	ws.onclose = () => {
		statusDiv.textContent = 'Disconnected - Reconnecting...';
		statusDiv.style.color = getThemeVar('--status-warning') || '#ce9178';
		showLoadingError('Disconnected - Reconnecting...');
		setTimeout(connect, 1000);
	};
}

/* ==========================================================
   Storage
   ========================================================== */

function formatKB(kb) {
	if (kb < 1024) return `${kb} KB`;
	if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
	if (kb < 1024 * 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
	return `${(kb / (1024 * 1024 * 1024)).toFixed(1)} TB`;
}

function updateStorage(data) {
	if (!data.system || !data.system.storage) return;
	const storage = data.system.storage;
	const section = document.getElementById('storage-section');
	const container = document.getElementById('storage-bars');

	if (!storage || storage.length === 0) {
		section.style.display = 'none';
		return;
	}

	section.style.display = '';
	container.innerHTML = '';

	for (const dev of storage) {
		const pct = dev.totalKB > 0 ? (dev.usedKB / dev.totalKB * 100) : 0;
		const item = document.createElement('div');
		item.className = 'storage-item';

		const fillClass = pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : '';

		item.innerHTML = `
			<div class="storage-header">
				<span class="storage-mount">${dev.mountPoint}</span>
				<span class="storage-detail">${formatKB(dev.usedKB)} / ${formatKB(dev.totalKB)}</span>
			</div>
			<div class="storage-bar-track">
				<div class="storage-bar-fill ${fillClass}" style="width: ${pct.toFixed(1)}%"></div>
				<span class="storage-bar-pct">${pct.toFixed(1)}%</span>
			</div>
			<div class="storage-device-label">${dev.device} (${dev.fsType})</div>
		`;
		container.appendChild(item);
	}
}

/* ==========================================================
   Links dropdown
   ========================================================== */

function initLinksDropdown() {
	const toggle = document.getElementById('links-toggle');
	const menu = document.getElementById('links-menu');
	if (!toggle || !menu) return;

	toggle.addEventListener('click', (e) => {
		e.stopPropagation();
		menu.classList.toggle('open');
	});

	document.addEventListener('click', () => {
		menu.classList.remove('open');
	});

	menu.addEventListener('click', (e) => {
		e.stopPropagation();
	});
}

// Initialize.
document.addEventListener('DOMContentLoaded', () => {
	initTheme();
	initCharts();
	initLinksDropdown();
	connect();
	document.getElementById('docker-log-close').addEventListener('click', () => closeDockerLogs());
});
