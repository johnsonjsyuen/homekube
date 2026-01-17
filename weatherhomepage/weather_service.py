from flask import Flask, render_template_string
import requests
import datetime
import pytz

app = Flask(__name__)

# Weather code to description and icon mapping
WEATHER_CODES = {
    0: ("Clear sky", "☀️"),
    1: ("Mainly clear", "🌤️"),
    2: ("Partly cloudy", "⛅"),
    3: ("Overcast", "☁️"),
    45: ("Foggy", "🌫️"),
    48: ("Depositing rime fog", "🌫️"),
    51: ("Light drizzle", "🌧️"),
    53: ("Moderate drizzle", "🌧️"),
    55: ("Dense drizzle", "🌧️"),
    61: ("Slight rain", "🌧️"),
    63: ("Moderate rain", "🌧️"),
    65: ("Heavy rain", "🌧️"),
    66: ("Light freezing rain", "🌨️"),
    67: ("Heavy freezing rain", "🌨️"),
    71: ("Slight snow", "❄️"),
    73: ("Moderate snow", "❄️"),
    75: ("Heavy snow", "❄️"),
    77: ("Snow grains", "❄️"),
    80: ("Slight rain showers", "🌦️"),
    81: ("Moderate rain showers", "🌦️"),
    82: ("Violent rain showers", "⛈️"),
    85: ("Slight snow showers", "🌨️"),
    86: ("Heavy snow showers", "🌨️"),
    95: ("Thunderstorm", "⛈️"),
    96: ("Thunderstorm with slight hail", "⛈️"),
    99: ("Thunderstorm with heavy hail", "⛈️"),
}

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Melbourne Weather</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
            min-height: 100vh;
            color: #e0e0e0;
            padding: 2rem;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 2rem;
        }
        
        .location {
            font-size: 1.2rem;
            font-weight: 500;
            color: #8b8b9e;
            text-transform: uppercase;
            letter-spacing: 3px;
            margin-bottom: 0.5rem;
        }
        
        .datetime {
            font-size: 0.95rem;
            color: #6b6b7e;
        }
        
        .main-weather {
            background: linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 24px;
            padding: 3rem;
            text-align: center;
            margin-bottom: 2rem;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        
        .weather-icon {
            font-size: 6rem;
            margin-bottom: 1rem;
            animation: float 3s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        
        .temperature {
            font-size: 5rem;
            font-weight: 300;
            background: linear-gradient(135deg, #ffffff 0%, #a0a0c0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            line-height: 1;
        }
        
        .temperature .unit {
            font-size: 2rem;
            font-weight: 400;
            vertical-align: super;
        }
        
        .condition {
            font-size: 1.3rem;
            color: #9090a8;
            margin-top: 0.5rem;
            font-weight: 400;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 16px;
            padding: 1.5rem;
            text-align: center;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 24px rgba(0,0,0,0.2);
        }
        
        .stat-icon {
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }
        
        .stat-value {
            font-size: 1.8rem;
            font-weight: 600;
            color: #ffffff;
        }
        
        .stat-label {
            font-size: 0.85rem;
            color: #6b6b7e;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-top: 0.25rem;
        }
        
        .forecast-section {
            background: linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 20px;
            padding: 2rem;
        }
        
        .forecast-title {
            font-size: 1rem;
            font-weight: 500;
            color: #8b8b9e;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-bottom: 1.5rem;
        }
        
        .forecast-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 0.5rem;
        }
        
        @media (max-width: 768px) {
            .forecast-grid {
                grid-template-columns: repeat(4, 1fr);
            }
        }
        
        @media (max-width: 480px) {
            .forecast-grid {
                grid-template-columns: repeat(3, 1fr);
            }
        }
        
        .forecast-day {
            text-align: center;
            padding: 1rem 0.5rem;
            border-radius: 12px;
            transition: background 0.3s ease;
        }
        
        .forecast-day:hover {
            background: rgba(255,255,255,0.05);
        }
        
        .forecast-day-name {
            font-size: 0.8rem;
            color: #6b6b7e;
            margin-bottom: 0.5rem;
            font-weight: 500;
        }
        
        .forecast-icon {
            font-size: 1.8rem;
            margin-bottom: 0.5rem;
        }
        
        .forecast-temps {
            font-size: 0.85rem;
        }
        
        .forecast-high {
            color: #ffffff;
            font-weight: 600;
        }
        
        .forecast-low {
            color: #6b6b7e;
        }
        
        .error-message {
            background: rgba(255, 82, 82, 0.1);
            border: 1px solid rgba(255, 82, 82, 0.3);
            border-radius: 12px;
            padding: 2rem;
            text-align: center;
            color: #ff5252;
        }
        
        .wind-direction {
            display: inline-block;
            transition: transform 0.3s ease;
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="location">📍 {{ location }}</div>
            <div class="datetime">{{ local_time }}</div>
        </header>
        
        {% if error %}
        <div class="error-message">
            <p>⚠️ {{ error }}</p>
        </div>
        {% else %}
        <div class="main-weather">
            <div class="weather-icon">{{ current_icon }}</div>
            <div class="temperature">{{ temperature }}<span class="unit">°C</span></div>
            <div class="condition">{{ condition }}</div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">💨</div>
                <div class="stat-value">{{ wind_speed }} <small>km/h</small></div>
                <div class="stat-label">Wind Speed</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon wind-direction" style="transform: rotate({{ wind_direction }}deg);">🧭</div>
                <div class="stat-value">{{ wind_direction }}°</div>
                <div class="stat-label">Wind Direction</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🌡️</div>
                <div class="stat-value">{{ humidity }}%</div>
                <div class="stat-label">Humidity</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">☁️</div>
                <div class="stat-value">{{ cloud_cover }}%</div>
                <div class="stat-label">Cloud Cover</div>
            </div>
        </div>
        
        {% if forecast %}
        <div class="forecast-section">
            <div class="forecast-title">7-Day Forecast</div>
            <div class="forecast-grid">
                {% for day in forecast %}
                <div class="forecast-day">
                    <div class="forecast-day-name">{{ day.name }}</div>
                    <div class="forecast-icon">{{ day.icon }}</div>
                    <div class="forecast-temps">
                        <span class="forecast-high">{{ day.high }}°</span>
                        <span class="forecast-low">{{ day.low }}°</span>
                    </div>
                </div>
                {% endfor %}
            </div>
        </div>
        {% endif %}
        {% endif %}
    </div>
</body>
</html>
'''

@app.route('/')
def weather_and_time():
    # Melbourne coordinates
    base_url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": -37.81,
        "longitude": 144.96,
        "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min",
        "timezone": "Australia/Melbourne"
    }
    
    # Local time in Melbourne
    tz = pytz.timezone('Australia/Melbourne')
    now = datetime.datetime.now(tz)
    local_time = now.strftime('%A, %B %d, %Y • %I:%M %p')
    
    try:
        weather_res = requests.get(base_url, params=params).json()
        
        current = weather_res.get('current', {})
        daily = weather_res.get('daily', {})
        
        # Current weather data
        temperature = current.get('temperature_2m', 'N/A')
        weather_code = current.get('weather_code', 0)
        wind_speed = current.get('wind_speed_10m', 'N/A')
        wind_direction = current.get('wind_direction_10m', 0)
        humidity = current.get('relative_humidity_2m', 'N/A')
        cloud_cover = current.get('cloud_cover', 'N/A')
        
        condition, current_icon = WEATHER_CODES.get(weather_code, ("Unknown", "❓"))
        
        # Process forecast data
        forecast = []
        if daily.get('time'):
            day_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            for i, date_str in enumerate(daily['time'][:7]):
                date = datetime.datetime.strptime(date_str, '%Y-%m-%d')
                day_code = daily.get('weather_code', [0]*7)[i]
                _, icon = WEATHER_CODES.get(day_code, ("Unknown", "❓"))
                forecast.append({
                    'name': day_names[date.weekday()] if i > 0 else 'Today',
                    'icon': icon,
                    'high': round(daily.get('temperature_2m_max', [0]*7)[i]),
                    'low': round(daily.get('temperature_2m_min', [0]*7)[i])
                })
        
        return render_template_string(
            HTML_TEMPLATE,
            location="Melbourne, Australia",
            local_time=local_time,
            temperature=temperature,
            condition=condition,
            current_icon=current_icon,
            wind_speed=wind_speed,
            wind_direction=wind_direction,
            humidity=humidity,
            cloud_cover=cloud_cover,
            forecast=forecast,
            error=None
        )
    except Exception as e:
        return render_template_string(
            HTML_TEMPLATE,
            location="Melbourne, Australia",
            local_time=local_time,
            error=str(e),
            temperature=None,
            condition=None,
            current_icon=None,
            wind_speed=None,
            wind_direction=None,
            humidity=None,
            cloud_cover=None,
            forecast=None
        )

@app.route('/api')
def weather_api():
    """JSON API endpoint for programmatic access"""
    base_url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": -37.81,
        "longitude": 144.96,
        "current": "temperature_2m,weather_code,wind_speed_10m",
        "timezone": "Australia/Melbourne"
    }
    
    try:
        weather_res = requests.get(base_url, params=params).json()
        current = weather_res.get('current', {})
        
        tz = pytz.timezone('Australia/Melbourne')
        now = datetime.datetime.now(tz)
        
        return {
            "location": "Melbourne",
            "temperature_celsius": current.get('temperature_2m'),
            "wind_speed_kmh": current.get('wind_speed_10m'),
            "local_time": now.strftime('%Y-%m-%d %H:%M:%S')
        }
    except Exception as e:
        return {"error": str(e)}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
