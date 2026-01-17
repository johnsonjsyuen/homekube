from flask import Flask, render_template
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



@app.route('/')
def weather_and_time():
    # Port Melbourne coordinates
    base_url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": -37.8396,
        "longitude": 144.9423,
        "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max",
        "hourly": "wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "kn",
        "timezone": "Australia/Melbourne"
    }
    
    # Local time in Melbourne
    tz = pytz.timezone('Australia/Melbourne')
    now = datetime.datetime.now(tz)
    local_time = now.strftime('%A, %B %d, %Y • %I:%M %p')
    
    def deg_to_compass(num):
        val = int((num/22.5)+.5)
        arr = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
        return arr[(val % 16)]
    
    try:
        weather_res = requests.get(base_url, params=params).json()
        
        current = weather_res.get('current', {})
        daily = weather_res.get('daily', {})
        hourly = weather_res.get('hourly', {})
        
        # Current weather data
        temperature = current.get('temperature_2m', 'N/A')
        weather_code = current.get('weather_code', 0)
        wind_speed = current.get('wind_speed_10m', 'N/A')
        wind_direction = current.get('wind_direction_10m', 0)
        wind_direction_desc = deg_to_compass(wind_direction) if isinstance(wind_direction, (int, float)) else "N/A"
        humidity = current.get('relative_humidity_2m', 'N/A')
        cloud_cover = current.get('cloud_cover', 'N/A')
        
        condition, current_icon = WEATHER_CODES.get(weather_code, ("Unknown", "❓"))
        
        # Process forecast data
        forecast = []
        daily_hourly_map = {}
        
        if daily.get('time'):
            day_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            for i, date_str in enumerate(daily['time'][:7]):
                date = datetime.datetime.strptime(date_str, '%Y-%m-%d')
                day_code = daily.get('weather_code', [0]*7)[i]
                _, icon = WEATHER_CODES.get(day_code, ("Unknown", "❓"))
                
                # Get hourly data for this day
                day_hourly = []
                if hourly.get('time'):
                    for h_idx, h_time in enumerate(hourly['time']):
                        if h_time.startswith(date_str):
                            # Parse hour from time string (ISO format)
                            hour_dt = datetime.datetime.fromisoformat(h_time)
                            h_wind_dir = hourly['wind_direction_10m'][h_idx]
                            day_hourly.append({
                                'time': hour_dt.strftime('%I %p'),
                                'wind_speed': hourly['wind_speed_10m'][h_idx],
                                'wind_direction': h_wind_dir,
                                'wind_direction_desc': deg_to_compass(h_wind_dir) if isinstance(h_wind_dir, (int, float)) else "N/A"
                            })
                
                daily_hourly_map[date_str] = day_hourly
                
                forecast.append({
                    'date': date_str,
                    'name': day_names[date.weekday()] if i > 0 else 'Today',
                    'icon': icon,
                    'high': round(daily.get('temperature_2m_max', [0]*7)[i]),
                    'low': round(daily.get('temperature_2m_min', [0]*7)[i]),
                    'max_wind': daily.get('wind_speed_10m_max', [0]*7)[i]
                })
        
        return render_template(
            'weather.html',
            location="Port Melbourne, Australia",
            local_time=local_time,
            temperature=temperature,
            condition=condition,
            current_icon=current_icon,
            wind_speed=wind_speed,
            wind_direction=wind_direction,
            wind_direction_desc=wind_direction_desc,
            humidity=humidity,
            cloud_cover=cloud_cover,
            forecast=forecast,
            daily_hourly_map=daily_hourly_map,
            error=None
        )
    except Exception as e:
        return render_template(
            'weather.html',
            location="Port Melbourne, Australia",
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
        "latitude": -37.8396,
        "longitude": 144.9423,
        "current": "temperature_2m,weather_code,wind_speed_10m",
        "timezone": "Australia/Melbourne"
    }
    
    try:
        weather_res = requests.get(base_url, params=params).json()
        current = weather_res.get('current', {})
        
        tz = pytz.timezone('Australia/Melbourne')
        now = datetime.datetime.now(tz)
        
        return {
            "location": "Port Melbourne",
            "temperature_celsius": current.get('temperature_2m'),
            "wind_speed_kmh": current.get('wind_speed_10m'),
            "local_time": now.strftime('%Y-%m-%d %H:%M:%S')
        }
    except Exception as e:
        return {"error": str(e)}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
