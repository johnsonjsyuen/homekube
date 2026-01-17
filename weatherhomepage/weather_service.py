from flask import Flask, jsonify
import requests
import datetime
import pytz

app = Flask(__name__)

@app.route('/')
def weather_and_time():
    # Melbourne coordinates
    weather_url = "https://api.open-meteo.com/v1/forecast?latitude=-37.81&longitude=144.96&current_weather=true"
    
    try:
        weather_res = requests.get(weather_url).json()
        temp = weather_res.get('current_weather', {}).get('temperature', 'Unknown')
        
        # Local time in Melbourne
        tz = pytz.timezone('Australia/Melbourne')
        now = datetime.datetime.now(tz)
        local_time = now.strftime('%Y-%m-%d %H:%M:%S')
        
        return jsonify({
            "location": "Melbourne",
            "temperature_celsius": temp,
            "local_time": local_time
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
