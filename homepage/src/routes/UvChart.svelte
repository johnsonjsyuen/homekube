<script lang="ts">
    import { onMount } from 'svelte';

    let { chartData, maxUV, maxUVTime }: {
        chartData: { Date: string; Forecast: string; Measured: string }[];
        maxUV: number | null;
        maxUVTime: string | null;
    } = $props();

    let canvasEl: HTMLCanvasElement;
    let chartInstance: any = null;

    // Format maxUVTime for display (e.g., "2026-02-27 13:00" -> "1:00 PM")
    let formattedMaxTime = $derived.by(() => {
        if (!maxUVTime) return null;
        try {
            const date = new Date(maxUVTime);
            return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        } catch {
            return maxUVTime;
        }
    });

    onMount(() => {
        let mounted = true;

        async function initChart() {
            const { Chart, registerables } = await import('chart.js');
            if (!mounted) return;

            Chart.register(...registerables);

            const labels: string[] = [];
            const forecastValues: (number | null)[] = [];
            const measuredValues: (number | null)[] = [];

            for (const entry of chartData) {
                // Parse time label from Date string (e.g., "2026-02-27 06:00")
                try {
                    const date = new Date(entry.Date);
                    labels.push(date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }));
                } catch {
                    labels.push(entry.Date);
                }

                const forecast = parseFloat(entry.Forecast);
                forecastValues.push(isNaN(forecast) ? null : forecast);

                const measured = entry.Measured === 'n/a' || entry.Measured === null
                    ? null
                    : parseFloat(entry.Measured);
                measuredValues.push(measured !== null && isNaN(measured) ? null : measured);
            }

            // Calculate y-axis max
            const peakValue = maxUV ?? Math.max(
                ...forecastValues.filter((v): v is number => v !== null),
                ...measuredValues.filter((v): v is number => v !== null),
                0
            );
            const yMax = Math.max(14, peakValue + 2);

            // UV risk band plugin
            const uvBandsPlugin = {
                id: 'uvBands',
                beforeDraw(chart: any) {
                    const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
                    const bands = [
                        { min: 0, max: 3, color: 'rgba(74, 222, 128, 0.1)' },
                        { min: 3, max: 6, color: 'rgba(250, 204, 21, 0.1)' },
                        { min: 6, max: 8, color: 'rgba(251, 146, 60, 0.1)' },
                        { min: 8, max: 11, color: 'rgba(248, 113, 113, 0.1)' },
                        { min: 11, max: yMax, color: 'rgba(192, 132, 252, 0.1)' },
                    ];

                    for (const band of bands) {
                        const yBottom = y.getPixelForValue(band.min);
                        const yTop = y.getPixelForValue(Math.min(band.max, yMax));
                        if (yTop < bottom && yBottom > top) {
                            ctx.fillStyle = band.color;
                            ctx.fillRect(
                                left,
                                Math.max(yTop, top),
                                right - left,
                                Math.min(yBottom, bottom) - Math.max(yTop, top)
                            );
                        }
                    }
                }
            };

            chartInstance = new Chart(canvasEl, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Forecast',
                            data: forecastValues,
                            borderColor: '#4a90e2',
                            backgroundColor: 'rgba(74, 144, 226, 0.15)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            borderWidth: 2,
                        },
                        {
                            label: 'Measured',
                            data: measuredValues,
                            borderColor: '#4ade80',
                            backgroundColor: 'transparent',
                            fill: false,
                            tension: 0.3,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            borderWidth: 2,
                            spanGaps: false,
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            display: true,
                            labels: {
                                color: '#888',
                                usePointStyle: true,
                                pointStyle: 'line',
                            }
                        },
                        tooltip: {
                            backgroundColor: '#333',
                            titleColor: '#e0e0e0',
                            bodyColor: '#e0e0e0',
                            borderColor: '#444',
                            borderWidth: 1,
                            callbacks: {
                                label(context: any) {
                                    const val = context.parsed.y;
                                    if (val === null) return `${context.dataset.label}: n/a`;
                                    return `${context.dataset.label}: ${val.toFixed(1)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                color: '#888',
                                maxRotation: 0,
                            },
                            grid: {
                                color: '#333',
                            }
                        },
                        y: {
                            min: 0,
                            max: yMax,
                            title: {
                                display: true,
                                text: 'UV Index',
                                color: '#888',
                            },
                            ticks: {
                                color: '#888',
                                stepSize: 2,
                            },
                            grid: {
                                color: '#333',
                            }
                        }
                    }
                },
                plugins: [uvBandsPlugin]
            });
        }

        initChart().catch(err => console.error('Failed to initialize UV chart:', err));

        return () => {
            mounted = false;
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
        };
    });
</script>

<div class="uv-chart-section">
    <div class="uv-chart-title">UV Forecast</div>
    {#if maxUV !== null}
        <div class="uv-chart-peak">Peak: {maxUV} {#if formattedMaxTime}at {formattedMaxTime}{/if}</div>
    {/if}
    <div class="uv-chart-container">
        <canvas bind:this={canvasEl}></canvas>
    </div>
    <div class="uv-chart-attribution">Source: ARPANSA</div>
</div>

<style>
    .uv-chart-section {
        background: #2a2a2a;
        border-radius: 20px;
        padding: 20px;
        margin-top: 30px;
    }

    .uv-chart-title {
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 4px;
        padding-left: 10px;
    }

    .uv-chart-peak {
        font-size: 0.85rem;
        color: #888;
        padding-left: 10px;
        margin-bottom: 15px;
    }

    .uv-chart-container {
        height: 250px;
    }

    .uv-chart-attribution {
        font-size: 0.7rem;
        color: #666;
        text-align: right;
        margin-top: 8px;
        padding-right: 10px;
    }

    @media (max-width: 480px) {
        .uv-chart-container {
            height: 200px;
        }
    }
</style>
