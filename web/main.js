let usageChart, tempChart, memoryGauge, memoryLineChart;
let ws;

// Historical data for line charts.
const historySize = 10;
const gpuHistory = [];
const cpuHistory = [];
const gpuTempHistory = [];
const systemTempHistory = [];
const memoryHistory = [];
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

const themes = ['light', 'dark', 'brutalist'];
let currentThemeIndex = 0;
let pixelRainActive = false;
let pixelRainAnimId = null;

function initTheme() {
	const saved = localStorage.getItem('dgx-theme');
	if (saved && themes.includes(saved)) {
		currentThemeIndex = themes.indexOf(saved);
	}
	applyTheme(themes[currentThemeIndex]);

	document.getElementById('theme-toggle').addEventListener('click', () => {
		currentThemeIndex = (currentThemeIndex + 1) % themes.length;
		const theme = themes[currentThemeIndex];
		localStorage.setItem('dgx-theme', theme);
		applyTheme(theme);
	});
}

function applyTheme(theme) {
	document.documentElement.setAttribute('data-theme', theme);
	document.getElementById('theme-toggle').textContent = theme;

	// Update Chart.js colors.
	updateChartTheme();

	// Pixel rain.
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

	const charts = [usageChart, tempChart, memoryLineChart];
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
	window.addEventListener('resize', resize);

	let lastFrame = 0;
	const frameInterval = 1000 / 30; // 30fps cap

	function draw(timestamp) {
		if (!pixelRainActive) return;

		if (timestamp - lastFrame < frameInterval) {
			pixelRainAnimId = requestAnimationFrame(draw);
			return;
		}
		lastFrame = timestamp;

		ctx.fillStyle = 'rgba(10, 10, 10, 0.05)';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.fillStyle = 'rgba(0, 255, 65, 0.12)';
		ctx.font = `${fontSize}px monospace`;

		for (let i = 0; i < columns; i++) {
			const char = pixelRainChars[Math.floor(Math.random() * pixelRainChars.length)];
			const x = i * fontSize;
			const y = drops[i] * fontSize;

			ctx.fillText(char, x, y);

			if (y > canvas.height && Math.random() > 0.975) {
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
   Charts
   ========================================================== */

function createGauge(canvasId, label, maxValue, yellowFrom, redFrom) {
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
				legend: {
					display: false
				},
				tooltip: {
					enabled: false
				},
				annotation: {
					annotations: {
						usedLabel: {
							type: 'doughnutLabel',
							content: '0',
							font: {
								size: 32,
								weight: 'bold'
							},
							color: getThemeVar('--gauge-label') || 'black',
							yAdjust: 20,
							position: {
								x: 'center',
								y: '80%'
							}
						},
						totalLabel: {
							type: 'doughnutLabel',
							content: label,
							font: {
								size: 14
							},
							color: getThemeVar('--gauge-sublabel') || 'gray',
							yAdjust: 20,
							position: {
								x: 'center',
								y: '0%'
							},
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
	if (value >= redFrom) {
		color = 'rgb(255, 99, 132)';
	} else if (value >= yellowFrom) {
		color = 'rgb(255, 205, 86)';
	} else {
		color = 'rgb(75, 192, 192)';
	}

	// Truncate so we get 128GB when it's actually 128.5
	maxValue = Math.trunc(maxValue);
	if (value > maxValue) {
		value = maxValue;
	}

	const gaugeEmpty = getThemeVar('--gauge-empty') || 'rgb(230, 230, 230)';
	chart.data.datasets[0].data = [value, maxValue - value];
	chart.data.datasets[0].backgroundColor = [color, gaugeEmpty];
	chart.options.plugins.annotation.annotations.usedLabel.content = `${value.toFixed(1)}GB`;
	chart.options.plugins.annotation.annotations.totalLabel.content = `/${maxValue}GB`;
	chart.update('none');
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
				y: {
					beginAtZero: true,
					max: 100,
					title: {
						display: true,
						text: 'Usage %'
					}
				},
				x: {
					display: false
				}
			},
			plugins: {
				legend: {
					position: 'bottom',
				}
			}
		}
	});

	// Temperature line chart (combined GPU and CPU)
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
				y: {
					beginAtZero: true,
					max: 100,
					title: {
						display: true,
						text: 'Temperature C'
					}
				},
				x: {
					display: false
				}
			},
			plugins: {
				legend: {
					position: 'bottom'
				}
			}
		}
	});

	memoryGauge = createGauge('memory-gauge', '/128GB', 100, 60, 80);

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
						const yellowThreshold = maxValue * 0.6;
						const redThreshold = maxValue * 0.8;
						const value = ctx.p1.parsed.y;
						if (value >= redThreshold) {
							return 'rgb(255, 99, 132)';
						} else if (value >= yellowThreshold) {
							return 'rgb(255, 205, 86)';
						} else {
							return 'rgb(75, 192, 192)';
						}
					}
				}
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 128,
					title: {
						display: true,
						text: 'GB'
					}
				},
				x: {
					display: false
				}
			},
			plugins: {
				legend: {
					display: false
				}
			}
		}
	});

	// Apply theme colors after chart init.
	updateChartTheme();
}

function updateCharts(data) {
	// Convert KB to GB
	const usedGB = data.memory.usedKB / 1000000;
	const totalGB = data.memory.totalKB / 1000000;
	const memoryUsed = parseFloat(usedGB.toFixed(1));

	gpuHistory.push(data.gpu?.usagePercent);
	cpuHistory.push(data.cpu.usagePercent);
	gpuTempHistory.push(data.gpu?.temperatureC);
	systemTempHistory.push(data.temperature.systemTemperatureC);
	memoryHistory.push(memoryUsed);

	if (gpuHistory.length > historySize) {
		gpuHistory.shift();
		cpuHistory.shift();
		gpuTempHistory.shift();
		systemTempHistory.shift();
		memoryHistory.shift();
	}

	// Update usage line chart.
	usageChart.data.labels = Array.from({ length: gpuHistory.length }, (_, i) => i + 1);
	usageChart.data.datasets[0].data = [...gpuHistory];
	usageChart.data.datasets[1].data = [...cpuHistory];
	usageChart.update('none');

	// Update GPU power label.
	document.getElementById('gpu-power-label').textContent =
		`GPU Power: ${data.gpu?.powerW?.toFixed(0) ?? '?'} W`;

	// Update temperature line chart.
	tempChart.data.labels = Array.from({ length: gpuTempHistory.length }, (_, i) => i + 1);
	tempChart.data.datasets[0].data = [...gpuTempHistory];
	tempChart.data.datasets[1].data = [...systemTempHistory];
	tempChart.update('none');

	// Update memory gauge.
	updateGauge(memoryGauge, memoryUsed, totalGB);
	memoryGauge.update('none');

	// Update memory line chart.
	memoryLineChart.data.labels = Array.from({ length: memoryHistory.length }, (_, i) => i + 1);
	memoryLineChart.data.datasets[0].data = [...memoryHistory];
	memoryLineChart.update('none');

	// Update browser tab title.
	const maxUsage = Math.max(data.gpu?.usagePercent ?? 0, data.cpu.usagePercent);
	const maxTemp = Math.max(data.gpu?.temperatureC ?? 0, data.temperature.systemTemperatureC);
	document.title = `DGX ${Math.trunc(usedGB).toFixed(0)}GB ${maxUsage.toFixed(0)}% ${maxTemp.toFixed(0)}C`;
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

		// Check for pending commands
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
					shouldShow = true;
					label = action.pendingLabel;
					disabled = true;
				} else {
					shouldShow = false;
				}
			}

			btn.style.display = shouldShow ? 'inline-block' : 'none';
			btn.textContent = label;
			btn.disabled = disabled;
			btn.onclick = () => sendDockerCommand(btn, container.id, command, isRunning);
		});

		// Logs button.
		const logsBtn = clone.querySelector('.logs-btn');
		logsBtn.style.display = isRunning ? 'inline-block' : 'none';
		logsBtn.onclick = () => openDockerLogs(container.id, container.names);

		// Highlight active log stream.
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
	// Stop any existing stream.
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

	// Limit to ~5000 lines.
	const lines = content.textContent.split('\n');
	if (lines.length > 5000) {
		content.textContent = lines.slice(-4000).join('\n');
	}

	// Auto-scroll if enabled.
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

	// Force reflow to apply the reset before starting transition.
	progressBar.offsetHeight;

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
				// Clear the "Loading logs..." placeholder on first line.
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

		// Regular metrics message — dismiss loading overlay.
		dismissLoading();

		if (!data.gpu) {
			statusDiv.innerHTML = 'nvidia-smi failed to start';
			statusDiv.style.color = getThemeVar('--status-error') || '#f48771';
			nvidiaSmiCrashWarningDiv.style.display = null;
			console.error('nvidia-smi has failed to start');
		} else {
			nvidiaSmiCrashWarningDiv.style.display = 'none';
		}

		updateCharts(data);
		updateDocker(data);

		startProgressBar(data.nextPollSeconds);
	};

	ws.onerror = (error) => {
		statusDiv.textContent = 'Error';
		statusDiv.style.color = getThemeVar('--status-error') || '#f48771';
		console.error('WebSocket error:', error);
	};

	ws.onclose = () => {
		statusDiv.textContent = 'Disconnected - Reconnecting...';
		statusDiv.style.color = getThemeVar('--status-warning') || '#ce9178';
		showLoadingError('Disconnected - Reconnecting...');
		setTimeout(connect, 1000);
	};
}

// Initialize when page loads.
document.addEventListener('DOMContentLoaded', () => {
	initTheme();
	initCharts();
	connect();

	// Docker log panel close button.
	document.getElementById('docker-log-close').addEventListener('click', () => closeDockerLogs());
});
